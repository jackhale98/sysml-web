/**
 * Uncertain values of the model, and how they spread through the values
 * worked out from them (`docs/uncertainty.md`).
 *
 * - **Where uncertainty is written.** A value is uncertain when it owns an
 *   attribute typed by one of the `Uncertainty` library's distributions
 *   (`attribute :>> mass = 1100 [g] { attribute tolerance : Tolerance {
 *   :>> plus = 60 [g]; } }`), or by a definition that specializes one. Its
 *   numbers are read in the value's unit (a tolerance in g on a mass in kg
 *   converts; one in m doesn't, and the value is then taken as exact, with
 *   the reason in `problems`). A field left out takes the definition's
 *   default (`reading`, `sigmas`) or the nominal (`mean`, `mode`, `minus`
 *   as `plus`).
 * - **One input per part.** An uncertain value is sampled once for each
 *   place it is used (by its path, `drone::frontLeft::motor::powerDraw`), so
 *   four motors of one definition vary independently, as four real motors
 *   do. A collection of parts not named one by one (`motors : Motor[4]`
 *   without its members) is one value counted four times: its parts vary
 *   together, the cautious reading for a sum.
 * - **The model.** A value's expression (`emptyMass = airframe.mass + …`,
 *   `endurance = HoverEndurance(battery.usableEnergy, hoverPower)`) is
 *   followed through the values it reads, as the app evaluates them
 *   (`sim/expr.ts`, `rotors->collect { … }` over the rotors named, the
 *   model's calcs inlined), down to uncertain values and constants (the
 *   toolkit's values), and compiled (`uncertainty/compile.ts`). A value
 *   nothing uncertain feeds stays the constant the app shows. What can't be
 *   followed (an expression the app's evaluator doesn't read) is taken as
 *   its nominal value, and the spread says so (`note`).
 * - **A safety net.** A compiled model evaluated at the nominal values must
 *   give the value the app shows; when it doesn't, no spread is shown rather
 *   than a wrong one.
 * - **Runs.** 10,000 seeded samples (each value its own stream, so two runs
 *   that share a value see the same samples of it, and a budget's total
 *   agrees with the check on it), within a time budget; first-order and
 *   worst-case figures beside them. Everything is cached per analysis.
 *
 * A model with no uncertain value (`any` false) takes none of this: its
 * budgets and checks are as they were.
 */
import { parseExpr, ParseError } from '#lib/sim/expr.ts';
import {
	compile,
	CompileError,
	constant,
	DEFAULT_SAMPLES,
	DEFAULT_SEED,
	DEFAULT_TIME_BUDGET_MS,
	fromTolerance,
	input,
	monteCarlo,
	problemOf,
	range as rangeOf,
	sampleInput,
	worstCase,
	type Binder,
	type Compiled,
	type Distribution,
	type Limit,
	type MonteCarloResult,
	type SamplingMethod,
	type ToleranceReading,
	type UncertainInput
} from '#lib/uncertainty/index.ts';
import {
	convert,
	formatMagnitude,
	formatQuantity,
	parseLiteral,
	parseUnit,
	readable,
	type Quantity
} from '../quantity';
import type { CheckSpread, CheckStatus, Evaluated, Spread } from '../types';
import { multiplicityOf, type ElementRecord, type ExtractedModel } from './model';

/** What the spreads read from the evaluation. */
export interface SpreadSource {
	extracted: ExtractedModel;
	/** The record of the element a qualified name resolves to (an inherited feature's own record). */
	recordAt(qualifiedName: string): ElementRecord | undefined;
	/** `feature`'s value for the element at `context`, as the app works it out. */
	valueFor(context: string, feature: string): Evaluated | null;
	valueAt(qualifiedName: string): Evaluated | null;
}

type Kind = 'normal' | 'uniform' | 'triangular' | 'tolerance';

/** A value of the model as a function of the uncertain values. */
export interface Built {
	compiled: Compiled;
	/** Indexes of the uncertain values it reads. */
	inputs: Set<number>;
	/** What could not be followed on the way (the value was taken as it is). */
	gaps: string[];
}

interface Registered {
	path: string;
	input: UncertainInput;
	/** The stated value, in `unit`. */
	nominal: number;
	unit: string | null;
}

/** Deeper than this, an expression reading expressions is taken for a loop. */
const MAX_DEPTH = 24;

