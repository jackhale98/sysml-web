/**
 * Values and verdicts: the toolkit's `evaluate` and `verify` over the
 * analysed model, as the app's `Evaluated` values and `Check`s.
 *
 * - **Checks.** `verify` evaluates every constraint of the user's model and
 *   every `satisfy R by x` claim (R's constraints with R's subject bound to
 *   x). A claim becomes one check; a requirement's constraint becomes one
 *   only while nothing claims to satisfy the requirement (it is otherwise
 *   decided through the claims); an `assert constraint` becomes one, except
 *   a type's invariant (`assert constraint { that >= 1 }` in an attribute
 *   def) that holds. Positions come as 1-based lines and byte columns in the
 *   session's text and are mapped to the person's text.
 * - **Values.** `evaluate` on an element's bound value. A check's values are
 *   the feature chains its constraints name (`drone.endurance`), evaluated
 *   with the subject bound to what satisfies the requirement.
 * - **The evaluation session.** A part with metadata (`@Fmea about
 *   drone::battery`, or `@M;` in its body) makes the toolkit 0.10 refuse to
 *   evaluate the values the part inherits from its definition ("value
 *   receiver identity is incomplete or ambiguous"; reported upstream, see
 *   docs/engine.md). Metadata doesn't take part in evaluating values, so
 *   values and verdicts come from a second session over the same texts with
 *   every `@…`/`metadata …` annotation blanked out (spaces, newlines kept,
 *   so every position is unchanged; element ids are the same). It costs
 *   about 25 ms on the demo in Node, once per analysis, and only when asked.
 *
 * Everything is cached per analysis (one `Evaluation` per built session).
 */
import { convert, formatQuantity, parseLiteral, readable, type Quantity } from '../quantity';
import type { Check, CheckReport, CheckStatus, CheckValue, Evaluated, Span } from '../types';
import type { TkElement, TkLibrary, TkSession, TkSite, Toolkit } from './api';
import { multiplicityOf, type ElementRecord, type ExtractedModel, type UnitInfo } from './model';

/** The JSON `verify` answers (only the fields the app reads). */
interface TkVerifyReport {
	constraints: TkConstraintVerdict[];
	satisfactions: TkSatisfaction[];
	summary: { satisfied: number; violated: number; undecided: number };
}

interface TkPosition {
	unitName: string;
	/** 1-based; columns in UTF-8 bytes; the end column is exclusive. */
	line: number;
	col: number;
	endLine: number;
	endCol: number;
}

interface TkBinding {
	feature: string;
	value?: string | null;
}

interface TkConstraintVerdict extends TkPosition {
	name: string | null;
	elementType: string;
	asserted: boolean;
	status: CheckStatus;
	detail: string;
	bindings: TkBinding[];
}

interface TkSatisfaction extends TkPosition {
	requirement: string | null;
	by: string | null;
	negated: boolean;
	status: CheckStatus;
	vacuous: boolean;
	detail: string;
	constraints: (TkConstraintVerdict & { assumed?: boolean })[];
}

export interface EvaluationSource {
	tk: Toolkit;
	library: TkLibrary;
	/** The analysed session (its texts are the units' `repaired` texts). */
	session: TkSession;
	/** The units by path. */
	units: Map<string, UnitInfo>;
	extracted: ExtractedModel;
}

export class Evaluation {
	private readonly source: EvaluationSource;
	/** The session values are evaluated in: a copy without metadata, or the analysed one. */
	private own: TkSession | null = null;
	private opened = false;
	private report: CheckReport | undefined;
	private readonly values = new Map<string, Evaluated>();
	/** Records by qualified name (first wins), for requirement and owner lookups. */
	private readonly byQualified = new Map<string, ElementRecord>();
	/** Timings, for measurements. */
	readonly timings = { sessionMs: 0, verifyMs: 0 };

	constructor(source: EvaluationSource) {
		this.source = source;
		for (const r of source.extracted.elements)
			if (r.qualifiedName && !this.byQualified.has(r.qualifiedName))
				this.byQualified.set(r.qualifiedName, r);
	}

