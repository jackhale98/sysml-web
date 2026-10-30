/**
 * Fault trees read from the model, by the conventions of the
 * `FaultTreeAnalysis` library: occurrences typed by `TopEvent`,
 * `IntermediateEvent` and `BasicEvent` (and its `UndevelopedEvent` and
 * `ConditioningEvent`), whose causes are the events connected to them by
 * `Causation` (cause → effect). An event above the basic ones combines its
 * causes as its `gate` says (`k` of them for `atLeast`); a basic event's
 * probability is its `probability`, else 1 − e^(−λt) from its
 * `failureRate` (else its `component`'s) and its `exposureTime` (else its
 * top event's).
 *
 * - The row providers `faultTrees` (one row per top event), `cutSets` (its
 *   minimal cut sets) and `basicEvents` (each basic event's importance).
 * - The drawing of each tree (`faultTreeDrawings`).
 * - The checks: a top event more likely than it may be (its
 *   `tolerableProbability`, else the library's `TolerableProbability` of
 *   the worst harm its hazard leads to) is violated, and a tree that can't
 *   be worked out (an event without a probability, a gate that doesn't
 *   fit) is undecided, with why.
 *
 * The analysis itself is `#lib/engine/faultTree.ts`.
 */
import {
	FaultTreeError,
	basicEvents,
	cutSetProbability,
	gateProblem,
	importance,
	minCutUpperBound,
	minimalCutSets,
	probabilityFromRate,
	rareEventApproximation,
	topEventProbability,
	type CutSet,
	type FaultTree,
	type Gate,
	type GateKind,
	type Importance
} from '../../faultTree';
import { convert, formatQuantity, readable } from '../../quantity';
import type { Check, CheckStatus, ColumnKind, FaultTreeDrawing, FaultTreeEvent } from '../../types';
import { connectionEnds, isReference, type ElementRecord } from '../model';
import { percent } from './budget';
import type { ViewContext } from './context';
import { harmsOf, isA, valueIn } from './hazards';
import { isFmeaLine } from './riskLines';
import type { Row } from './rows';
import { collapseWhitespace, displayValue, parseNumber, unquote } from './text';

const TOP = 'FaultTreeAnalysis::TopEvent';
const GATED = 'FaultTreeAnalysis::GateEvent';
const UNDEVELOPED = 'FaultTreeAnalysis::UndevelopedEvent';
const CONDITIONING = 'FaultTreeAnalysis::ConditioningEvent';
const FAULT_EVENT = 'FaultTreeAnalysis::FaultEvent';
const CAUSATION = 'HazardAnalysis::Causation';
const GATES: readonly GateKind[] = ['and', 'or', 'atLeast', 'inhibit'];

/** A basic event as the analysis takes it. */
interface Basic {
	record: ElementRecord;
	probability: number | null;
	/** Where the probability comes from, in words. */
	source: string;
	component: { written: string; id: string | null } | null;
	failureMode: string | null;
	/** Whether an FMEA line about the component names the failure mode; null when the event names none. */
	inFmea: boolean | null;
}

/** A top event's tree, read and worked out. */
export interface ModelTree {
	top: ElementRecord;
	tree: FaultTree;
	/** Every event of the tree by id (the top event too). */
	events: Map<string, ElementRecord>;
	basics: Map<string, Basic>;
	hazard: ElementRecord | null;
	exposure: { value: number; unit: string } | null;
	tolerable: { value: number; from: string } | null;
	problems: string[];
	/** The analysis, when the tree could be worked out. */
	result: {
		cutSets: CutSet[];
		probability: number;
		rareEvent: number;
		upperBound: number;
		importance: Importance[];
		/** Each gate event's own probability (its subtree's, exactly). */
		gates: Map<string, number>;
	} | null;
	status: CheckStatus | null;
}

const cache = new WeakMap<ViewContext, ModelTree[]>();