const LIBRARY_TYPE = /(?:^|::)Uncertainty::(Distribution|Normal|Uniform|Triangular|Tolerance)$/;

export class Spreads {
	private readonly source: SpreadSource;
	private readonly byOwner = new Map<string, ElementRecord[]>();
	private readonly kinds = new Map<string, Kind | null>();
	private readonly packages = new Set<string>();
	private readonly registry: Registered[] = [];
	private readonly indexOf = new Map<string, number>();
	private readonly built = new Map<string, Built | null>();
	private readonly samples = new Map<string, Float64Array>();
	private readonly runs = new Map<string, unknown>();
	/** Whether the model has any uncertain value: when not, nothing here is used. */
	readonly any: boolean;
	/** Uncertain values whose numbers can't be read, by path, with why (taken as exact). */
	readonly problems = new Map<string, string>();
	readonly options: {
		samples: number;
		seed: number;
		method: SamplingMethod;
		timeBudgetMs: number;
	} = {
		samples: DEFAULT_SAMPLES,
		seed: DEFAULT_SEED,
		method: 'random',
		timeBudgetMs: DEFAULT_TIME_BUDGET_MS
	};

	constructor(source: SpreadSource) {
		this.source = source;
		let any = false;
		for (const r of source.extracted.elements) {
			if (r.ownerId) {
				const list = this.byOwner.get(r.ownerId);
				if (list) list.push(r);
				else this.byOwner.set(r.ownerId, [r]);
			}
			if (/Package$/.test(r.metaclass) && r.qualifiedName) this.packages.add(r.qualifiedName);
		}
		for (const r of source.extracted.elements)
			if (!r.isDefinition && r.kind === 'attribute' && r.typeIds.some((t) => this.kindOf(t)))
				any = true;
		this.any = any;
	}

	/** A value read once per analysis, by key. */
	cached<T>(key: string, make: () => T): T {
		if (this.runs.has(key)) return this.runs.get(key) as T;
		const value = make();
		this.runs.set(key, value);
		return value;
	}

	// ---- Reading the distributions ----

	/** The library distribution a type is (or specializes), or null. */
	private kindOf(typeId: string, depth = 0): Kind | null {
		const known = this.kinds.get(typeId);
		if (known !== undefined) return known;
		this.kinds.set(typeId, null);
		const record = this.source.extracted.byId.get(typeId);
		let kind: Kind | null = null;
		const m = record?.qualifiedName ? LIBRARY_TYPE.exec(record.qualifiedName) : null;
		if (m && m[1] !== 'Distribution') kind = m[1]!.toLowerCase() as Kind;
		else if (record && depth < 16)
			for (const g of record.generalIds) {
				kind = this.kindOf(g, depth + 1);
				if (kind) break;
			}
		this.kinds.set(typeId, kind);
		return kind;
	}

	/** The distribution attribute a value's record owns, if any. */
	private specOf(record: ElementRecord): { usage: ElementRecord; kind: Kind } | null {
		for (const child of this.byOwner.get(record.id) ?? []) {
			if (child.isDefinition || child.kind !== 'attribute') continue;
			const kind = child.typeIds.map((t) => this.kindOf(t)).find(Boolean);
			if (kind) return { usage: child, kind };
		}
		return null;
	}

	/** A field of a distribution as written: on the usage, else a default of its type or the type's supertypes. */
	private field(usage: ElementRecord, name: string): string | null {
		const own = (this.byOwner.get(usage.id) ?? []).find((c) => c.name === name && c.value);
		if (own) return own.value;
		const seen = new Set<string>();
		const queue = [...usage.typeIds];
		while (queue.length) {
			const id = queue.shift()!;
			if (seen.has(id)) continue;
			seen.add(id);
			const found = (this.byOwner.get(id) ?? []).find((c) => c.name === name && c.value);
			if (found) return found.value;
			queue.push(...(this.source.extracted.byId.get(id)?.generalIds ?? []));
		}
		return null;
	}