	free() {
		this.own?.free();
		this.own = null;
	}

	/** The session to evaluate in, opened on first use. */
	get session(): TkSession {
		if (!this.opened) {
			this.opened = true;
			const started = performance.now();
			this.own = withoutMetadata(this.source);
			this.timings.sessionMs = Math.round(performance.now() - started);
		}
		return this.own ?? this.source.session;
	}

	/** Evaluated values of elements, by id (unknown ids are left out). */
	evaluate(ids: readonly string[]): Record<string, Evaluated> {
		const out: Record<string, Evaluated> = {};
		for (const id of ids) {
			const value = this.valueOf(id);
			if (value) out[id] = value;
		}
		return out;
	}

	valueOf(id: string): Evaluated | null {
		const cached = this.values.get(id);
		if (cached) return cached;
		const handle = this.session.elementById(id);
		if (!handle) return null;
		let value = this.evaluateHandle(handle, id);
		const record = this.source.extracted.byId.get(id);
		const owner = record?.ownerId ? this.source.extracted.byId.get(record.ownerId) : undefined;
		if (value.kind === 'undecided' && record?.name && owner?.qualifiedName)
			value = this.withCause(value, owner.qualifiedName, record.name);
		this.values.set(id, value);
		return value;
	}

	/** The value of a feature named by its qualified name (`DroneArchitecture::drone::endurance`). */
	valueAt(qualifiedName: string): Evaluated | null {
		const key = `@${qualifiedName}`;
		const cached = this.values.get(key);
		if (cached) return cached;
		const handle = this.session.resolve(qualifiedName);
		if (!handle) return null;
		const id = this.session.elementId(handle);
		let value = this.evaluateHandle(handle, id);
		this.values.set(key, value);
		if (value.kind === 'undecided') {
			const at = qualifiedName.lastIndexOf('::');
			if (at > 0)
				value = this.withCause(value, qualifiedName.slice(0, at), qualifiedName.slice(at + 2));
			this.values.set(key, value);
		}
		return value;
	}

	private withCause(value: Evaluated, context: string, feature: string): Evaluated {
		const cause = this.cause(context, feature, 0, new Set());
		return cause ? { kind: 'undecided', reason: cause } : value;
	}

	/**
	 * Why `feature` (a name or a chain, as written in `context`) has no
	 * value, followed through the values it depends on: a collection of
	 * parts on the way (`rotors : Rotor[4]`, which the toolkit doesn't
	 * evaluate over), or a feature nothing gives a value.
	 */
	cause(context: string, feature: string, depth: number, seen: Set<string>): string | null {
		if (depth > 8 || seen.has(`${context}|${feature}`)) return null;
		seen.add(`${context}|${feature}`);
		const segments = feature.split('.');
		let scope = context;
		for (const segment of segments.slice(0, -1)) {
			const record = this.recordAt(`${scope}::${segment}`);
			const many = record && record.value === null ? collectionSize(record.header) : null;
			if (many)
				return `\`${segment}\` is a collection of ${many} parts (\`${record!.header.replace(/\s+/g, ' ').trim()}\`), and the engine cannot yet evaluate a value over a collection (\`${feature}\`)`;
			scope = `${scope}::${segment}`;
		}
		const name = segments[segments.length - 1]!;
		const qualified = `${scope}::${name}`;
		const record = this.recordAt(qualified);
		if (!record) return null;
		if (record.value === null) {
			const value = this.rawValueAt(qualified);
			return value?.kind === 'none' || value === null
				? `\`${feature}\` has no value in \`${lastSegment(scope)}\``
				: null;
		}
		for (const reference of referencesIn(record.value)) {
			const value = this.rawValueAt(`${scope}::${reference.replace(/\./g, '::')}`);
			if (value && value.kind !== 'undecided' && value.kind !== 'none' && !reference.includes('.'))
				continue;
			const found = this.cause(scope, reference, depth + 1, seen);
			if (found) return found;
		}
		return null;
	}