/** The project's fault trees, one per top event, in declaration order. */
export function modelTrees(ctx: ViewContext): ModelTree[] {
	const known = cache.get(ctx);
	if (known) return known;
	const causes = causesOf(ctx);
	const trees = ctx.records
		.filter(
			(r) =>
				ctx.isContent(r) && !r.isDefinition && !!r.name && !isReference(r) && isA(ctx, r.id, TOP)
		)
		.map((top) => readTree(ctx, top, causes));
	cache.set(ctx, trees);
	return trees;
}

/** The causes of each fault event, through Causation connections, in the order written. */
function causesOf(ctx: ViewContext): Map<string, string[]> {
	const out = new Map<string, string[]>();
	for (const c of ctx.records) {
		if (c.metaclass !== 'ConnectionUsage' || !c.typeIds[0] || !isA(ctx, c.id, CAUSATION)) continue;
		const ends = connectionEnds(c.header);
		if (!ends) continue;
		const [cause, effect] = ends.map((e) => ctx.resolveIn(c.id, e));
		if (!cause || !effect || !isA(ctx, cause, FAULT_EVENT)) continue;
		const list = out.get(effect) ?? [];
		if (!list.includes(cause)) list.push(cause);
		out.set(effect, list);
	}
	return out;
}

const label = (r: ElementRecord) => r.name ?? r.written ?? '';

function readTree(ctx: ViewContext, top: ElementRecord, causes: Map<string, string[]>): ModelTree {
	const problems: string[] = [];
	const gates: Record<string, Gate> = {};
	const events = new Map<string, ElementRecord>();
	const exposure = durationOf(ctx, top, 'exposureTime');
	const hazard = referenced(ctx, top, 'hazard');
	const basics = new Map<string, Basic>();
	const walk = (id: string, path: string[]) => {
		const record = ctx.byId.get(id);
		if (!record || events.has(id)) return;
		events.set(id, record);
		if (isA(ctx, id, GATED)) {
			const gate = gateOf(ctx, record);
			const inputs = (causes.get(id) ?? []).filter((c) => !path.includes(c));
			if ((causes.get(id) ?? []).some((c) => path.includes(c)))
				problems.push(`\`${label(record)}\` is among its own causes (a loop)`);
			gates[id] = { ...gate, inputs };
			const wrong = gateProblem(gates[id]);
			if (wrong) problems.push(`\`${label(record)}\`: ${wrong}`);
			for (const input of inputs) walk(input, [...path, id]);
		} else {
			if (causes.get(id)?.length)
				problems.push(
					`\`${label(record)}\` is a basic event, so its causes are not counted: make it an IntermediateEvent with a gate`
				);
			const basic = readBasic(ctx, record, exposure);
			basics.set(id, basic);
			if (basic.probability === null) problems.push(basic.source);
		}
	};
	walk(top.id, []);

	const tree: FaultTree = { top: top.id, gates };
	const model: ModelTree = {
		top,
		tree,
		events,
		basics,
		hazard,
		exposure,
		tolerable: tolerableOf(ctx, top, hazard),
		problems,
		result: null,
		status: null
	};
	if (problems.length) {
		model.status = 'undecided';
		return model;
	}
	const p = Object.fromEntries([...basics].map(([id, b]) => [id, b.probability!]));
	try {
		const cutSets = minimalCutSets(tree);
		const probability = topEventProbability(tree, p);
		const gateProbabilities = new Map(
			Object.keys(gates).map((id) => [id, topEventProbability({ top: id, gates }, p)])
		);
		const order = new Map(basicEvents(tree).map((id, i) => [id, i]));
		model.result = {
			cutSets: cutSets.toSorted(
				(a, b) =>
					cutSetProbability(b, p) - cutSetProbability(a, p) ||
					a.length - b.length ||
					order.get(a[0]!)! - order.get(b[0]!)!
			),
			probability,
			rareEvent: rareEventApproximation(cutSets, p),
			upperBound: minCutUpperBound(cutSets, p),
			importance: importance(tree, p, cutSets),
			gates: gateProbabilities
		};
		model.status = model.tolerable
			? probability <= model.tolerable.value
				? 'satisfied'
				: 'violated'
			: null;
	} catch (error) {
		if (!(error instanceof FaultTreeError)) throw error;
		problems.push(error.message);
		model.status = 'undecided';
	}
	return model;
}