	/** A field's number in the value's unit; throws a phrase when it can't be read. */
	private amount(usage: ElementRecord, name: string, unit: string | null): number | null {
		const text = this.field(usage, name);
		if (text === null) return null;
		const q = parseLiteral(text.trim());
		if (!q) throw new SpecError(`\`${name}\` is not a number with a unit (\`${text.trim()}\`)`);
		if (!q.unit) return q.value;
		if (!unit) throw new SpecError(`\`${name}\` is in \`${q.unit}\`, but the value has no unit`);
		const value = convert(q.value, q.unit, unit);
		if (value === null)
			throw new SpecError(
				`\`${name}\` is in \`${q.unit}\`, which doesn't convert to the value's \`${unit}\``
			);
		return value;
	}

	/** The distribution and worst-case range of a value with this nominal. */
	private distribution(
		spec: { usage: ElementRecord; kind: Kind },
		nominal: Quantity
	): { distribution: Distribution; range?: [number, number] } {
		const { usage, kind } = spec;
		const read = (name: string) => this.amount(usage, name, nominal.unit);
		const needed = (name: string) => {
			const v = read(name);
			if (v === null) throw new SpecError(`\`${name}\` is not given`);
			return v;
		};
		switch (kind) {
			case 'normal':
				return {
					distribution: {
						kind: 'normal',
						mean: read('mean') ?? nominal.value,
						sd: needed('standardDeviation')
					}
				};
			case 'uniform':
				return { distribution: { kind: 'uniform', min: needed('min'), max: needed('max') } };
			case 'triangular':
				return {
					distribution: {
						kind: 'triangular',
						min: needed('min'),
						mode: read('mode') ?? nominal.value,
						max: needed('max')
					}
				};
			case 'tolerance': {
				const plus = needed('plus');
				const minus = read('minus') ?? plus;
				if (plus < 0 || minus < 0)
					throw new SpecError(
						'a tolerance is given as how far the band goes each way: no negative numbers'
					);
				const readingText = this.field(usage, 'reading') ?? 'normal';
				const reading = readingText.split('::').pop()!.replace(/'/g, '').trim();
				if (reading !== 'normal' && reading !== 'uniform' && reading !== 'triangular')
					throw new SpecError(`\`reading\` is \`${readingText}\`: normal, uniform or triangular`);
				const sigmasText = this.field(usage, 'sigmas');
				const sigmas = sigmasText === null ? 3 : Number(sigmasText);
				if (!(sigmas > 0)) throw new SpecError('`sigmas` must be a number above 0');
				return fromTolerance({
					nominal: nominal.value,
					plus,
					minus,
					reading: reading as ToleranceReading,
					sigmas
				});
			}
		}
	}

	/** The index of the uncertain value at `path`, registering it; null when it isn't one. */
	private inputFor(path: string, record: ElementRecord, nominal: Quantity): number | null {
		const known = this.indexOf.get(path);
		if (known !== undefined) return known;
		const spec = this.specOf(record);
		if (!spec) return null;
		try {
			if (nominal.unit && !parseUnit(nominal.unit))
				throw new SpecError(`the value's unit \`${nominal.unit}\` is not known`);
			const { distribution, range } = this.distribution(spec, nominal);
			const problem = problemOf(distribution);
			if (problem) throw new SpecError(problem);
			const index = this.registry.length;
			this.registry.push({
				path,
				input: { name: path, distribution, range: range ?? rangeOf(distribution) },
				nominal: nominal.value,
				unit: nominal.unit
			});
			this.indexOf.set(path, index);
			return index;
		} catch (error) {
			if (!(error instanceof SpecError)) throw error;
			this.problems.set(path, error.message);
			return null;
		}
	}

	// ---- Following the model ----

	/** The value `feature` (a name or a chain) of the element at `context`. */
	feature(context: string, feature: string): Built | null {
		return this.node(context, feature, 0);
	}

	/** The value at a qualified path (`DroneArchitecture::drone::endurance`). */
	at(path: string): Built | null {
		const at = path.lastIndexOf('::');
		return at < 0 ? null : this.node(path.slice(0, at), path.slice(at + 2), 0);
	}

	/** Values added up, each counted `times`. */
	total(parts: { built: Built; times: number }[]): Built | null {
		if (!parts.length) return null;
		const compiled = parts.map(({ built, times }) =>
			times === 1 ? built.compiled : compileProduct(built.compiled, times)
		);
		const sum = compileSum(compiled);
		const inputs = new Set<number>();
		const gaps: string[] = [];
		for (const { built } of parts) {
			built.inputs.forEach((i) => inputs.add(i));
			gaps.push(...built.gaps);
		}
		return sum ? { compiled: sum, inputs, gaps } : null;
	}

	private node(scope: string, feature: string, depth: number): Built | null {
		if (feature.includes('::') || depth > MAX_DEPTH) return null;
		const name = feature.replace(/^self\./, '');
		const path = [scope, ...name.split('.')].join('::');
		if (this.built.has(path)) return this.built.get(path)!;
		this.built.set(path, null); // (a value that depends on itself has no spread)
		const made = this.make(scope, name, path, depth);
		this.built.set(path, made);
		return made;
	}

	private make(scope: string, feature: string, path: string, depth: number): Built | null {
		const value = this.source.valueFor(scope, feature) ?? this.source.valueAt(path);
		const nominal: Quantity | null =
			value?.kind === 'number' ? { value: value.value, unit: value.unit } : null;
		const record = this.source.recordAt(path);
		if (record && nominal) {
			const index = this.inputFor(path, record, nominal);
			if (index !== null)
				return { compiled: input(index, nominal.unit), inputs: new Set([index]), gaps: [] };
		}
		const fixed = nominal ? constantOf(nominal) : null;
		if (!record?.value || !/[A-Za-z_]/.test(record.value.replace(/\[[^\]]*\]/g, ''))) return fixed;
		const inner = path.slice(0, path.lastIndexOf('::'));
		const inputs = new Set<number>();
		const gaps: string[] = [];
		try {
			const expr = parseExpr(this.expand(withoutComments(record.value), inner));
			const compiled = compile(expr, this.binder(inner, depth, inputs, gaps));
			if (!inputs.size) return fixed && { ...fixed, gaps };
			return { compiled, inputs, gaps };
		} catch (error) {
			if (!(error instanceof CompileError || error instanceof ParseError)) throw error;
			const why = `\`${this.shown(path)}\` (${error.message})`;
			return fixed && { ...fixed, gaps: [...gaps, why] };
		}
	}