	/** A value without looking for causes (no recursion through `valueAt`). */
	private rawValueAt(qualifiedName: string): Evaluated | null {
		const handle = this.session.resolve(qualifiedName);
		if (!handle) return null;
		return this.evaluateHandle(handle, this.session.elementId(handle));
	}

	private recordAt(qualifiedName: string): ElementRecord | undefined {
		const handle = this.session.resolve(qualifiedName);
		if (!handle) return undefined;
		try {
			return this.source.extracted.byId.get(this.session.elementId(handle));
		} finally {
			handle.free();
		}
	}

	private evaluateHandle(handle: TkElement, id: string): Evaluated {
		try {
			return fromJson(this.session.evaluate(handle), id, this.source.extracted);
		} catch (error) {
			return { kind: 'undecided', reason: plainReason(String(error)) };
		} finally {
			handle.free();
		}
	}

	/** Every check of the model, decided once per analysis. */
	checks(): CheckReport {
		if (this.report) return this.report;
		const session = this.session;
		const started = performance.now();
		const raw = JSON.parse(session.verify(null)) as TkVerifyReport;
		const checks = this.mapReport(raw);
		this.timings.verifyMs = Math.round(performance.now() - started);
		const summary = { satisfied: 0, violated: 0, undecided: 0 };
		for (const c of checks) summary[c.status]++;
		this.report = { checks, summary, ms: this.timings.verifyMs };
		return this.report;
	}

	private mapReport(raw: TkVerifyReport): Check[] {
		const checks: Check[] = [];
		const claimed = new Set<string>();
		for (const s of raw.satisfactions) {
			const requirement = s.requirement ? this.byQualified.get(s.requirement) : undefined;
			if (requirement) claimed.add(requirement.id);
			const check = this.satisfaction(s, requirement);
			if (check) checks.push(check);
		}
		for (const c of raw.constraints) {
			const located = this.locate(c);
			if (!located) continue;
			let owner = this.ownerAt(located.unit, located.start);
			// The constraint itself, when named: its owner is what it is about.
			while (owner && /Constraint/.test(owner.metaclass))
				owner = owner.ownerId ? this.source.extracted.byId.get(owner.ownerId) : undefined;
			if (c.asserted) {
				// A type's invariant over every value (`that`) is noise while it holds.
				if (owner?.metaclass === 'AttributeDefinition' && c.status !== 'violated') continue;
				checks.push(this.assertion(c, located, owner));
				continue;
			}
			// A requirement's own constraint: decided through the claims that satisfy it.
			const requirement = this.requirementAround(located.unit, located.start);
			if (!requirement || requirement.isDefinition || claimed.has(requirement.id)) continue;
			checks.push(this.unclaimed(c, located, requirement));
		}
		return checks;
	}

	private satisfaction(s: TkSatisfaction, requirement: ElementRecord | undefined): Check | null {
		const at = this.locate(s);
		if (!at) return null;
		const trace = this.source.extracted.traces.find(
			(t) => t.kind === 'satisfy' && t.at.path === at.unit.path && overlaps(t.at.span, at.span)
		);
		const byRecord = trace?.byId ? this.source.extracted.byId.get(trace.byId) : undefined;
		const constraintTexts: string[] = [];
		let constraintAt: Check['constraintAt'];
		const values: CheckValue[] = [];
		const seen = new Set<string>();
		for (const c of s.constraints) {
			const located = this.locate(c);
			const text = located ? located.text : '';
			if (text) constraintTexts.push(text);
			if (located && !constraintAt) constraintAt = { file: located.unit.path, span: located.span };
			for (const chain of chainsIn(text)) {
				if (seen.has(chain)) continue;
				seen.add(chain);
				values.push({ feature: chain, value: this.chainValue(chain, byRecord, c.bindings) });
			}
		}
		const constraint = constraintTexts.join('; ');
		const checkable = s.constraints.length > 0;
		const status: CheckStatus = s.status;
		const check: Check = {
			kind: 'satisfy',
			status,
			checkable,
			detail: s.detail,
			explanation: '',
			requirement: requirement
				? {
						name: requirement.name ?? '',
						qualifiedName: requirement.qualifiedName ?? '',
						id: requirement.shortName,
						elementId: requirement.id
					}
				: s.requirement
					? {
							name: lastSegment(s.requirement),
							qualifiedName: s.requirement,
							id: null,
							elementId: null
						}
					: null,
			by: s.by,
			constraint,
			name: null,
			values,
			file: at.unit.path,
			span: at.span,
			...(constraintAt ? { constraintAt } : {})
		};
		if (s.constraints.length === 1) addMargin(check);
		check.explanation = explain(check, s.vacuous);
		return check;
	}

