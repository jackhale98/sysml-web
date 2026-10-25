/**
 * Trade studies: analyses typed by the standard library's
 * `TradeStudies::TradeStudy`, evaluated. For each alternative of the
 * study's subject, the evaluation function's own attributes (the criteria:
 * `endurance`, `massMargin`, `price`) and its result (the score); the
 * alternative the objective selects (`MaximizeObjective`: the highest score,
 * `MinimizeObjective`: the lowest); and the alternative the design uses
 * today (one that is a part of the design, `drone.battery`, or that a part
 * of the design is bound to, `engine :> engineChoice = engineChoice::v6`).
 *
 * **What the toolkit decides.** The alternatives (the subject's value),
 * every value an alternative or the design binds (`pack.mass`,
 * `drone.hoverPower`), every calculation invoked with the values worked
 * out (`HoverEndurance(177.6 [W*h], 424.1 [W])`, a `query`), and a score
 * outright when it can evaluate `study.evaluationFunction(alternative)`.
 *
 * **What the app works out** (`byApp`, internal), because the toolkit 0.10
 * doesn't:
 * - an evaluation function's attributes for one alternative: the toolkit
 *   evaluates a calculation's result with its parameters bound, not the
 *   attributes in between, and not a feature chain through a part another
 *   package owns (`drone.takeOffMass` in the study is indeterminate);
 * - a feature an alternative inherits whose expression reads its other
 *   features (`usableEnergy = capacity * usableFraction`, with the variant's
 *   capacity): `evaluate` on the inherited feature uses the definition's
 *   values;
 * - the selection: `TradeStudy::selectedAlternative` (a `selectOne` over a
 *   requirement invoked with an argument) and `TradeStudyObjective::best`
 *   (`maximize` over a calculation passed as a parameter) are not
 *   evaluated, so the app takes the best score by the objective's kind.
 *
 * Expressions are evaluated with `sim/expr.ts`: names are looked up as the
 * calculation's parameters and own attributes, then as features of the
 * element the expression belongs to, then as the names visible where it is
 * written (resolved by the toolkit, imports included).
 */
import {
	EvalError,
	evaluate as evaluateExpr,
	parseExpr,
	Quantity as ExprQuantity,
	type Expr,
	type Value
} from '#lib/sim/expr.ts';
import {
	convert,
	formatMagnitude,
	formatQuantity,
	parseUnit,
	readable,
	type Quantity
} from '../quantity';
import type { Evaluated, TradeAlternative, TradeCriterion, TradeStudy } from '../types';
import type { Evaluation } from './evaluation';
import { referencesIn } from './evaluation';
import type { ElementRecord } from './model';
import type { ViewContext } from './views/context';

/** An element as a value: a part an alternative or a chain names (`drone.battery`). */
interface Ref {
	ref: string;
}

type AppValue = Value | Ref;

const isRef = (v: unknown): v is Ref =>
	typeof v === 'object' && v !== null && 'ref' in (v as object);

/** Where an expression's names come from. */
interface Frame {
	/** Parameters bound to values or elements. */
	bound: Map<string, AppValue>;
	/** The frame's own attributes (a calculation's), evaluated on demand. */
	locals: Map<string, ElementRecord>;
	/** Values computed for `locals`, and overrides (to measure what a criterion does to the score). */
	values: Map<string, AppValue | null>;
	/** The element whose features names refer to first (the expression's owner). */
	self: string | null;
	/** The namespace the expression is written in, for every other name. */
	lexical: string;
}

/** The functions `sim/expr.ts` evaluates itself. */
const BUILTINS = new Set([
	'abs',
	'floor',
	'ceil',
	'round',
	'sqrt',
	'min',
	'max',
	'sum',
	'product',
	'mean',
	'avg',
	'rss',
	'count',
	'clamp',
	'convert'
]);

const MAX_DEPTH = 24;

export class TradeStudies {
	private readonly ctx: ViewContext;
	private readonly evaluation: Evaluation;
	private result: TradeStudy[] | undefined;
	/** Why the last value could not be worked out (the first reason found). */
	private why: string | null = null;
	private depth = 0;
	private readonly calls = new Map<string, Value | null>();

	constructor(ctx: ViewContext, evaluation: Evaluation) {
		this.ctx = ctx;
		this.evaluation = evaluation;
	}

	/** Every trade study of the project's files, evaluated (once per analysis). */
	all(): TradeStudy[] {
		this.result ??= this.studies().flatMap((r) => {
			const study = this.study(r);
			return study ? [study] : [];
		});
		return this.result;
	}

	/** The analyses that are trade studies, in declaration order. */
	private studies(): ElementRecord[] {
		const session = this.evaluation.session;
		const base = session.resolve('TradeStudies::TradeStudy');
		if (!base) return [];
		try {
			return this.ctx.records.filter((r) => {
				if (!this.ctx.isContent(r) || r.isDefinition || !/^Analysis/.test(r.metaclass))
					return false;
				const handle = session.elementById(r.id);
				if (!handle) return false;
				try {
					return session.conforms(handle, base);
				} finally {
					handle.free();
				}
			});
		} finally {
			base.free();
		}
	}