function gateOf(ctx: ViewContext, record: ElementRecord): Omit<Gate, 'inputs'> {
	const written = valueIn(ctx, record, 'gate')?.value;
	const name = written ? displayValue(written) : 'or';
	const kind = (GATES as readonly string[]).includes(name) ? (name as GateKind) : 'or';
	const k = numberIn(ctx, record, 'k');
	return kind === 'atLeast' ? { kind, ...(k !== null ? { k } : {}) } : { kind };
}

/** A plain number an element gives a feature (`:>> probability = 1E-6;`), or its evaluated value. */
function numberIn(ctx: ViewContext, record: ElementRecord, name: string): number | null {
	const own = valueIn(ctx, record, name);
	if (!own) return null;
	const n = parseNumber(own.value);
	if (n !== null) return n;
	const value = record.qualifiedName ? ctx.evaluation?.valueFor(record.qualifiedName, name) : null;
	return value?.kind === 'number' && value.unit === null ? value.value : null;
}

/** A quantity an element gives a feature, evaluated with its unit. */
function quantityIn(
	ctx: ViewContext,
	record: ElementRecord,
	name: string
): { value: number; unit: string } | null {
	if (!valueIn(ctx, record, name) || !record.qualifiedName) return null;
	const value = ctx.evaluation?.valueFor(record.qualifiedName, name);
	return value?.kind === 'number' && value.unit ? { value: value.value, unit: value.unit } : null;
}

function durationOf(ctx: ViewContext, record: ElementRecord, name: string) {
	const q = quantityIn(ctx, record, name);
	return q && convert(q.value, q.unit, 'h') !== null ? q : null;
}

/** The element a reference feature names (`ref :>> hazard = batteryFire;`). */
function referenced(ctx: ViewContext, record: ElementRecord, name: string): ElementRecord | null {
	const own = valueIn(ctx, record, name);
	if (!own) return null;
	const id = ctx.resolveIn(own.at.ownerId ?? record.id, own.value.trim());
	return id ? (ctx.byId.get(id) ?? null) : null;
}

function readBasic(
	ctx: ViewContext,
	record: ElementRecord,
	topExposure: { value: number; unit: string } | null
): Basic {
	const componentWritten = valueIn(ctx, record, 'component');
	const component = componentWritten
		? {
				written: componentWritten.value.trim(),
				id: ctx.resolveIn(componentWritten.at.ownerId ?? record.id, componentWritten.value.trim())
			}
		: null;
	const modeWritten = valueIn(ctx, record, 'failureMode')?.value;
	const failureMode = modeWritten ? unquote(modeWritten) : null;
	const base = {
		record,
		component,
		failureMode,
		inFmea: failureMode && component?.id ? fmeaNames(ctx, component.id, failureMode) : null
	};
	const given = numberIn(ctx, record, 'probability');
	if (given !== null) {
		if (given < 0 || given > 1)
			return {
				...base,
				probability: null,
				source: `\`${label(record)}\` has a probability of ${given}, outside 0 to 1`
			};
		return { ...base, probability: given, source: 'given' };
	}
	const componentRecord = component?.id ? ctx.byId.get(component.id) : undefined;
	const rate =
		quantityIn(ctx, record, 'failureRate') ??
		(componentRecord ? quantityIn(ctx, componentRecord, 'failureRate') : null);
	const time = durationOf(ctx, record, 'exposureTime') ?? topExposure;
	const perHour = rate ? convert(rate.value, rate.unit, 'h^-1') : null;
	const hours = time ? convert(time.value, time.unit, 'h') : null;
	if (perHour !== null && hours !== null) {
		const fromComponent = !quantityIn(ctx, record, 'failureRate');
		return {
			...base,
			probability: probabilityFromRate(perHour, hours),
			source: `${formatQuantity(rate!)}${fromComponent ? ` (${component!.written})` : ''} over ${formatQuantity(readable(time!))}`
		};
	}
	const why = !rate
		? 'no probability and no failure rate (nor a component with one)'
		: perHour === null
			? `a failure rate in ${rate.unit}, which is not per unit of time`
			: 'a failure rate but no exposure time (nor a top event with one)';
	return {
		...base,
		probability: null,
		source: `\`${label(record)}\` has ${why}`
	};
}