	private assertion(c: TkConstraintVerdict, at: Located, owner: ElementRecord | undefined): Check {
		const values: CheckValue[] = [];
		const seen = new Set<string>();
		for (const chain of [...chainsIn(at.text), ...c.bindings.map((b) => b.feature)]) {
			if (seen.has(chain) || chain === 'that') continue;
			seen.add(chain);
			values.push({ feature: chain, value: this.chainValue(chain, owner, c.bindings) });
		}
		const check: Check = {
			kind: 'assert',
			status: c.status,
			checkable: true,
			detail: c.detail,
			explanation: '',
			requirement: null,
			by: owner?.name ?? null,
			constraint: at.text,
			name: c.name,
			values,
			file: at.unit.path,
			span: at.span
		};
		addMargin(check);
		check.explanation = explain(check, false);
		return check;
	}

	private unclaimed(c: TkConstraintVerdict, at: Located, requirement: ElementRecord): Check {
		const check: Check = {
			kind: 'require',
			status: 'undecided',
			checkable: true,
			detail: c.detail,
			explanation:
				'Nothing in the design claims to satisfy this requirement yet (no `satisfy`), so there is no value to check it against.',
			requirement: {
				name: requirement.name ?? '',
				qualifiedName: requirement.qualifiedName ?? '',
				id: requirement.shortName,
				elementId: requirement.id
			},
			by: null,
			constraint: at.text,
			name: c.name,
			values: [],
			file: at.unit.path,
			span: at.span
		};
		return check;
	}

	/**
	 * The value of `a.b.c` as a constraint names it: from the toolkit's own
	 * binding when it gave one, else `a` is the element the constraint is
	 * evaluated for (the satisfying element for a requirement's subject, the
	 * owner for an `assert`), and `b.c` is looked up from it.
	 */
	private chainValue(
		chain: string,
		context: ElementRecord | undefined,
		bindings: TkBinding[]
	): Evaluated {
		const bound = bindings.find((b) => b.feature === chain);
		if (bound?.value) {
			const literal = parseLiteral(bound.value);
			if (literal) return { kind: 'number', value: literal.value, unit: literal.unit };
			return { kind: 'text', text: bound.value };
		}
		const segments = chain.split('.');
		const candidates: string[] = [];
		if (context?.qualifiedName) {
			// `drone.endurance` with drone bound to the satisfying element: its `endurance`.
			if (segments.length > 1)
				candidates.push([context.qualifiedName, ...segments.slice(1)].join('::'));
			// `battery.mass` inside `drone` (an assert): drone's `battery.mass`.
			candidates.push([context.qualifiedName, ...segments].join('::'));
		}
		for (const name of candidates) {
			const value = this.valueAt(name);
			if (value)
				return value.kind === 'none' ? { kind: 'undecided', reason: 'it has no value' } : value;
		}
		return { kind: 'undecided', reason: 'its value is not known' };
	}

	/** A verdict's range in the person's text, with the text it covers. */
	private locate(p: TkPosition): Located | null {
		const unit = this.source.units.get(p.unitName);
		if (!unit || !p.line) return null;
		let start = unit.repaired.byteOfLineCol(p.line, p.col);
		let end = unit.repaired.byteOfLineCol(p.endLine, p.endCol);
		if (unit.repair) {
			start = unit.repair.toOriginal(start);
			end = unit.repair.toOriginal(end);
		}
		const span = unit.original.spanOfBytes(start, Math.max(start, end));
		const text = unit.original.text.slice(span.from, span.to).replace(/\s+/g, ' ').trim();
		return { unit, start, span, text };
	}

