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
 * - **Values the app works out.** The toolkit 0.10 doesn't evaluate a
 *   value over a collection of parts whose members aren't given
 *   (`sum(rotors.mass)` with `part rotors : Rotor[4]`; deliberate, see
 *   docs/engine.md). While it doesn't, the app works such a value out
 *   itself: the expression is evaluated with `sim/expr.ts`, a `sum` over a
 *   fixed-size collection counts each part's value as many times as there
 *   are parts, and every other value comes from the toolkit. This only
 *   fills in a value the toolkit leaves undecided and only when a
 *   collection was the reason, so it stops by itself once the toolkit
 *   evaluates these; a test fails then, to remove it. Such values and
 *   verdicts carry `byApp` (internal). The same evaluation gives an
 *   attribute a usage inherits from its definition its value in the usage
 *   (`evaluate` on the definition's feature sees no usage values).
 *
 * Everything is cached per analysis (one `Evaluation` per built session).
 */
import {
	EvalError,
	evaluate as evaluateExpr,
	parseExpr,
	Quantity as ExprQuantity,
	type Expr,
	type Value
} from '#lib/sim/expr.ts';
import { convert, formatQuantity, parseLiteral, readable, type Quantity } from '../quantity';
import type { Check, CheckReport, CheckStatus, CheckValue, Evaluated, Span } from '../types';
import type { TkElement, TkLibrary, TkSession, TkSite, Toolkit } from './api';
import {
	multiplicityOf,
	type ElementRecord,
	type ExtractedModel,
	type TraceRecord,
	type UnitInfo
} from './model';

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
	/** Checks the app makes beside the toolkit's (metadata values, `views/annotationChecks.ts`). */
	more?: () => Check[];
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
	private byPath: Map<string, ElementRecord[]> | undefined;
	private satisfies: Map<string, TraceRecord[]> | undefined;
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

	/**
	 * Free the evaluation session until it is needed again (values already
	 * evaluated and the checks stay cached): on a large model it is as big as
	 * the analysed session, and the language server needs memory next.
	 */
	release() {
		this.free();
		this.opened = false;
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
			value =
				this.byApp(owner.qualifiedName, record.name) ??
				this.withCause(value, owner.qualifiedName, record.name);
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
			if (at > 0) {
				const [context, feature] = [qualifiedName.slice(0, at), qualifiedName.slice(at + 2)];
				value = this.byApp(context, feature) ?? this.withCause(value, context, feature);
			}
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
				return `\`${segment}\` stands for ${many} parts (\`${record!.header.replace(/\s+/g, ' ').trim()}\`), so \`${feature}\` has no single value`;
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

	// ---- Sums over collections, worked out by the app (see the top of the file) ----

	/** `feature`'s value in `context`, worked out by the app, or null when it can't or needn't. */
	private byApp(context: string, feature: string): Evaluated | null {
		const trace: Trace = { over: [], inherited: false };
		const value = this.appValue(context, feature, 0, trace);
		if (value === null || (!trace.over.length && !trace.inherited)) return null;
		const result = fromValue(value);
		if (!result) return null;
		if (!trace.over.length) return result;
		const parts = [...new Map(trace.over.map((c) => [c.name, c])).values()]
			.map((c) => `${c.count} \`${c.name}\``)
			.join(' and ');
		return { ...result, byApp: `the app added up the ${parts}` };
	}

	/**
	 * The value of `feature` (a name or a chain) in `context`: the toolkit's,
	 * else its expression evaluated here. Collections summed on the way are
	 * added to `trace.over`, and `trace.inherited` notes an expression a
	 * usage inherits from its definition (which `evaluate` on the
	 * definition's feature sees without the usage's values); null when it
	 * can't be worked out.
	 */
	private appValue(context: string, feature: string, depth: number, trace: Trace): Value | null {
		if (depth > 8) return null;
		const path = `${context}::${feature.replace(/\./g, '::')}`;
		const known = this.rawValueAt(path);
		const decided =
			known?.kind === 'number'
				? known.unit
					? new ExprQuantity(known.value, known.unit)
					: known.value
				: null;
		// An expression the element inherits is evaluated by the toolkit with the definition's
		// values (request 9): it is worked out here with the element's own, else the toolkit's stands.
		if (decided !== null && !this.inheritsExpression(path)) return decided;
		if (known && known.kind !== 'undecided' && decided === null) return null;
		const segments = feature.split('.');
		let scope = context;
		for (const segment of segments.slice(0, -1)) {
			// Through one part, not a collection: a collection only counts inside `sum`.
			const record = this.recordAt(`${scope}::${segment}`);
			if (!record || collectionCount(record.header) !== null) return decided;
			scope = `${scope}::${segment}`;
		}
		const record = this.recordAt(path);
		if (!record?.value) return decided;
		const owner = record.ownerId ? this.source.extracted.byId.get(record.ownerId) : undefined;
		if (owner?.qualifiedName !== scope) trace.inherited = true;
		let expr: Expr;
		try {
			expr = this.withSums(parseExpr(record.value), scope, depth, trace);
		} catch {
			return decided;
		}
		try {
			return evaluateExpr(expr, {
				get: (name) => this.appValue(scope, name, depth + 1, trace) ?? undefined
			});
		} catch (error) {
			if (error instanceof EvalError) return decided;
			throw error;
		}
	}

	/** Whether the feature at `path` has a value written as an expression in a definition it inherits from. */
	private inheritsExpression(path: string): boolean {
		const record = this.recordAt(path);
		if (!record?.value || !referencesIn(record.value).length) return false;
		const owner = record.ownerId ? this.source.extracted.byId.get(record.ownerId) : undefined;
		return !!owner?.qualifiedName && owner.qualifiedName !== path.slice(0, path.lastIndexOf('::'));
	}

	/**
	 * `feature`'s value for the element at `context` (a qualified name), with an
	 * expression it inherits worked out with the element's own values; null when
	 * it can't be worked out.
	 */
	valueFor(context: string, feature: string): Evaluated | null {
		const value = this.appValue(context, feature, 0, { over: [], inherited: false });
		return value === null ? null : fromValue(value);
	}

	/** `expr` with every `sum(parts.x)` over a fixed-size collection replaced by its total. */
	private withSums(expr: Expr, scope: string, depth: number, trace: Trace): Expr {
		const walk = (e: Expr): Expr => {
			switch (e.kind) {
				case 'call': {
					const [arg] = e.args;
					if (e.name.split('::').pop() === 'sum' && e.args.length === 1 && arg?.kind === 'name') {
						const total = this.collectionSum(arg.name, scope, depth, trace);
						if (total !== null) return { kind: 'literal', value: total };
					}
					return { ...e, args: e.args.map(walk) };
				}
				case 'binary':
					return { ...e, left: walk(e.left), right: walk(e.right) };
				case 'unary':
				case 'unit':
					return { ...e, operand: walk(e.operand) };
				case 'if':
					return { ...e, condition: walk(e.condition), then: walk(e.then), else: walk(e.else) };
				default:
					return e;
			}
		};
		return walk(expr);
	}

	/** `parts.x` summed over a collection of exactly n parts: n × each part's `x`. */
	private collectionSum(chain: string, scope: string, depth: number, trace: Trace): Value | null {
		const [first, ...rest] = chain.split('.');
		if (!first || !rest.length) return null;
		const record = this.recordAt(`${scope}::${first}`);
		const count = record ? collectionCount(record.header) : null;
		if (!record || count === null) return null;
		// Each part's value: as the collection gives it, else as its definition does.
		let each = this.appValue(`${scope}::${first}`, rest.join('.'), depth + 1, trace);
		const type = record.typeIds[0] ? this.source.extracted.byId.get(record.typeIds[0]) : undefined;
		if (each === null && type?.qualifiedName)
			each = this.appValue(type.qualifiedName, rest.join('.'), depth + 1, trace);
		if (each === null) return null;
		trace.over.push({ name: first, count });
		if (each instanceof ExprQuantity) return new ExprQuantity(each.value * count, each.unit);
		return typeof each === 'number' ? each * count : null;
	}

	/**
	 * A verdict the engine left undecided for want of a value the app worked
	 * out: each constraint evaluated with the check's values.
	 */
	private decideByApp(check: Check, constraints: string[]): void {
		const reasons = check.values.flatMap((v) =>
			v.value.kind === 'number' && v.value.byApp ? [v.value.byApp] : []
		);
		if (check.status !== 'undecided' || !reasons.length || !constraints.length) return;
		const values = new Map(check.values.map((v) => [v.feature, v.value]));
		const scope = {
			get: (name: string): Value | undefined => {
				const v = values.get(name);
				if (v?.kind !== 'number') return undefined;
				return v.unit ? new ExprQuantity(v.value, v.unit) : v.value;
			}
		};
		let met = true;
		for (const text of constraints) {
			try {
				const result = evaluateExpr(parseExpr(text.replace(/^\{|\}$/g, '').trim()), scope);
				if (typeof result !== 'boolean') return;
				met &&= result;
			} catch {
				return;
			}
		}
		check.status = met ? 'satisfied' : 'violated';
		check.byApp = reasons[0];
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
		const checks = [...this.mapReport(raw), ...(this.source.more?.() ?? [])];
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
		const trace = this.satisfiesIn(at.unit.path).find((t) => overlaps(t.at.span, at.span));
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
		if (!s.negated) this.decideByApp(check, constraintTexts);
		if (s.constraints.length === 1) addMargin(check);
		this.nameBySatisfier(check, requirement);
		check.explanation = explain(check, s.vacuous);
		return check;
	}

	/**
	 * A satisfy's values named as the design names them: `system.endurance`, the
	 * requirement's subject bound to `drone`, reads `drone.endurance`. Decided first,
	 * under the constraint's own names.
	 */
	private nameBySatisfier(check: Check, requirement: ElementRecord | undefined) {
		const subject = requirement && this.subjectOf(requirement);
		if (!subject || !check.by) return;
		const by = check.by;
		const rename = (feature: string) =>
			feature.startsWith(`${subject}.`) ? by + feature.slice(subject.length) : feature;
		check.values = check.values.map((v) => ({ ...v, feature: rename(v.feature) }));
		if (check.limit) check.limit = { ...check.limit, feature: rename(check.limit.feature) };
	}

	/** The name of a requirement's subject: its own, or its definition's (and theirs). */
	private subjectOf(requirement: ElementRecord): string | null {
		const seen = new Set<string>();
		for (let r: ElementRecord | undefined = requirement; r && !seen.has(r.id);) {
			seen.add(r.id);
			const id = r.id;
			const subject = this.source.extracted.elements.find(
				(e) => e.kind === 'subject' && e.parentId === id && e.name
			);
			if (subject) return subject.name;
			const next: string | undefined = r.typeIds[0] ?? r.generalIds[0];
			r = next ? this.source.extracted.byId.get(next) : undefined;
		}
		return null;
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
		this.decideByApp(check, [at.text]);
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
			if (value) return value.kind === 'none' ? { kind: 'undecided', reason: NO_VALUE } : value;
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
		for (const r of this.elementsIn(unit.path)) {
			if (!r.name) continue;
			if (byte < r.span.start_byte || byte >= r.span.end_byte) continue;
			if (!best || r.span.end_byte - r.span.start_byte < best.span.end_byte - best.span.start_byte)
				best = r;
		}
		return best;
	}

	/** The records of one file, in order (made on first use: per-file lookups, not scans of all). */
	private elementsIn(path: string): ElementRecord[] {
		if (!this.byPath) {
			this.byPath = new Map();
			for (const r of this.source.extracted.elements) {
				const list = this.byPath.get(r.path);
				if (list) list.push(r);
				else this.byPath.set(r.path, [r]);
			}
		}
		return this.byPath.get(path) ?? [];
	}

	/** The satisfy links of one file (made on first use). */
	private satisfiesIn(path: string): TraceRecord[] {
		if (!this.satisfies) {
			this.satisfies = new Map();
			for (const t of this.source.extracted.traces) {
				if (t.kind !== 'satisfy') continue;
				const list = this.satisfies.get(t.at.path);
				if (list) list.push(t);
				else this.satisfies.set(t.at.path, [t]);
			}
		}
		return this.satisfies.get(path) ?? [];
	}

	private requirementAround(unit: UnitInfo, byte: number): ElementRecord | undefined {
		let best: ElementRecord | undefined;
		for (const r of this.elementsIn(unit.path)) {
			if (!/^Requirement(Usage|Definition)$/.test(r.metaclass)) continue;
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

interface Collection {
	name: string;
	count: number;
}

interface Trace {
	/** Collections summed by the app. */
	over: Collection[];
	/** Whether an expression was inherited from a definition. */
	inherited: boolean;
}

/** How many parts a usage stands for when it is a collection of a fixed size (`[4]`), else null. */
function collectionCount(header: string): number | null {
	const text = multiplicityOf(header);
	if (!text) return null;
	const [lower, upper = lower] = text.split('..').map((x) => x.trim());
	if (lower !== upper || !/^\d+$/.test(upper!) || Number(upper) <= 1) return null;
	return Number(upper);
}

/** An expression's result as a number value, or null. */
function fromValue(value: Value): Extract<Evaluated, { kind: 'number' }> | null {
	if (value instanceof ExprQuantity)
		return { kind: 'number', value: value.value, unit: value.unit };
	return typeof value === 'number' ? { kind: 'number', value, unit: null } : null;
}

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
	// An exact fraction (`{"@rational": "1279/4500", "approx": 0.284}`), alone or with a unit.
	const approx = (v: unknown) =>
		v && typeof v === 'object' && '@rational' in v ? (v as { approx?: unknown }).approx : v;
	if (typeof approx(object) === 'number')
		return { kind: 'number', value: approx(object) as number, unit: null };
	if (typeof approx(object.value) === 'number' && 'unit' in object)
		return {
			kind: 'number',
			value: approx(object.value) as number,
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
			// Declared but never given a value (`attribute mass :> ISQ::mass;`): say what to do.
			const unset = unknown.filter(
				(v) => v.value.kind === 'undecided' && v.value.reason === NO_VALUE
			);
			if (unset.length && unset.length === unknown.length && !unsupported)
				return `${unset.map((v) => v.feature).join(', ')} ${unset.length === 1 ? 'has' : 'have'} no value yet: give ${unset.length === 1 ? 'it one' : 'them one'} and the check will say whether it is met.`;
			if (first?.value.kind === 'undecided' && /`/.test(first.value.reason))
				return `${first.feature} cannot be worked out: ${first.value.reason}.`;
			if (unknown.length)
				return `The engine could not work out ${unknown.map((v) => v.feature).join(', ')}${unsupported ? ` (${unsupported[1]!.trim()})` : ' from the model: a value it depends on is not known'}.`;
			if (unsupported) return `The engine cannot evaluate this yet: ${unsupported[1]!.trim()}.`;
			return 'Some values the constraint depends on are not known.';
		}
	}
}

/** Why a value a check reads is not known, when it simply has none. */
const NO_VALUE = 'it has no value';

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