/** Whether an FMEA line about the component (or what it is defined by) names this failure mode. */
function fmeaNames(ctx: ViewContext, componentId: string, failureMode: string): boolean {
	const wanted = failureMode.trim().toLowerCase();
	return ctx.annotations.some((a) => {
		if (!isFmeaLine(a) || a.target_id !== componentId) return false;
		const mode = a.values.find(([k]) => k === 'failureMode')?.[1];
		return !!mode && unquote(mode).trim().toLowerCase() === wanted;
	});
}

/** The most the top event may be: its own `tolerableProbability`, else the policy for its hazard's worst harm. */
function tolerableOf(
	ctx: ViewContext,
	top: ElementRecord,
	hazard: ElementRecord | null
): { value: number; from: string } | null {
	const own = numberIn(ctx, top, 'tolerableProbability');
	if (own !== null) return { value: own, from: 'its tolerableProbability' };
	if (!hazard || !isA(ctx, hazard.id, 'HazardAnalysis::Hazard')) return null;
	const worst = harmsOf(ctx, hazard.id).find((h) => h.severity);
	if (!worst?.severity) return null;
	try {
		const value = ctx.calcs.call('TolerableProbability', [worst.severity.value]);
		if (typeof value !== 'number') return null;
		return {
			value,
			from: `TolerableProbability for ${label(worst.harm)}, ${worst.severity.literal} (${worst.severity.value})`
		};
	} catch {
		return null;
	}
}

// --- How the numbers read ---------------------------------------------------------

/**
 * A probability as engineers write one: three significant digits, in
 * exponent form below 0.001 (`1.2E-5`, as SysML writes the literal).
 */
export function formatProbability(p: number): string {
	if (!Number.isFinite(p)) return '';
	if (p === 0) return '0';
	if (Math.abs(p) >= 0.001) return String(Number(p.toPrecision(3)));
	const [mantissa, exponent] = p.toExponential(2).split('e');
	return `${Number(mantissa)}E${Number(exponent)}`;
}

/** How the fields of the fault tree providers read. */
export function faultTreeFieldKinds(spec: string): Record<string, ColumnKind> {
	switch (spec) {
		case 'faultTrees':
			return { check: 'check', cutSets: 'number', smallestCutSet: 'number' };
		case 'cutSets':
			return { rank: 'number', order: 'number', share: 'percent' };
		case 'basicEvents':
			return { rank: 'number', fussellVesely: 'percent' };
		default:
			return {};
	}
}

/** ` over 30 min`: the top event's exposure time, when it has one. */
const over = (t: ModelTree) => (t.exposure ? ` over ${formatQuantity(readable(t.exposure))}` : '');

// --- Rows -------------------------------------------------------------------------

/** One row per top event: its probability, the bounds, the most it may be and the margin. */
export function faultTreeRows(ctx: ViewContext): Row[] {
	return modelTrees(ctx).map((t) => {
		const r = t.result;
		const margin =
			r && t.tolerable
				? `${formatProbability(t.tolerable.value - r.probability)} (${percent((t.tolerable.value - r.probability) / t.tolerable.value)})`
				: '';
		const notes: Record<string, string> = {};
		if (!r) notes.probability = `not worked out: ${t.problems.join('; ')}`;
		else
			notes.probability = `exact${over(t)}; the rare-event approximation (the sum of the cut sets) is ${formatProbability(r.rareEvent)}`;
		if (t.tolerable) notes.tolerable = `from ${t.tolerable.from}`;
		else notes.tolerable = 'no tolerableProbability, nor a hazard whose harms have a severity';
		return {
			fields: new Map([
				['element', label(t.top)],
				['hazard', t.hazard ? label(t.hazard) : ''],
				['description', descriptionOf(ctx, t.top)],
				['exposure', t.exposure ? formatQuantity(readable(t.exposure)) : ''],
				['probability', r ? formatProbability(r.probability) : ''],
				['rareEvent', r ? formatProbability(r.rareEvent) : ''],
				['upperBound', r ? formatProbability(r.upperBound) : ''],
				['tolerable', t.tolerable ? formatProbability(t.tolerable.value) : ''],
				['margin', margin],
				['check', t.status ?? ''],
				['cutSets', r ? String(r.cutSets.length) : ''],
				[
					'smallestCutSet',
					r?.cutSets.length ? String(Math.min(...r.cutSets.map((s) => s.length))) : ''
				],
				['basicEvents', String(t.basics.size)],
				['file', t.top.path],
				['line', String(t.top.span.start_row)]
			]),
			anchors: [t.top.id],
			element: t.top.qualifiedName ?? '',
			typeId: t.top.typeIds[0] ?? null,
			info: { notes }
		} satisfies Row;
	});
}