	/** The innermost named element whose declaration contains a byte of the person's text. */
	private ownerAt(unit: UnitInfo, byte: number): ElementRecord | undefined {
		let best: ElementRecord | undefined;
		for (const r of this.source.extracted.elements) {
			if (r.path !== unit.path || !r.name) continue;
			if (byte < r.span.start_byte || byte >= r.span.end_byte) continue;
			if (!best || r.span.end_byte - r.span.start_byte < best.span.end_byte - best.span.start_byte)
				best = r;
		}
		return best;
	}

	private requirementAround(unit: UnitInfo, byte: number): ElementRecord | undefined {
		let best: ElementRecord | undefined;
		for (const r of this.source.extracted.elements) {
			if (r.path !== unit.path || !/^Requirement(Usage|Definition)$/.test(r.metaclass)) continue;
			if (byte < r.span.start_byte || byte >= r.span.end_byte) continue;
			if (!best || r.span.end_byte - r.span.start_byte < best.span.end_byte - best.span.start_byte)
				best = r;
		}
		return best;
	}
}

interface Located {
	unit: UnitInfo;
	/** Byte offset of the start in the person's text. */
	start: number;
	span: Span;
	/** The text, whitespace collapsed. */
	text: string;
}

const overlaps = (a: Span, b: Span) => a.start_byte < b.end_byte && b.start_byte < a.end_byte;

const lastSegment = (qualified: string) =>
	(qualified.split('::').pop() ?? qualified).replace(/^'|'$/g, '');

/** How many parts a usage stands for when it is a collection (`[4]`, `[2..*]`), else null. */
function collectionSize(header: string): string | null {
	const text = multiplicityOf(header);
	if (!text) return null;
	const [lower, upper = lower] = text.split('..').map((x) => x.trim());
	if (upper === '*') return lower === '*' || lower === '0' ? 'any number of' : `${lower} or more`;
	if (!/^\d+$/.test(upper!) || Number(upper) <= 1) return null;
	return lower === upper ? upper! : `${lower} to ${upper}`;
}

const KEYWORDS = new Set([
	'and',
	'or',
	'not',
	'xor',
	'implies',
	'if',
	'then',
	'else',
	'true',
	'false',
	'null',
	'as',
	'meta',
	'hastype',
	'istype',
	'all'
]);