	private study(record: ElementRecord): TradeStudy | null {
		const qualified = record.qualifiedName;
		if (!qualified) return null;
		const members = this.membersWithInherited(record);
		const subject = members.find((m) => m.kind === 'subject');
		const objective = members.find((m) => m.kind === 'objective');
		const evaluator = members.find((m) => m.kind === 'calc' && m.name === 'evaluationFunction');
		const notes: string[] = [];
		const byApp: string[] = [];

		const alternatives = this.alternatives(record, subject, notes);
		const goal = objective ? this.goalOf(objective) : null;
		if (!goal)
			notes.push(
				`${objective ? 'Its objective is neither' : 'The study doesn’t say how to select: give it'} a MaximizeObjective or a MinimizeObjective${objective ? ', so nothing is selected' : ''}.`
			);

		// The evaluation function: its parameter (the alternative), its attributes, its result.
		const own = evaluator ? this.ctx.ownedBy(evaluator.id) : [];
		const parameter = own.find((m) => m.direction === 'in');
		const result = own.find((m) => m.kind === 'return');
		const criteriaRecords = own.filter(
			(m) => m.kind === 'attribute' && m.name && m.direction === null
		);
		if (!evaluator) notes.push('The study has no evaluation function, so nothing is scored.');

		const frames = alternatives.map((alternative) =>
			this.frame(evaluator, parameter, criteriaRecords, alternative.qualifiedName)
		);
		const values: Evaluated[][] = criteriaRecords.map((c) =>
			frames.map((frame) => this.evaluated(() => this.local(frame, c.name!), c))
		);
		if (criteriaRecords.length) byApp.push("the evaluation function's attributes");

		// The score: the toolkit's, when it evaluates the function for the alternative.
		const scores: Evaluated[] = alternatives.map((alternative, i) => {
			const decided = evaluator
				? this.query(
						`${qualified}.${evaluator.written ?? 'evaluationFunction'}(${alternative.qualifiedName})`
					)
				: null;
			if (typeof decided === 'number') return { kind: 'number', value: decided, unit: null };
			if (decided instanceof ExprQuantity)
				return { kind: 'number', value: decided.value, unit: decided.unit };
			if (!result?.value)
				return { kind: 'undecided', reason: 'the evaluation function has no result' };
			const score = this.evaluated(() => this.expression(frames[i]!, result.value!), result);
			if (score.kind === 'number' && !byApp.includes('scores')) byApp.push('scores');
			return score;
		});

		const criteria: TradeCriterion[] = criteriaRecords.map((c, i) => ({
			name: c.name!,
			elementId: c.id,
			file: c.path,
			line: c.span.start_row,
			doc: c.docs.length ? c.docs.join(' ').replace(/\s+/g, ' ').trim() : null,
			values: values[i]!,
			shown: shownInOneUnit(values[i]!),
			weight: null,
			scores: null,
			better: null,
			best: []
		}));
		if (result?.value) this.weigh(result, frames, criteria, goal);

		// Headings: `batteryOptions::lithiumPolymer` reads as `lithiumPolymer`, unless two would read alike.
		const short = alternatives.map((a) => lastSegment(a.label));
		const names = short.map((s, i) =>
			short.filter((x) => x === s).length > 1 ? alternatives[i]!.label : s
		);

		// The ranking and the selection, with the scores in one unit (0.6 kg is more than 500 g).
		const scoreUnit = scores.find((s) => s.kind === 'number')?.unit ?? null;
		const numbers = scores.map((s) => {
			if (s.kind !== 'number') return null;
			if (s.unit === scoreUnit) return s.value;
			return s.unit && scoreUnit ? convert(s.value, s.unit, scoreUnit) : null;
		});
		const apart = scores.some((s, i) => s.kind === 'number' && numbers[i] === null);
		const ranked = numbers
			.map((n, i) => ({ n, i }))
			.filter((x): x is { n: number; i: number } => x.n !== null)
			.toSorted((a, b) => (goal === 'minimize' ? a.n - b.n : b.n - a.n));
		const ranks: (number | null)[] = numbers.map(() => null);
		ranked.forEach((x, k) => {
			const previous = ranked[k - 1];
			ranks[x.i] = previous && same(previous.n, x.n) ? ranks[previous.i]! : k + 1;
		});
		const top = ranked[0];
		const best = goal && top ? ranked.filter((x) => same(x.n, top.n)).map((x) => x.i) : [];
		let selected: number | null = null;
		if (goal && ranked.length && ranked.length < alternatives.length)
			notes.push(
				apart
					? `The scores are in units that don’t convert to one another (${[...new Set(scores.flatMap((s) => (s.kind === 'number' && s.unit ? [`\`${s.unit}\``] : [])))].join(', ')}), so nothing is selected.`
					: 'Some alternatives have no score, so nothing is selected.'
			);
		else if (best.length > 1)
			notes.push(
				`${best.map((i) => names[i]!).join(' and ')} have the same score: the objective doesn’t decide between them.`
			);
		else if (best.length === 1) {
			selected = best[0]!;
			byApp.push('the selected alternative');
		}

		return {
			name: record.name ?? lastSegment(qualified),
			qualifiedName: qualified,
			elementId: record.id,
			file: record.path,
			line: record.span.start_row,
			objective: goal,
			alternatives: alternatives.map((a, i) => ({
				...a.shown,
				name: names[i]!,
				score: scores[i]!,
				rank: ranks[i]!
			})),
			criteria,
			selected,
			best,
			current: this.current(alternatives),
			note: notes.length ? notes.join(' ') : null,
			...(byApp.length ? { byApp: `the app worked out ${byApp.join(', ')}` } : {})
		};
	}

	// ---- The study's parts ----

	/** The members of an analysis and of the analysis defs it is typed by (its own first). */
	private membersWithInherited(record: ElementRecord): ElementRecord[] {
		const out = [...this.ctx.ownedBy(record.id)];
		const kinds = new Set(out.map((m) => `${m.kind}:${m.name ?? ''}`));
		for (const id of this.ctx.supers(record.id))
			for (const m of this.ctx.ownedBy(id)) {
				const key = `${m.kind}:${m.name ?? ''}`;
				if (kinds.has(key)) continue;
				kinds.add(key);
				out.push(m);
			}
		return out;
	}

	/** `maximize` or `minimize`, by the objective's type. */
	private goalOf(objective: ElementRecord): 'maximize' | 'minimize' | null {
		const session = this.evaluation.session;
		const handle = session.elementById(objective.id);
		if (!handle) return null;
		try {
			for (const [goal, name] of [
				['maximize', 'TradeStudies::MaximizeObjective'],
				['minimize', 'TradeStudies::MinimizeObjective']
			] as const) {
				const base = session.resolve(name);
				if (!base) continue;
				try {
					if (session.conforms(handle, base)) return goal;
				} finally {
					base.free();
				}
			}
			return null;
		} finally {
			handle.free();
		}
	}

	/**
	 * The alternatives the subject is bound to: as the toolkit evaluates the
	 * subject, else each reference of the list as written, resolved.
	 */
	private alternatives(
		study: ElementRecord,
		subject: ElementRecord | undefined,
		notes: string[]
	): Candidate[] {
		if (!subject?.value) {
			notes.push('The study’s subject lists no alternatives (`subject : T = (a, b);`).');
			return [];
		}
		const written = splitList(subject.value);
		let paths: string[] = [];
		const raw = this.rawElements(subject.id);
		if (raw && raw.length === written.length) paths = raw;
		else {
			const frame = this.emptyFrame(study.qualifiedName!);
			for (const text of written) {
				if (/^all\s/.test(text)) {
					notes.push(`\`${text}\` (all the variants) is not supported yet: list them.`);
					return [];
				}
				const value = this.lookup(frame, text.replace(/\s+/g, ''));
				if (!isRef(value)) {
					notes.push(`\`${text}\` does not name a part of the model.`);
					return [];
				}
				paths.push(value.ref);
			}
		}
		return paths.map((path, i) => {
			const record = this.recordAt(path);
			const label = (written[i] ?? lastSegment(path)).replace(/\s+/g, '');
			const alternative: Omit<TradeAlternative, 'score' | 'rank' | 'name'> = {
				label,
				qualifiedName: path,
				elementId: record?.id ?? null,
				file: record?.path ?? null,
				line: record?.span.start_row ?? 0,
				doc: record?.docs.length ? record.docs.join(' ').replace(/\s+/g, ' ').trim() : null
			};
			return { qualifiedName: path, record, shown: alternative, label };
		});
	}

	/** The elements a feature's value refers to, as the toolkit evaluates it (null when it can't). */
	private rawElements(id: string): string[] | null {
		const session = this.evaluation.session;
		const handle = session.elementById(id);
		if (!handle) return null;
		try {
			const value = JSON.parse(session.evaluate(handle)) as unknown;
			if (!Array.isArray(value)) return null;
			const out: string[] = [];
			for (const item of value) {
				const qn = (item as { qualifiedName?: unknown })?.qualifiedName;
				if (typeof qn !== 'string') return null;
				out.push(qn);
			}
			return out;
		} catch {
			return null;
		} finally {
			handle.free();
		}
	}

	/**
	 * The alternative the design uses: one that is a part of the design (not
	 * a variant), or one a part of the design is bound to.
	 */
	private current(alternatives: Candidate[]): number | null {
		const designPart = alternatives.findIndex((a) => {
			const owner = a.record?.ownerId ? this.ctx.byId.get(a.record.ownerId) : undefined;
			return (
				!!owner &&
				owner.kind === 'part' &&
				!owner.isDefinition &&
				a.record?.membership !== 'VariantMembership' &&
				!/^\s*variation\b/.test(owner.header)
			);
		});
		if (designPart >= 0) return designPart;
		const paths = new Map(alternatives.map((a, i) => [a.qualifiedName, i]));
		for (const r of this.ctx.records) {
			if (!this.ctx.isContent(r) || r.kind !== 'part' || r.isDefinition || !r.value) continue;
			if (!/^[\w:'.\s]+$/.test(r.value) || r.membership === 'VariantMembership') continue;
			const owner = r.ownerId ? this.ctx.byId.get(r.ownerId) : undefined;
			const value = this.lookup(this.emptyFrame(owner?.qualifiedName ?? ''), r.value.trim());
			if (isRef(value) && paths.has(value.ref)) return paths.get(value.ref)!;
		}
		return null;
	}

	// ---- Weights and directions ----

	/**
	 * When the score is a weighted sum (`0.5 * enduranceScore + …`, written
	 * in the result or in the calculation it invokes), each criterion's
	 * weight and its score before weighting; and for every criterion the
	 * score reads, whether a higher or a lower value is better (gives a
	 * higher score, or a lower one for a MinimizeObjective).
	 */
	private weigh(
		result: ElementRecord,
		frames: Frame[],
		criteria: TradeCriterion[],
		goal: 'maximize' | 'minimize' | null
	) {
		let ast: Expr;
		try {
			ast = parseExpr(result.value!);
		} catch {
			return;
		}
		const byName = new Map(criteria.map((c) => [c.name, c]));
		// Inside a calculation the result invokes with criteria as arguments.
		let terms: { weight: number; name: string }[] | null = null;
		let scoring: {
			calc: ElementRecord;
			params: ElementRecord[];
			argOf: Map<string, string>;
		} | null = null;
		if (ast.kind === 'call' && !BUILTINS.has(lastSegment(ast.name))) {
			const calc = this.calcNamed(frames[0]?.lexical ?? '', ast.name);
			if (calc) {
				const params = this.parameters(calc);
				const argOf = new Map<string, string>();
				ast.args.forEach((arg, i) => {
					if (arg.kind === 'name' && byName.has(arg.name) && params[i]?.name)
						argOf.set(params[i]!.name!, arg.name);
				});
				const ret = this.ctx.ownedBy(calc.id).find((m) => m.kind === 'return');
				if (ret?.value) {
					scoring = { calc, params, argOf };
					try {
						terms = weightedTerms(parseExpr(ret.value));
					} catch {
						terms = null;
					}
				}
			}
		} else terms = weightedTerms(ast);

		if (terms) {
			for (const { weight, name } of terms) {
				// `name` is a criterion, a parameter fed by one, or an attribute that reads one.
				let criterion: string | undefined;
				let normalised: ElementRecord | undefined;
				if (scoring) {
					const local = this.ctx.ownedBy(scoring.calc.id).find((m) => m.name === name);
					if (local?.direction === 'in') criterion = scoring.argOf.get(name);
					else if (local?.value) {
						const read = referencesIn(local.value).filter((r) => scoring!.argOf.has(r));
						if (read.length === 1) {
							criterion = scoring.argOf.get(read[0]!);
							normalised = local;
						}
					}
				} else if (byName.has(name)) criterion = name;
				const target = criterion ? byName.get(criterion) : undefined;
				if (!target) continue;
				target.weight = weight;
				if (normalised && scoring) {
					const calc = scoring.calc;
					target.scores = frames.map((frame) => {
						const args = scoring!.params.map((p) => {
							const from = p.name ? scoring!.argOf.get(p.name) : undefined;
							return from ? this.local(frame, from) : null;
						});
						if (args.some((a) => a === null)) return null;
						const inner = this.calcFrame(calc, args as AppValue[]);
						const value = this.local(inner, normalised!.name!);
						return typeof value === 'number' ? value : null;
					});
				}
			}
		}

		// Directions: nudge each criterion the score reads and see which way the score moves.
		const read = new Set(referencesIn(result.value!));
		for (const criterion of criteria) {
			if (!read.has(criterion.name)) continue;
			let up = 0;
			let down = 0;
			frames.forEach((frame, i) => {
				const base = criterion.values[i];
				if (base?.kind !== 'number') return;
				const before = this.scoreWith(frame, result.value!, criterion.name, null);
				const nudged = base.value === 0 ? 1e-3 : base.value * 1.001;
				const value = base.unit ? new ExprQuantity(nudged, base.unit) : nudged;
				const after = this.scoreWith(frame, result.value!, criterion.name, value);
				if (before === null || after === null || same(before, after)) return;
				// Up: a higher value gives a better score (a lower one, for a MinimizeObjective).
				const better = goal === 'minimize' ? after < before : after > before;
				if (better === nudged > base.value) up++;
				else down++;
			});
			criterion.better = up && !down ? 'higher' : down && !up ? 'lower' : null;
			const known = criterion.values
				.map((v, i) => ({ v: v.kind === 'number' ? inBase(v) : null, i }))
				.filter((x): x is { v: number; i: number } => x.v !== null);
			if (criterion.better && known.length > 1) {
				const pick = criterion.better === 'higher' ? Math.max : Math.min;
				const best = pick(...known.map((x) => x.v));
				criterion.best = known.filter((x) => same(x.v, best)).map((x) => x.i);
				if (criterion.best.length === known.length) criterion.best = [];
			}
		}
	}

	/** The score with one criterion replaced (null: as computed). */
	private scoreWith(
		frame: Frame,
		result: string,
		name: string,
		value: AppValue | null
	): number | null {
		const values = new Map(frame.values);
		if (value !== null) values.set(name, value);
		const nudged: Frame = { ...frame, values };
		const score = this.attempt(() => this.expression(nudged, result));
		return typeof score === 'number' ? score : score instanceof ExprQuantity ? score.value : null;
	}

	// ---- Evaluation ----

	private emptyFrame(lexical: string): Frame {
		return { bound: new Map(), locals: new Map(), values: new Map(), self: null, lexical };
	}

	/** The evaluation function's frame for one alternative. */
	private frame(
		evaluator: ElementRecord | undefined,
		parameter: ElementRecord | undefined,
		criteria: ElementRecord[],
		alternative: string
	): Frame {
		const frame = this.emptyFrame(evaluator?.qualifiedName ?? '');
		if (parameter?.name) frame.bound.set(parameter.name, { ref: alternative });
		// The library's name for it works too.
		frame.bound.set('alternative', { ref: alternative });
		for (const c of criteria) if (c.name) frame.locals.set(c.name, c);
		return frame;
	}

	/** A calculation's frame with its parameters bound, in order. */
	private calcFrame(calc: ElementRecord, args: AppValue[]): Frame {
		const frame = this.emptyFrame(calc.qualifiedName ?? '');
		this.parameters(calc).forEach((p, i) => {
			if (p.name && i < args.length) frame.bound.set(p.name, args[i]!);
		});
		for (const m of this.ctx.ownedBy(calc.id))
			if (m.kind === 'attribute' && m.name && m.direction === null) frame.locals.set(m.name, m);
		return frame;
	}

	private parameters(calc: ElementRecord): ElementRecord[] {
		return this.ctx.ownedBy(calc.id).filter((m) => m.direction === 'in');
	}

	/** A frame attribute's value, computed once. */
	private local(frame: Frame, name: string): AppValue | null {
		if (frame.values.has(name)) return frame.values.get(name)!;
		const record = frame.locals.get(name);
		if (!record?.value) return null;
		frame.values.set(name, null); // a cycle reads as unknown
		const value = this.attempt(() => this.expression(frame, record.value!));
		frame.values.set(name, value);
		return value;
	}

	/** Run an evaluation, keeping the first reason it fails for. */
	private attempt(run: () => AppValue | null): AppValue | null {
		try {
			return run();
		} catch (error) {
			if (error instanceof EvalError) {
				this.why ??= error.message;
				return null;
			}
			throw error;
		}
	}

	/** A value for the view: a number with its unit, or why it isn't known. */
	private evaluated(run: () => AppValue | null, record: ElementRecord): Evaluated {
		this.why = null;
		const value = this.attempt(run);
		if (typeof value === 'number') return { kind: 'number', value, unit: null };
		if (value instanceof ExprQuantity)
			return { kind: 'number', value: value.value, unit: value.unit };
		if (typeof value === 'boolean' || typeof value === 'string')
			return { kind: 'text', text: String(value) };
		return {
			kind: 'undecided',
			reason: this.why ?? `\`${record.name ?? 'it'}\` could not be worked out`
		};
	}

	/** An expression's value in a frame. */
	private expression(frame: Frame, text: string): AppValue | null {
		if (++this.depth > MAX_DEPTH) {
			this.depth--;
			throw new EvalError('the values refer to each other too deeply');
		}
		try {
			let ast: Expr;
			try {
				ast = parseExpr(text);
			} catch {
				throw new EvalError(
					`\`${text.replace(/\s+/g, ' ').trim()}\` is not an expression the app reads`
				);
			}
			return this.evaluateAst(frame, ast);
		} finally {
			this.depth--;
		}
	}

	private evaluateAst(frame: Frame, ast: Expr): AppValue | null {
		if (ast.kind === 'name') return this.lookup(frame, ast.name);
		if (ast.kind === 'call' && !BUILTINS.has(lastSegment(ast.name))) return this.invoke(frame, ast);
		const lowered = this.lower(frame, ast);
		return plain(
			evaluateExpr(lowered, {
				get: (name) => {
					const value = this.lookup(frame, name);
					if (value === null || isRef(value)) return undefined;
					return value;
				}
			})
		);
	}

	/** `ast` with each call of a calculation of the model replaced by its value. */
	private lower(frame: Frame, ast: Expr): Expr {
		switch (ast.kind) {
			case 'call': {
				if (!BUILTINS.has(lastSegment(ast.name))) {
					const value = this.invoke(frame, ast);
					if (value === null || isRef(value))
						throw new EvalError(`\`${ast.name}(…)\` could not be worked out`);
					return { kind: 'literal', value };
				}
				return { ...ast, args: ast.args.map((a) => this.lower(frame, a)) };
			}
			case 'binary':
				return { ...ast, left: this.lower(frame, ast.left), right: this.lower(frame, ast.right) };
			case 'unary':
			case 'unit':
				return { ...ast, operand: this.lower(frame, ast.operand) };
			case 'if':
				return {
					...ast,
					condition: this.lower(frame, ast.condition),
					then: this.lower(frame, ast.then),
					else: this.lower(frame, ast.else)
				};
			default:
				return ast;
		}
	}

	/** A calculation of the model, invoked: by the toolkit with the arguments' values, else here. */
	private invoke(frame: Frame, call: Extract<Expr, { kind: 'call' }>): AppValue | null {
		const calc = this.calcNamed(frame.lexical, call.name);
		if (!calc?.qualifiedName)
			throw new EvalError(`\`${call.name}\` is not a calculation of the model`);
		const args = call.args.map((a) => this.evaluateAst(frame, a));
		if (args.some((a) => a === null))
			throw new EvalError(`an argument of \`${call.name}\` could not be worked out`);
		const texts = (args as AppValue[]).map(literalText);
		if (texts.every((t): t is string => t !== null)) {
			const key = `${calc.qualifiedName}(${texts.join(', ')})`;
			if (!this.calls.has(key)) this.calls.set(key, this.query(key));
			const decided = this.calls.get(key)!;
			if (decided !== null) return decided;
		}
		// The toolkit couldn't: the calculation's result, evaluated here.
		const definition = calc.isDefinition
			? calc
			: (this.ctx.byId.get(calc.typeIds[0] ?? '') ?? calc);
		const ret = this.ctx.ownedBy(definition.id).find((m) => m.kind === 'return');
		if (!ret?.value) throw new EvalError(`\`${call.name}\` has no result to evaluate`);
		return this.expression(this.calcFrame(definition, args as AppValue[]), ret.value);
	}

	private calcNamed(lexical: string, name: string): ElementRecord | undefined {
		const path = this.resolveName(lexical, name);
		const record = path ? this.recordAt(path) : undefined;
		return record && /^Calculation/.test(record.metaclass) ? record : undefined;
	}

	/**
	 * A name's value in a frame: a parameter, an attribute of the frame, a
	 * feature of the frame's element, else what the name resolves to where
	 * the expression is written; then each `.feature` of the chain.
	 */
	private lookup(frame: Frame, name: string): AppValue | null {
		const segments = name.replace(/^self\./, '').split('.');
		const first = segments[0]!;
		let value: AppValue | null;
		if (frame.values.has(first) && !frame.locals.has(first)) value = frame.values.get(first)!;
		else if (frame.bound.has(first)) value = frame.bound.get(first)!;
		else if (frame.locals.has(first)) value = this.local(frame, first);
		else if (frame.self && !first.includes('::') && this.hasFeature(frame.self, first))
			value = this.feature(frame.self, first);
		else {
			const path = this.resolveName(frame.lexical, first);
			if (!path) throw new EvalError(`\`${first}\` is not a name the app can find`);
			value = this.elementValue(path);
		}
		for (const segment of segments.slice(1)) {
			if (!isRef(value))
				throw new EvalError(
					`\`${name}\`: \`${segment}\` is read from something that is not a part`
				);
			value = this.feature(value.ref, segment);
		}
		return value;
	}

	/** An element named by its path: a part as itself, an attribute as its value. */
	private elementValue(path: string): AppValue | null {
		const record = this.recordAt(path);
		if (record && record.kind === 'attribute') {
			const at = path.lastIndexOf('::');
			return at > 0 ? this.feature(path.slice(0, at), path.slice(at + 2)) : this.toolkitValue(path);
		}
		return { ref: path };
	}

	private hasFeature(owner: string, name: string): boolean {
		const record = this.recordAt(owner);
		if (!record) return false;
		return [record.id, ...this.ctx.supers(record.id)].some((id) =>
			this.ctx.ownedBy(id).some((m) => m.name === name && !m.isDefinition)
		);
	}

	/**
	 * Feature `name` of the element at `owner`: its own value as the toolkit
	 * evaluates it; an inherited value written as an expression, evaluated
	 * here with the owner's features (the toolkit would use the definition's).
	 */
	private feature(owner: string, name: string): AppValue | null {
		const path = `${owner}::${name}`;
		const record = this.recordAt(owner);
		if (!record) return this.toolkitValue(path);
		const own = this.ctx.ownedBy(record.id).find((m) => m.name === name && !m.isDefinition);
		if (own && own.kind !== 'attribute') return { ref: path };
		if (own?.value) {
			const decided = this.toolkitValue(path);
			if (decided !== null) return decided;
			return this.expression(this.featureFrame(owner, own), own.value);
		}
		// Inherited: the nearest declaration that gives a value.
		let declaration: ElementRecord | undefined;
		for (const id of this.ctx.supers(record.id)) {
			const found = this.ctx.ownedBy(id).find((m) => m.name === name && !m.isDefinition);
			if (!found) continue;
			declaration ??= found;
			if (found.value !== null || found.kind !== 'attribute') {
				declaration = found;
				break;
			}
		}
		if (!declaration) {
			// A library feature (`mass` of ISQ): what the toolkit says.
			const decided = this.toolkitValue(path);
			if (decided === null)
				throw new EvalError(`\`${name}\` is not a feature of \`${lastSegment(owner)}\``);
			return decided;
		}
		if (declaration.kind !== 'attribute') return { ref: path };
		if (!declaration.value)
			throw new EvalError(`\`${name}\` has no value in \`${lastSegment(owner)}\``);
		if (!referencesIn(declaration.value).length) return this.toolkitValue(path);
		return this.expression(this.featureFrame(owner, declaration), declaration.value);
	}

	private featureFrame(owner: string, declaration: ElementRecord): Frame {
		const at = declaration.qualifiedName?.lastIndexOf('::') ?? -1;
		const lexical = at > 0 ? declaration.qualifiedName!.slice(0, at) : owner;
		return { ...this.emptyFrame(lexical), self: owner };
	}

	/** The toolkit's value of the element at a path, or null when it has none. */
	private toolkitValue(path: string): Value | null {
		const value = this.evaluation.valueAt(path);
		if (!value) return null;
		if (value.kind === 'number')
			return value.unit ? new ExprQuantity(value.value, value.unit) : value.value;
		if (value.kind === 'text' && (value.text === 'true' || value.text === 'false'))
			return value.text === 'true';
		if (value.kind === 'undecided') this.why ??= value.reason;
		return null;
	}

	/**
	 * The path of the element a name means where an expression is written:
	 * looked up from the innermost namespace outwards (the toolkit follows
	 * imports and inherited members), then from the root.
	 */
	private resolveName(lexical: string, name: string): string | null {
		const session = this.evaluation.session;
		const scopes: string[] = [];
		for (let at = lexical; at; at = at.includes('::') ? at.slice(0, at.lastIndexOf('::')) : '')
			scopes.push(at);
		for (const scope of [...scopes, '']) {
			const handle = session.resolve(scope ? `${scope}::${name}` : name);
			if (!handle) continue;
			try {
				return session.qualifiedName(handle) ?? (scope ? `${scope}::${name}` : name);
			} finally {
				handle.free();
			}
		}
		return null;
	}

	private recordAt(path: string): ElementRecord | undefined {
		const session = this.evaluation.session;
		const handle = session.resolve(path);
		if (!handle) return undefined;
		try {
			return this.ctx.byId.get(session.elementId(handle));
		} finally {
			handle.free();
		}
	}

	/** An expression the toolkit evaluates at the root (null when it can't). */
	private query(expression: string): Value | null {
		try {
			return fromToolkit(JSON.parse(this.evaluation.session.query(expression)) as unknown);
		} catch {
			return null;
		}
	}
}

interface Candidate {
	qualifiedName: string;
	record: ElementRecord | undefined;
	label: string;
	shown: Omit<TradeAlternative, 'score' | 'rank' | 'name'>;
}

/** The toolkit's JSON for a value, as an expression value (null when it isn't a number or a Boolean). */
function fromToolkit(json: unknown): Value | null {
	const number = numberOf(json);
	if (number !== null) return number;
	if (typeof json === 'boolean') return json;
	if (json && typeof json === 'object' && 'unit' in json) {
		const { unit, value } = json as { unit: unknown; value: unknown };
		const n = numberOf(value);
		if (n === null) return null;
		return typeof unit === 'string' && unit ? new ExprQuantity(n, unit) : n;
	}
	return null;
}

/** A number, or the toolkit's exact fraction (`{"@rational": "1279/4500", "approx": 0.284}`). */
function numberOf(json: unknown): number | null {
	if (typeof json === 'number') return json;
	if (json && typeof json === 'object' && '@rational' in json) {
		const approx = (json as { approx?: unknown }).approx;
		return typeof approx === 'number' ? approx : null;
	}
	return null;
}

/** A quantity whose units cancel (`s/min`) as the plain number it is. */
function plain(value: Value): Value {
	if (!(value instanceof ExprQuantity)) return value;
	const unit = parseUnit(value.unit);
	return unit && unit.dimension.every((d) => d === 0) ? value.value * unit.factor : value;
}

/** A value as the toolkit reads it in an expression: `3.92 [SI::kg]`, a path for a part. */
function literalText(value: AppValue): string | null {
	if (isRef(value)) return value.ref;
	if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
	if (typeof value === 'boolean') return String(value);
	if (value instanceof ExprQuantity) {
		if (!/^[A-Za-z_][\w]*(?:\s*[*/]\s*[A-Za-z_][\w]*)*$/.test(value.unit)) return null;
		return `${value.value} [${value.unit.replace(/[A-Za-z_]\w*/g, (u) => `SI::${u}`)}]`;
	}
	return null;
}

/** `(a, b.c, X::d)` → `['a', 'b.c', 'X::d']`. */
function splitList(text: string): string[] {
	const inner = text.trim().replace(/^\(([\s\S]*)\)$/, '$1');
	const out: string[] = [];
	let depth = 0;
	let current = '';
	for (const ch of inner) {
		if (ch === '(' || ch === '[' || ch === '{') depth++;
		if (ch === ')' || ch === ']' || ch === '}') depth--;
		if (ch === ',' && depth === 0) {
			out.push(current.trim());
			current = '';
		} else current += ch;
	}
	if (current.trim()) out.push(current.trim());
	return out;
}

/**
 * `w1 * a + w2 * b + …` (also `a * w`, and the branch of an `if` that
 * isn't a constant: `if over ? 0 else …`): each name with its weight; null
 * when the expression isn't such a sum.
 */
function weightedTerms(ast: Expr): { weight: number; name: string }[] | null {
	let e = ast;
	while (e.kind === 'if') {
		const constant = (x: Expr) => x.kind === 'literal';
		if (constant(e.then) && !constant(e.else)) e = e.else;
		else if (constant(e.else) && !constant(e.then)) e = e.then;
		else return null;
	}
	const terms: Expr[] = [];
	const flatten = (x: Expr) => {
		if (x.kind === 'binary' && x.op === '+') {
			flatten(x.left);
			flatten(x.right);
		} else terms.push(x);
	};
	flatten(e);
	if (terms.length < 2) return null;
	const out: { weight: number; name: string }[] = [];
	for (const t of terms) {
		if (t.kind !== 'binary' || t.op !== '*') return null;
		const [w, n] =
			t.left.kind === 'literal'
				? [t.left, t.right]
				: t.right.kind === 'literal'
					? [t.right, t.left]
					: [];
		if (!w || !n || w.kind !== 'literal' || typeof w.value !== 'number' || n.kind !== 'name')
			return null;
		out.push({ weight: w.value, name: n.name });
	}
	return out;
}

/** A row's values in one unit a person reads easily (the largest value decides it). */
function shownInOneUnit(values: Evaluated[]): string[] {
	const numbers = values.filter(
		(v): v is Extract<Evaluated, { kind: 'number' }> => v.kind === 'number'
	);
	const largest = numbers.toSorted(
		(a, b) => Math.abs(inBase(b) ?? 0) - Math.abs(inBase(a) ?? 0)
	)[0];
	const unit = largest?.unit ? readable({ value: largest.value, unit: largest.unit }).unit : null;
	return values.map((v) => {
		if (v.kind === 'number') {
			const q: Quantity = { value: v.value, unit: v.unit };
			if (unit && v.unit && v.unit !== unit) {
				const converted = convert(v.value, v.unit, unit);
				if (converted !== null) return formatQuantity({ value: converted, unit });
			}
			return v.unit ? formatQuantity(q) : formatMagnitude(v.value);
		}
		if (v.kind === 'text') return v.text;
		return '';
	});
}

/** A number value in its unit's SI base (to compare values given in different units). */
function inBase(v: Evaluated): number | null {
	if (v.kind !== 'number') return null;
	if (!v.unit) return v.value;
	const si = convert(v.value, v.unit, siOf(v.unit));
	return si ?? v.value;
}

/** A coherent unit of the same dimension (`g` → `kg`, `min` → `s`); the unit itself otherwise. */
function siOf(unit: string): string {
	for (const candidate of ['kg', 's', 'W', 'J', 'm', 'V', 'A', 'N', 'Pa'])
		if (convert(1, unit, candidate) !== null) return candidate;
	return unit;
}

const same = (a: number, b: number) =>
	Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

const lastSegment = (qualified: string) =>
	(qualified.split('::').pop() ?? qualified).replace(/^'|'$/g, '');