/** One row per minimal cut set of each top event, most likely first. */
export function cutSetRows(ctx: ViewContext): Row[] {
	const rows: Row[] = [];
	for (const t of modelTrees(ctx)) {
		if (!t.result) continue;
		const p = Object.fromEntries([...t.basics].map(([id, b]) => [id, b.probability!]));
		const order = [...t.basics.keys()];
		for (const [i, set] of t.result.cutSets.entries()) {
			const probability = cutSetProbability(set, p);
			const names = set
				.toSorted((a, b) => order.indexOf(a) - order.indexOf(b))
				.map((id) => label(t.events.get(id)!));
			const components = [
				...new Set(set.flatMap((id) => t.basics.get(id)?.component?.written ?? []))
			];
			rows.push({
				fields: new Map([
					['topEvent', label(t.top)],
					['rank', String(i + 1)],
					['order', String(set.length)],
					['events', names.join(' and ')],
					['probability', formatProbability(probability)],
					['share', t.result.probability > 0 ? percent(probability / t.result.probability) : ''],
					['components', components.join(', ')],
					['file', t.top.path],
					['line', String(t.top.span.start_row)]
				]),
				anchors: [t.top.id],
				element: t.top.qualifiedName ?? ''
			});
		}
	}
	return rows;
}

/**
 * One row per basic event of each top event, with its importance to it;
 * `rank` orders them by Fussell-Vesely, most important first.
 */
export function basicEventRows(ctx: ViewContext): Row[] {
	const rows: Row[] = [];
	for (const t of modelTrees(ctx)) {
		const measure = (id: string) => t.result?.importance.find((x) => x.event === id);
		const ranked = [...t.basics].toSorted(
			([a], [b]) => (measure(b)?.fussellVesely ?? 0) - (measure(a)?.fussellVesely ?? 0)
		);
		for (const [i, [id, b]] of ranked.entries()) {
			const m = measure(id);
			const notes: Record<string, string> = {};
			if (b.probability !== null && b.source !== 'given') notes.probability = b.source;
			if (b.inFmea === false)
				notes.inFmea = `no FMEA line about ${b.component?.written} names “${b.failureMode}”`;
			rows.push({
				fields: new Map([
					['topEvent', label(t.top)],
					['rank', t.result ? String(i + 1) : ''],
					['element', label(b.record)],
					['description', descriptionOf(ctx, b.record)],
					['component', b.component?.written ?? ''],
					['failureMode', b.failureMode ?? ''],
					['probability', b.probability !== null ? formatProbability(b.probability) : ''],
					['source', b.source],
					['fussellVesely', m ? percent(m.fussellVesely) : ''],
					['birnbaum', m ? formatProbability(m.birnbaum) : ''],
					['achievementWorth', m ? String(Number(m.achievementWorth.toPrecision(3))) : ''],
					[
						'reductionWorth',
						m
							? Number.isFinite(m.reductionWorth)
								? String(Number(m.reductionWorth.toPrecision(3)))
								: '∞'
							: ''
					],
					['inFmea', b.inFmea === null ? '' : b.inFmea ? 'yes' : 'no'],
					['file', b.record.path],
					['line', String(b.record.span.start_row)]
				]),
				anchors: [t.top.id, id],
				element: b.record.qualifiedName ?? '',
				typeId: b.record.typeIds[0] ?? null,
				...(Object.keys(notes).length ? { info: { notes } } : {})
			});
		}
	}
	return rows;
}