/** The features an expression refers to: chains (`battery.mass`) and names, not calls or units. */
export function referencesIn(expression: string): string[] {
	const text = expression.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/\[[^\]]*\]/g, '');
	const out: string[] = [];
	for (const m of text.matchAll(
		/(?<![\w:.'])([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)(?![\w.(]|\s*(?:\(|::))/g
	)) {
		const reference = m[1]!;
		if (KEYWORDS.has(reference) || out.includes(reference)) continue;
		out.push(reference);
	}
	return out;
}

/** Dotted feature chains in an expression (`drone.endurance`), outside strings and unit brackets. */
export function chainsIn(expression: string): string[] {
	const text = expression.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/\[[^\]]*\]/g, '');
	const out: string[] = [];
	for (const m of text.matchAll(/(?<![\w:.'])[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+/g))
		if (!out.includes(m[0])) out.push(m[0]);
	return out;
}

/** The toolkit's JSON for a value, as the app's `Evaluated`. */
export function fromJson(json: string, id: string, extracted?: ExtractedModel): Evaluated {
	const value = JSON.parse(json) as unknown;
	return toEvaluated(value, id, extracted);
}

function toEvaluated(value: unknown, id: string, extracted?: ExtractedModel): Evaluated {
	if (typeof value === 'number') return { kind: 'number', value, unit: null };
	if (typeof value === 'boolean') return { kind: 'text', text: String(value) };
	if (typeof value === 'string') return { kind: 'text', text: JSON.stringify(value) };
	if (value === null || value === undefined) return { kind: 'none' };
	if (Array.isArray(value)) {
		if (!value.length) return { kind: 'none' };
		const items = value.map((v) => toEvaluated(v, '', extracted));
		if (items.some((i) => i.kind === 'undecided'))
			return { kind: 'undecided', reason: 'some of its values are not known' };
		return { kind: 'text', text: items.map(describe).join(', ') };
	}
	const object = value as Record<string, unknown>;
	if (object['@indeterminate'])
		return { kind: 'undecided', reason: 'it depends on values that are not known' };
	if (typeof object.value === 'number' && 'unit' in object)
		return {
			kind: 'number',
			value: object.value,
			unit: typeof object.unit === 'string' && object.unit ? object.unit : null
		};
	if (typeof object['@element'] === 'string') {
		const elementId = object['@element'];
		// The feature itself (or what it redefines): no value is bound.
		const record = extracted?.byId.get(id);
		if (elementId === id || (record && elementId === record.rootId)) return { kind: 'none' };
		const qualified = typeof object.qualifiedName === 'string' ? object.qualifiedName : '';
		return { kind: 'text', text: lastSegment(qualified) || elementId };
	}
	return { kind: 'text', text: JSON.stringify(value) };
}

function describe(value: Evaluated): string {
	switch (value.kind) {
		case 'number':
			return value.unit ? `${value.value} [${value.unit}]` : String(value.value);
		case 'text':
			return value.text;
		case 'none':
			return '';
		case 'undecided':
			return '?';
	}
}

/** The engine's reason, without its prefixes. */
function plainReason(message: string): string {
	return message
		.replace(/^(Error: )?/, '')
		.replace(/^unsupported for evaluation: /, 'the engine cannot evaluate this yet: ');
}

/**
 * `x <= 4 [kg]` (or `4 [kg] >= x`): the feature, the operator as seen from
 * the feature, and the limit.
 */
export function comparisonOf(
	constraint: string
): { feature: string; operator: string; limit: Quantity } | null {
	const parts = /^(.+?)\s*(<=|>=|<|>|==)\s*(.+)$/.exec(constraint.trim());
	if (!parts) return null;
	const [, left, op, right] = parts as unknown as [string, string, string, string];
	const chain = /^[A-Za-z_][\w.]*$/;
	const flip: Record<string, string> = { '<=': '>=', '>=': '<=', '<': '>', '>': '<', '==': '==' };
	const l = parseLiteral(left);
	const r = parseLiteral(right);
	if (chain.test(left.trim()) && r) return { feature: left.trim(), operator: op, limit: r };
	if (chain.test(right.trim()) && l)
		return { feature: right.trim(), operator: flip[op]!, limit: l };
	return null;
}

/** The limit a single comparison sets, and the margin to it, in the limit's unit. */
function addMargin(check: Check) {
	const comparison = comparisonOf(check.constraint);
	if (!comparison) return;
	const { feature, operator, limit } = comparison;
	check.limit = { feature, operator, value: limit.value, unit: limit.unit };
	const value = check.values.find((v) => v.feature === feature)?.value;
	if (value?.kind !== 'number') return;
	const inLimitUnit =
		limit.unit && value.unit
			? convert(value.value, value.unit, limit.unit)
			: !limit.unit && !value.unit
				? value.value
				: null;
	if (inLimitUnit === null || operator === '==') return;
	const margin = operator.startsWith('<') ? limit.value - inLimitUnit : inLimitUnit - limit.value;
	check.margin = {
		value: margin,
		unit: limit.unit,
		ratio: limit.value !== 0 ? margin / Math.abs(limit.value) : null
	};
}

/** What a verdict means, in a sentence. */
function explain(check: Check, vacuous: boolean): string {
	if (!check.checkable)
		return 'The requirement is stated in words only: it has no constraint to check.';
	const known = check.values.filter((v) => v.value.kind === 'number' || v.value.kind === 'text');
	const unknown = check.values.filter((v) => v.value.kind === 'undecided');
	const valueText = known.map((v) => `${v.feature} = ${show(v.value)}`).join(', ');
	const needs = check.limit
		? ` (needs ${SYMBOL[check.limit.operator] ?? check.limit.operator} ${formatQuantity(check.limit)})`
		: '';
	switch (check.status) {
		case 'satisfied':
			if (vacuous) return 'Met only because an assumption of the requirement does not hold.';
			return valueText ? `Met: ${valueText}${needs}.` : 'Met.';
		case 'violated':
			return valueText ? `Not met: ${valueText}${needs}.` : 'Not met.';
		case 'undecided': {
			const unresolved = /unresolved reference `([^`]+)`/.exec(check.detail);
			if (unresolved)
				return `\`${unresolved[1]}\` is not a feature of ${check.by ?? 'what the constraint is evaluated for'}, so the constraint cannot be evaluated.`;
			const unsupported = /unsupported for evaluation: ([^;)]+)/.exec(check.detail);
			const first = unknown[0];
			if (first?.value.kind === 'undecided' && /`/.test(first.value.reason))
				return `${first.feature} cannot be worked out: ${first.value.reason}.`;
			if (unknown.length)
				return `The engine could not work out ${unknown.map((v) => v.feature).join(', ')}${unsupported ? ` (${unsupported[1]!.trim()})` : ' from the model: a value it depends on is not known'}.`;
			if (unsupported) return `The engine cannot evaluate this yet: ${unsupported[1]!.trim()}.`;
			return 'Some values the constraint depends on are not known.';
		}
	}
}

const SYMBOL: Record<string, string> = { '<=': '≤', '>=': '≥', '<': '<', '>': '>', '==': '=' };

function show(value: Evaluated): string {
	if (value.kind === 'number')
		return formatQuantity(readable({ value: value.value, unit: value.unit }));
	return value.kind === 'text' ? value.text : '?';
}

/**
 * A session over the analysed texts with metadata annotations blanked out,
 * or null when there are none (the analysed session serves then).
 */
function withoutMetadata(source: EvaluationSource): TkSession | null {
	const { session, tk, library } = source;
	const units = JSON.parse(session.units()) as { unit: number; name: string; text: string }[];
	const byIndex = new Map(units.map((u) => [u.unit, u]));
	const cuts = new Map<string, [number, number][]>();
	const encoder = new TextEncoder();
	const bytesOf = new Map<string, Uint8Array>();
	for (const metadata of session.elementsOfMetaclass('MetadataUsage')) {
		try {
			if (session.isLibraryElement(metadata)) continue;
			const extent = session.memberExtent(metadata);
			if (!extent) continue;
			const site = JSON.parse(extent) as TkSite;
			const unit = byIndex.get(site.unit);
			if (!unit) continue;
			let bytes = bytesOf.get(unit.name);
			if (!bytes) bytesOf.set(unit.name, (bytes = encoder.encode(unit.text)));
			// Only annotations written as such: `#keyword` prefixes carry semantics (`#derivation`).
			const first = String.fromCharCode(bytes[site.start] ?? 0);
			const word = new TextDecoder().decode(bytes.subarray(site.start, site.start + 8));
			if (first !== '@' && !word.startsWith('metadata')) continue;
			const list = cuts.get(unit.name) ?? [];
			list.push([site.start, site.end]);
			cuts.set(unit.name, list);
		} finally {
			metadata.free();
		}
	}
	if (!cuts.size) return null;
	const decoder = new TextDecoder();
	const sources = units.map((u) => {
		const ranges = cuts.get(u.name);
		if (!ranges) return { name: u.name, text: u.text };
		const bytes = new Uint8Array(bytesOf.get(u.name)!);
		for (const [start, end] of ranges)
			for (let i = start; i < end && i < bytes.length; i++) if (bytes[i] !== 10) bytes[i] = 32;
		return { name: u.name, text: decoder.decode(bytes) };
	});
	try {
		return tk.Session.fromSourcesWithPreparedLibrary(JSON.stringify(sources), library);
	} catch {
		return null;
	}
}