	private binder(scope: string, depth: number, inputs: Set<number>, gaps: string[]): Binder {
		const take = (b: Built) => {
			b.inputs.forEach((i) => inputs.add(i));
			gaps.push(...b.gaps);
			return b.compiled;
		};
		return {
			name: (name) => {
				const b = this.node(scope, name, depth + 1);
				return b ? take(b) : null;
			},
			call: (name, args) => this.calc(name, args, depth + 1)
		};
	}

	/**
	 * `X->collect { in r : T; r.f }` and `sum(X.f)` over a collection whose
	 * parts are named (`ref part rotors : Rotor[4] = (frontLeft, …)`): the
	 * parts' values one by one (`frontLeft.f, frontRight.f, …`); over one of
	 * a fixed size whose parts aren't named, n times its value.
	 */
	private expand(text: string, scope: string): string {
		const each = (collection: string, body: (part: string) => string): string | null => {
			const record = this.source.recordAt(`${scope}::${collection.replace(/\./g, '::')}`);
			if (!record) return null;
			const named = record.value ? /^\(\s*([\w.,\s]+?)\s*\)$/.exec(record.value.trim()) : null;
			if (named)
				return named[1]!
					.split(/\s*,\s*/)
					.map(body)
					.join(', ');
			const n = fixedCount(record.header);
			return n ? `${n} * (${body(collection)})` : null;
		};
		const collected = text.replace(
			/([A-Za-z_][\w.]*)\s*->\s*collect\s*\{\s*in\s+([A-Za-z_]\w*)\s*(?::\s*[\w:']+\s*)?;\s*([^{}]*?)\s*\}/g,
			(all, collection: string, variable: string, body: string) =>
				each(collection, (part) =>
					body.replace(new RegExp(`(?<![\\w.])${variable}(?=\\.)`, 'g'), part)
				) ?? all
		);
		return collected.replace(
			/\bsum\(\s*([A-Za-z_]\w*)\.([A-Za-z_][\w.]*)\s*\)/g,
			(all, collection: string, rest: string) => {
				const parts = each(collection, (part) => `${part}.${rest}`);
				return parts ? `sum(${parts})` : all;
			}
		);
	}

	/** A calc of the model (`HoverEndurance(e, p)`), inlined: its result with its parameters bound to the arguments. */
	private calc(name: string, args: Compiled[], depth: number): Compiled | null {
		if (depth > MAX_DEPTH) return null;
		const simple = name.split('::').pop()!.replace(/'/g, '');
		const def = this.source.extracted.elements.find(
			(r) =>
				r.metaclass === 'CalculationDefinition' &&
				r.name === simple &&
				(!name.includes('::') || (r.qualifiedName ?? '').endsWith(name))
		);
		if (!def) return null;
		const members = this.byOwner.get(def.id) ?? [];
		const params = members.filter((m) => m.direction === 'in' && m.name).map((m) => m.name!);
		const result = members.find((m) => m.kind === 'return')?.value;
		if (!result || params.length !== args.length) return null;
		const locals = new Map(
			members
				.filter((m) => m.direction !== 'in' && m.kind !== 'return' && m.name && m.value)
				.map((m) => [m.name!, m.value!])
		);
		const done = new Map<string, Compiled | null>();
		const binder: Binder = {
			name: (n) => {
				const i = params.indexOf(n);
				if (i >= 0) return args[i]!;
				if (done.has(n)) return done.get(n)!;
				const text = locals.get(n);
				done.set(n, null);
				if (!text) return null;
				const c = compile(parseExpr(withoutComments(text)), binder);
				done.set(n, c);
				return c;
			},
			call: (n, a) => this.calc(n, a, depth + 1)
		};
		return compile(parseExpr(withoutComments(result)), binder);
	}

	// ---- Running ----

	/** How a path reads to people: `drone.battery.mass` (without its packages). */
	shown(path: string): string {
		const segments = path.split('::');
		let at = 0;
		for (let i = 1; i < segments.length; i++)
			if (this.packages.has(segments.slice(0, i).join('::'))) at = i;
		return segments.slice(at).join('.');
	}

	/** The samples of one uncertain value (the same in every run of the analysis). */
	private samplesOf(r: Registered): Float64Array {
		let s = this.samples.get(r.path);
		if (!s) {
			s = sampleInput(r.input, this.options.samples, this.options.method, this.options.seed);
			this.samples.set(r.path, s);
		}
		return s;
	}

	/**
	 * Spreads of several values in one run (they share samples). Each in the
	 * unit of its nominal value; null for one nothing uncertain feeds, or
	 * whose compiled model doesn't give its nominal value at the nominal values.
	 */
	run(
		outputs: {
			built: Built | null;
			nominal: Quantity | null;
			limit?: Quantity & { operator: string };
		}[]
	): (Spread | null)[] {
		const x0 = Float64Array.from(this.registry, (r) => r.nominal);
		const usable = outputs.map((o) => {
			if (!o.built?.inputs.size || !o.nominal) return false;
			const unit = unitOf(o.nominal.unit);
			if (!unit || !sameDims(unit.dims, o.built.compiled.dims)) return false;
			return close(o.built.compiled.at(x0), o.nominal.value * unit.factor);
		});
		const chosen = outputs.filter((_, i) => usable[i]);
		if (!chosen.length) return outputs.map(() => null);
		const inputs = this.registry.map((r) => r.input);
		const result = monteCarlo(
			inputs,
			chosen.map((o) => {
				const limit = o.limit ? limitIn(o.limit) : undefined;
				return { model: o.built!.compiled.at, ...(limit ? { limit } : {}) };
			}),
			this.options,
			this.registry.map((r) => this.samplesOf(r))
		);
		let k = 0;
		return outputs.map((o, i) => {
			if (!usable[i]) return null;
			const summary = result.outputs[k++]!;
			const worst = worstCase(inputs, o.built!.compiled.at);
			return this.spreadOf(o.built!, o.nominal!, summary, worst, result.samples);
		});
	}

	private spreadOf(
		built: Built,
		nominal: Quantity,
		s: MonteCarloResult,
		worst: { min: number; max: number },
		samples: number
	): Spread {
		const factor = unitOf(nominal.unit)!.factor;
		const to = (v: number) => v / factor;
		const p = s.probability;
		return {
			unit: nominal.unit,
			nominal: nominal.value,
			mean: to(s.mean),
			sd: s.sd / factor,
			p5: to(s.p5),
			p50: to(s.p50),
			p95: to(s.p95),
			worstCase: { min: to(worst.min), max: to(worst.max) },
			histogram: {
				from: to(s.histogram.from),
				width: s.histogram.width / factor,
				counts: s.histogram.counts
			},
			samples,
			seed: this.options.seed,
			method: this.options.method,
			inputs: this.inputNames(built),
			...(p ? { within: { share: p.value, low: p.low, high: p.high, met: p.met, n: p.n } } : {}),
			...(this.noteOf(built) ? { note: this.noteOf(built)! } : {})
		};
	}

	private inputNames(built: Built): string[] {
		return [...built.inputs].sort((a, b) => a - b).map((i) => this.shown(this.registry[i]!.path));
	}

	private noteOf(built: Built): string | null {
		const gaps = [...new Set(built.gaps)];
		return gaps.length
			? `taken as exact, because the app can't sample ${gaps.length === 1 ? 'it' : 'them'}: ${gaps.join('; ')}`
			: null;
	}

	/**
	 * How often a check's constraints hold over the samples, and the spread
	 * of the value it compares with a limit. `values` are the names the
	 * constraints use with the paths their values are read at; `holds` the
	 * verdict at the nominal values, which the compiled constraints must
	 * give too. Null when nothing uncertain feeds the check.
	 */
	check(
		constraints: string[],
		values: { name: string; path: string }[],
		holds: boolean,
		comparison: { feature: string; operator: string; limit: Quantity } | null
	): CheckSpread | null {
		const byName = new Map(values.map((v) => [v.name, v.path]));
		const inputs = new Set<number>();
		const gaps: string[] = [];
		const binder: Binder = {
			name: (name) => {
				const path = byName.get(name);
				const b = path ? this.at(path) : null;
				if (!b) return null;
				b.inputs.forEach((i) => inputs.add(i));
				gaps.push(...b.gaps);
				return b.compiled;
			},
			call: (name, args) => this.calc(name, args, 1)
		};
		let all: Compiled | null = null;
		try {
			for (const text of constraints) {
				const c = compile(parseExpr(withoutComments(text.replace(/^\{|\}$/g, '').trim())), binder);
				if (!c.boolean) return null;
				all = all ? compileAnd(all, c) : c;
			}
		} catch (error) {
			if (error instanceof CompileError || error instanceof ParseError) return null;
			throw error;
		}
		if (!all || !inputs.size) return null;
		const x0 = Float64Array.from(this.registry, (r) => r.nominal);
		if (!!all.at(x0) !== holds) return null;
		const built: Built = { compiled: all, inputs, gaps };
		const result = monteCarlo(
			this.registry.map((r) => r.input),
			[{ model: all.at, limit: { operator: '>', value: 0.5 } }],
			this.options,
			this.registry.map((r) => this.samplesOf(r))
		);
		const p = result.outputs[0]!.probability!;
		const path = comparison ? byName.get(comparison.feature) : undefined;
		const valueBuilt = path ? this.at(path) : null;
		const nominal = path ? this.source.valueAt(path) : null;
		const [value] =
			comparison && valueBuilt && nominal?.kind === 'number'
				? this.run([
						{
							built: valueBuilt,
							nominal: { value: nominal.value, unit: nominal.unit },
							limit: { ...comparison.limit, operator: comparison.operator }
						}
					])
				: [null];
		const note = this.noteOf(built);
		return {
			met: { share: p.value, low: p.low, high: p.high, met: p.met, n: p.n },
			...(value ? { value } : {}),
			samples: result.samples,
			inputs: this.inputNames(built),
			...(note ? { note } : {})
		};
	}
}

class SpecError extends Error {}

/** A value as a constant, or null when its unit is not sampled (a temperature in °C). */
function constantOf(q: Quantity): Built | null {
	try {
		return { compiled: constant(q.value, q.unit), inputs: new Set(), gaps: [] };
	} catch (error) {
		if (error instanceof CompileError) return null;
		throw error;
	}
}

/** An expression without its comments (`// each rotor's mass`). */
function withoutComments(text: string): string {
	return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/** How many parts a usage of a fixed size stands for (`[4]`), else null. */
function fixedCount(header: string): number | null {
	const text = multiplicityOf(header)?.trim();
	if (!text || !/^\d+$/.test(text)) return null;
	const n = Number(text);
	return n > 1 ? n : null;
}

function unitOf(unit: string | null): { factor: number; dims: readonly number[] } | null {
	if (!unit) return { factor: 1, dims: [0, 0, 0, 0, 0, 0, 0, 0, 0] };
	const info = parseUnit(unit);
	return info && !info.offset ? { factor: info.factor, dims: info.dimension } : null;
}

const sameDims = (a: readonly number[], b: readonly number[]) => a.every((d, i) => d === b[i]);

const close = (a: number, b: number) =>
	Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b)) + 1e-12;

/** A limit in SI, for a compiled value. */
function limitIn(limit: Quantity & { operator: string }): Limit | undefined {
	const unit = unitOf(limit.unit);
	if (!unit || !['<=', '<', '>=', '>'].includes(limit.operator)) return undefined;
	return { operator: limit.operator as Limit['operator'], value: limit.value * unit.factor };
}

function compileProduct(c: Compiled, times: number): Compiled {
	const f = c.at;
	return { ...c, at: (x) => f(x) * times };
}

function compileSum(parts: Compiled[]): Compiled | null {
	const first = parts[0];
	if (!first || parts.some((p) => p.boolean || !sameDims(p.dims, first.dims))) return null;
	const fs = parts.map((p) => p.at);
	return {
		at: (x) => {
			let s = 0;
			for (const f of fs) s += f(x);
			return s;
		},
		boolean: false,
		dims: first.dims,
		unit: first.unit,
		constant: parts.every((p) => p.constant)
	};
}

function compileAnd(a: Compiled, b: Compiled): Compiled {
	const [fa, fb] = [a.at, b.at];
	return { ...a, at: (x) => +(!!fa(x) && !!fb(x)), constant: a.constant && b.constant };
}

// ---- In words ----

/**
 * A share of sampled cases, as people read it: `97.3 %`, `over 99.9 %`
 * (some cases fail, too few to show), `under 0.1 %`, `100 %` and `0 %`
 * only when every case or none met it.
 */
export function shareText(met: { met: number; n: number }): string {
	if (met.met === met.n) return '100 %';
	if (met.met === 0) return '0 %';
	const p = (met.met / met.n) * 100;
	if (p > 99.9) return 'over 99.9 %';
	if (p < 0.1) return 'under 0.1 %';
	return `${p.toFixed(1)} %`;
}

/**
 * P5 to P95 (90 % of cases) in the unit the nominal reads best in, or in
 * `shownIn`: `3.751 – 3.809 kg`, or `between 25.59 and 29.54 min` in a sentence.
 */
export function rangeText(spread: Spread, sentence = false, shownIn?: string | null): string {
	const unit = shownIn ?? readable({ value: spread.nominal, unit: spread.unit }).unit;
	const to = (v: number) =>
		unit && spread.unit && unit !== spread.unit ? (convert(v, spread.unit, unit) ?? v) : v;
	const [low, high] = [formatMagnitude(to(spread.p5)), formatMagnitude(to(spread.p95))];
	const between = sentence ? `between ${low} and ${high}` : `${low} – ${high}`;
	return formatQuantity({ value: 0, unit }).replace(/^0/, between);
}

/**
 * A check's explanation when values it reads are uncertain: how often it is
 * met first, then the nominal values and the likely range of the value it
 * compares (`Met in 98.8 % of cases: drone.endurance = 27.54 min, in 90 % of
 * cases between 25.59 and 29.54 min (needs ≥ 25 min).`).
 */
export function spreadExplanation(
	status: CheckStatus,
	spread: CheckSpread,
	values: string,
	needs: string
): string {
	const { met, n } = spread.met;
	const cases = n.toLocaleString('en-US');
	const lead =
		met === n
			? `Met in all ${cases} sampled cases`
			: met === 0
				? `Met in none of the ${cases} sampled cases`
				: status === 'satisfied'
					? `Met in ${shareText(spread.met)} of cases`
					: `Met in only ${shareText(spread.met)} of cases`;
	const range = spread.value ? `, in 90 % of cases ${rangeText(spread.value, true)}` : '';
	// The verdict is the one at the values the model gives: say so when it differs from most cases.
	const nominal = status === 'satisfied' ? '' : '; not met at the values given';
	return values ? `${lead}${nominal}: ${values}${range}${needs}.` : `${lead}${nominal}.`;
}