function descriptionOf(ctx: ViewContext, record: ElementRecord): string {
	const own = valueIn(ctx, record, 'description')?.value;
	return own ? unquote(own) : collapseWhitespace(record.docs.join(' '));
}

// --- Checks -----------------------------------------------------------------------

/**
 * A top event more likely than it may be is a violated check (a problem at
 * the top event); a tree that can't be worked out is an undecided one,
 * with why. A top event within its limit adds nothing (the summary table
 * shows it), as a type's invariant that holds doesn't.
 */
export function faultTreeChecks(ctx: ViewContext): Check[] {
	const checks: Check[] = [];
	for (const t of modelTrees(ctx)) {
		const name = `the fault tree of ${label(t.top)}`;
		const base = {
			kind: 'assert' as const,
			checkable: true,
			requirement: null,
			by: label(t.top),
			name,
			file: t.top.path,
			span: t.top.span
		};
		if (t.status === 'undecided') {
			const why = `${t.problems.join('; ')}.`;
			checks.push({
				...base,
				status: 'undecided',
				undecided: 'open',
				detail: why,
				explanation: why,
				constraint: '',
				values: []
			});
		} else if (t.status === 'violated' && t.result && t.tolerable) {
			const p = formatProbability(t.result.probability);
			const most = formatProbability(t.tolerable.value);
			const message = `The top event ${label(t.top)} has a probability of ${p}${over(t)}, more than the ${most} it may have (${t.tolerable.from}).`;
			checks.push({
				...base,
				status: 'violated',
				detail: message,
				explanation: message,
				constraint: `probability <= ${most}`,
				values: [
					{
						feature: 'probability',
						value: { kind: 'number', value: t.result.probability, unit: null }
					}
				],
				problem: message
			});
		}
	}
	return checks;
}

// --- Drawing ----------------------------------------------------------------------

/** The trees to draw: those of the top events in `exposed` (or within it), every tree when it is null. */
export function faultTreeDrawings(
	ctx: ViewContext,
	exposed: Set<string> | null
): FaultTreeDrawing[] {
	return modelTrees(ctx)
		.filter(
			(t) =>
				!exposed ||
				exposed.has(t.top.id) ||
				ctx.ownerChain(t.top).some((owner) => exposed.has(owner))
		)
		.map((t) => drawing(ctx, t));
}

function drawing(ctx: ViewContext, t: ModelTree): FaultTreeDrawing {
	const events: FaultTreeEvent[] = [];
	for (const [id, record] of t.events) {
		const gate = t.tree.gates[id];
		const basic = t.basics.get(id);
		const kind: FaultTreeEvent['kind'] =
			id === t.top.id
				? 'top'
				: gate
					? 'intermediate'
					: isA(ctx, id, UNDEVELOPED)
						? 'undeveloped'
						: isA(ctx, id, CONDITIONING)
							? 'conditioning'
							: 'basic';
		const description = descriptionOf(ctx, record);
		const event: FaultTreeEvent = {
			id,
			name: label(record),
			kind,
			description: description || null,
			inputs: gate?.inputs ?? [],
			probability: gate ? (t.result?.gates.get(id) ?? null) : (basic?.probability ?? null),
			element: { file: record.path, start_byte: record.span.start_byte }
		};
		if (gate) {
			event.gate = gate.kind;
			if (gate.k !== undefined) event.k = gate.k;
		}
		if (basic) {
			if (basic.probability !== null) event.source = basic.source;
			if (basic.component) event.component = basic.component.written;
			if (basic.failureMode) event.failureMode = basic.failureMode;
		}
		events.push(event);
	}
	const r = t.result;
	return {
		top: t.top.id,
		events,
		probability: r?.probability ?? null,
		tolerable: t.tolerable,
		status: t.status,
		cutSets: r?.cutSets.length ?? 0,
		smallestCutSet: r?.cutSets.length ? Math.min(...r.cutSets.map((s) => s.length)) : null,
		problems: t.problems
	};
}
