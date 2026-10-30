/**
 * Product variants and configurations, read from the model with the
 * language's own constructs (SysML v2 7.6.8, variability):
 *
 * - A **variation point** is a `variation` usage (`variation part battery :
 *   Battery { variant part a; variant part b; }`), or a usage typed by a
 *   `variation` definition (`part radio : RadioOptions`): a choice the design
 *   leaves open. Its **variants** are the variation's `variant` members.
 * - A **product line** is a usage or definition with variation points as
 *   features (`part droneFamily :> drone { variation part :>> battery … }`).
 * - A **configuration** is a usage in a package that specializes a product
 *   line (`:>` or `:`) and binds each of its variation points to one variant
 *   (`part :>> battery = droneFamily::battery::longRangePack;`), or
 *   specializes one (`part :>> battery :> …::longRangePack;`). A choice it
 *   doesn't make it inherits from what it specializes on the way.
 *
 * **Showing a configuration.** The tables, checks and diagrams read the
 * product as written (`drone`), so a configuration is shown by working out
 * the model with its choices made: the declaration each variation point
 * stands for (`drone::battery`, the feature the point redefines, or the
 * point itself) is rewritten as the chosen variant — typed by the variant's
 * type, with the variant's own features and those of what it specializes
 * (`longRangePack :> batteryOptions::semiSolidState`), and any of the
 * declaration's own that the variant doesn't redefine. Everything that
 * refers to `drone.battery` then reads the variant's values. The rewritten
 * declaration is written on one line and followed by as many line breaks as
 * it had, so every other element keeps its line (and, when the text is
 * shorter, its offsets). Names in the copied text are as written: they must
 * resolve where the product is written too (units from `SI`, typically).
 */
import type { SourceFile } from '../protocol';
import type { Variability, VariabilityConfiguration, VariationPoint } from '../types';
import type { ElementRecord } from './model';
import type { ViewContext } from './views/context';

const VARIANT = 'VariantMembership';

/** `variation part x …`, `variation part def X …`: the choices a design can make, each a `variant`. */
export const isVariation = (r: ElementRecord) =>
	/^\s*(?:(?:abstract|derived|readonly|individual)\s+)*variation\b/.test(r.header);

/** Whether a model has any variants at all (cheap: the adapter's memberships). */
export const hasVariants = (records: readonly ElementRecord[]) =>
	records.some((r) => r.membership === VARIANT);

interface Point {
	record: ElementRecord;
	/** Where the variants are listed: the point itself, or the variation definition it is typed by. */
	variation: ElementRecord;
	variants: ElementRecord[];
	/** The product line it is a feature of (null for a variation in a package). */
	line: ElementRecord | null;
}

interface Choice {
	point: Point;
	/** The usage that makes the choice (`part :>> battery = …`), when there is one. */
	by: ElementRecord | null;
	/** The variant chosen, when exactly one of the point's variants is. */
	variant: ElementRecord | null;
	/** What is wrong with the choice, in a sentence. */
	problem: string | null;
	/** Further usages of the same configuration that choose for the same point. */
	again: ElementRecord[];
}

interface Configuration {
	record: ElementRecord;
	lines: ElementRecord[];
	/** The product it configures: the outermost usage it specializes (`drone`). */
	product: ElementRecord;
	choices: Choice[];
}

/** A problem to list in Problems, at an element's declaration. */
export interface VariabilityProblem {
	record: ElementRecord;
	message: string;
	/** Only the declaration's first line (a configuration's header), not its body. */
	headerOnly: boolean;
}

export class VariabilityModel {
	readonly points: Point[] = [];
	readonly configurations: Configuration[] = [];
	private readonly ctx: ViewContext;

	constructor(ctx: ViewContext) {
		this.ctx = ctx;
		if (!hasVariants(ctx.records)) return;
		const lines = new Map<string, Point[]>();
		for (const r of ctx.records) {
			if (!ctx.isContent(r) || r.isDefinition || !r.name || r.membership === VARIANT) continue;
			const variation = isVariation(r)
				? r
				: r.value === null
					? r.typeIds
							.map((t) => ctx.byId.get(t))
							.find((t): t is ElementRecord => !!t && t.isDefinition && isVariation(t))
					: undefined;
			if (!variation) continue;
			const owner = r.ownerId ? ctx.byId.get(r.ownerId) : undefined;
			const line = owner && !/Package$/.test(owner.metaclass) ? owner : null;
			const point: Point = { record: r, variation, variants: this.variantsOf(variation), line };
			this.points.push(point);
			if (line) lines.set(line.id, [...(lines.get(line.id) ?? []), point]);
		}
		if (!lines.size) return;
		for (const r of ctx.records) {
			if (!ctx.isContent(r) || r.isDefinition || !r.name || r.membership === VARIANT) continue;
			if (lines.has(r.id) || isVariation(r)) continue;
			const owner = r.ownerId ? ctx.byId.get(r.ownerId) : undefined;
			if (owner && !/Package$/.test(owner.metaclass)) continue;
			const supers = ctx.supers(r.id);
			const own = supers.filter((id) => lines.has(id)).map((id) => ctx.byId.get(id)!);
			if (!own.length) continue;
			// A point a nearer line redefines stands for it.
			const points = own.flatMap((l) => lines.get(l.id)!);
			const kept = points.filter(
				(p) => !points.some((q) => q !== p && ctx.supers(q.record.id).includes(p.record.id))
			);
			this.configurations.push({
				record: r,
				lines: own,
				product: this.productOf(r),
				choices: kept.map((p) => this.choiceOf(r, supers, p))
			});
		}
	}

	private variantsOf(variation: ElementRecord): ElementRecord[] {
		return this.ctx.ownedBy(variation.id).filter((m) => m.membership === VARIANT && !!m.name);
	}

	/** The outermost usage a configuration specializes, through usages (`drone`). */
	private productOf(r: ElementRecord): ElementRecord {
		let at = r;
		for (let i = 0; i < 32; i++) {
			const next = this.ctx.subsettedUsage(at);
			if (!next) break;
			at = next;
		}
		return at;
	}

	/**
	 * The variant a configuration chooses for a point: made by the
	 * configuration's own redefinition of it, else by the nearest usage it
	 * specializes on the way to the product line.
	 */
	private choiceOf(config: ElementRecord, supers: string[], point: Point): Choice {
		const ctx = this.ctx;
		const between = [config.id, ...supers].filter((id) => {
			const r = ctx.byId.get(id);
			return (
				!!r && !r.isDefinition && id !== point.line?.id && ctx.conforms(id, point.line?.id ?? '')
			);
		});
		for (const id of between) {
			const resolvers = ctx
				.ownedBy(id)
				.filter((m) => m.id !== point.record.id && ctx.supers(m.id).includes(point.record.id));
			if (!resolvers.length) continue;
			const [by, ...again] = resolvers;
			return { point, by: by!, again, ...this.chosen(by!, point) };
		}
		return {
			point,
			by: null,
			again: [],
			variant: null,
			problem: `no variant is chosen for \`${point.record.name}\``
		};
	}

	/** What a redefinition of a point chooses: what it is bound to, else a variant it specializes. */
	private chosen(by: ElementRecord, point: Point): Pick<Choice, 'variant' | 'problem'> {
		const ctx = this.ctx;
		const variants = new Set(point.variants.map((v) => v.id));
		const name = `\`${point.record.name}\``;
		const one = point.variants.map((v) => `\`${v.name}\``).join(', ');
		if (by.value !== null) {
			const written = listItems(by.value);
			if (written.length > 1)
				return {
					variant: null,
					problem: `${name} is bound to ${written.length} elements (${written.map((w) => `\`${w}\``).join(', ')}): a configuration picks one variant`
				};
			const target = ctx.resolveIn(by.id, written[0] ?? '');
			if (!target) return { variant: null, problem: `\`${written[0]}\` doesn't resolve` };
			if (variants.has(target)) return { variant: ctx.byId.get(target)!, problem: null };
			return {
				variant: null,
				problem: `\`${written[0]}\` is not one of the variants of ${name} (${one})`
			};
		}
		const picked = [...by.typeIds, ...by.generalIds].filter((id) => variants.has(id));
		if (picked.length === 1) return { variant: ctx.byId.get(picked[0]!)!, problem: null };
		if (picked.length > 1)
			return { variant: null, problem: `${name} specializes two of its variants: pick one` };
		return { variant: null, problem: `no variant is chosen for ${name}` };
	}

	/** The configuration a name stands for (qualified or simple). */
	find(name: string): Configuration | undefined {
		return (
			this.configurations.find((c) => c.record.qualifiedName === name) ??
			this.configurations.find((c) => c.record.name === name)
		);
	}

	/** What the app shows and lists: points, configurations and their choices. */
	summary(): Variability {
		const pointOf = (p: Point): VariationPoint => ({
			id: p.record.id,
			name: p.record.name!,
			qualifiedName: p.record.qualifiedName ?? p.record.name!,
			productLine: p.line?.qualifiedName ?? null,
			variation: p.variation.qualifiedName ?? p.variation.name ?? '',
			variants: p.variants.map((v) => ({
				id: v.id,
				name: v.name!,
				qualifiedName: v.qualifiedName ?? v.name!
			})),
			file: p.record.path,
			line: p.record.span.start_row
		});
		const configurationOf = (c: Configuration): VariabilityConfiguration => ({
			id: c.record.id,
			name: c.record.name!,
			qualifiedName: c.record.qualifiedName ?? c.record.name!,
			productLines: c.lines.map((l) => l.qualifiedName ?? l.name ?? ''),
			product: c.product.qualifiedName ?? c.product.name ?? '',
			...(c.record.docs.length ? { doc: c.record.docs.join(' ').replace(/\s+/g, ' ').trim() } : {}),
			choices: c.choices.map((ch) => ({
				point: ch.point.record.name!,
				pointId: ch.point.record.id,
				variant: ch.variant?.name ?? null,
				variantId: ch.variant?.id ?? null,
				...(this.problemOf(ch) ? { problem: this.problemOf(ch)! } : {})
			})),
			changes: [
				...new Set(
					c.choices.flatMap((ch) =>
						ch.variant && !ch.again.length ? [this.declarationOf(ch.point).path] : []
					)
				)
			],
			file: c.record.path,
			line: c.record.span.start_row
		});
		return {
			points: this.points.map(pointOf),
			configurations: this.configurations.map(configurationOf)
		};
	}

	private problemOf(choice: Choice): string | null {
		if (choice.again.length)
			return `\`${choice.point.record.name}\` is chosen ${choice.again.length + 1} times: a configuration picks one variant for each variation point`;
		return choice.problem;
	}

	/**
	 * The problems to list: a configuration that leaves a variation point
	 * open, picks something that isn't one of its variants, or picks two.
	 * A choice whose name doesn't resolve is left to the unresolved-name
	 * error the model already reports.
	 */
	problems(): VariabilityProblem[] {
		const out: VariabilityProblem[] = [];
		for (const c of this.configurations) {
			const config = `\`${c.record.name}\``;
			for (const ch of c.choices) {
				const point = `\`${ch.point.record.name}\``;
				const variants = ch.point.variants.map((v) => `\`${v.name}\``).join(', ');
				// A choice inherited from a usage it specializes is that usage's problem, listed there.
				const own = !ch.by || ch.by.ownerId === c.record.id;
				if (!ch.by)
					out.push({
						record: c.record,
						message: `${config} leaves the variation point ${point} open: choose one of its variants (${variants || 'it has none'}) with \`:>> ${ch.point.record.name} = …\``,
						headerOnly: true
					});
				else if (own && ch.problem && !/doesn't resolve$/.test(ch.problem))
					out.push({
						record: ch.by,
						message: `${config}: ${ch.problem}`,
						headerOnly: false
					});
				if (own)
					for (const again of ch.again)
						out.push({
							record: again,
							message: `${config} chooses for ${point} more than once: a configuration picks one variant for each variation point`,
							headerOnly: false
						});
			}
		}
		return out;
	}

	/**
	 * The project's files with a configuration's choices made (only the
	 * files that change), or null when the name is no configuration. Choices
	 * with a problem are left as written.
	 */
	configuredFiles(
		name: string,
		spell: (typeId: string, context: ElementRecord) => string | null
	): SourceFile[] | null {
		const config = this.find(name);
		if (!config) return null;
		const ctx = this.ctx;
		const byPath = new Map<string, { from: number; to: number; text: string }[]>();
		const done = new Set<string>();
		for (const choice of config.choices) {
			if (!choice.variant || choice.again.length) continue;
			const root = this.declarationOf(choice.point);
			if (done.has(root.id) || root.span.from === undefined || root.span.to === undefined) continue;
			done.add(root.id);
			const written = ctx.textOf(root);
			const text = this.rewritten(root, choice, written, spell);
			if (text === null) continue;
			const list = byPath.get(root.path) ?? [];
			list.push({ from: root.span.from, to: root.span.to, text: keepLines(text, written) });
			byPath.set(root.path, list);
		}
		const out: SourceFile[] = [];
		for (const [path, changes] of byPath) {
			let text = ctx.texts.get(path) ?? '';
			for (const c of changes.toSorted((a, b) => b.from - a.from))
				text = text.slice(0, c.from) + c.text + text.slice(c.to);
			out.push({ path, text });
		}
		return out;
	}

	/** The declaration a point stands for: the feature it redefines (`drone::battery`), else itself. */
	private declarationOf(point: Point): ElementRecord {
		const rooted = point.record.rootId ? this.ctx.byId.get(point.record.rootId) : undefined;
		return rooted && this.ctx.isContent(rooted) ? rooted : point.record;
	}

	/** A point's declaration rewritten as the chosen variant, on one line. */
	private rewritten(
		root: ElementRecord,
		choice: Choice,
		written: string,
		spell: (typeId: string, context: ElementRecord) => string | null
	): string | null {
		const ctx = this.ctx;
		const variant = choice.variant!;
		const point = choice.point;
		const header = headerOf(written);
		if (header === null) return null;
		// The variant's type: its own, else what it specializes gives it, else the variation's.
		const typeId =
			variant.typeIds[0] ??
			ctx.effectiveType(variant) ??
			(point.variation.isDefinition ? point.variation.generalIds[0] : point.variation.typeIds[0]) ??
			root.typeIds[0] ??
			null;
		const type = typeId ? spell(typeId, root) : null;
		let head = header.replace(/(^|\s)variation\s+/, '$1').trimEnd();
		const value = topLevelIndex(head, /(?<![=<>!:])=(?!=)|:=|\bdefault\b/);
		if (value >= 0) head = head.slice(0, value).trimEnd();
		if (type) {
			const typing =
				/(?<![:>~])\s*(?::(?![:>])|\btyped\s+by\b)\s*~?\s*(?:'[^']*'|[\w$]+)(?:\s*::\s*(?:'[^']*'|[\w$]+))*/.exec(
					maskQuoted(head)
				);
			if (typing)
				head = `${head.slice(0, typing.index)} : ${type}${head.slice(typing.index + typing[0].length)}`;
			else head = withTypeAfterName(head, root.written ?? root.name ?? '', type);
		}
		// Members: the variant's, then those of what it specializes, the variation's common ones,
		// then the declaration's own — the first of each name wins.
		const sources: { owner: ElementRecord; anonymous: boolean }[] = [
			{ owner: variant, anonymous: true }
		];
		for (
			let at = ctx.subsettedUsage(variant), i = 0;
			at && i < 16;
			at = ctx.subsettedUsage(at), i++
		)
			sources.push({ owner: at, anonymous: true });
		if (point.variation.id !== root.id) sources.push({ owner: point.variation, anonymous: false });
		if (point.record.id !== root.id && point.record.id !== point.variation.id)
			sources.push({ owner: point.record, anonymous: false });
		sources.push({ owner: root, anonymous: true });
		const names = new Set<string>();
		const members: string[] = [];
		for (const { owner, anonymous } of sources)
			for (const m of ctx.ownedBy(owner.id)) {
				if (m.membership === VARIANT) continue;
				if (m.name) {
					if (names.has(m.name)) continue;
					names.add(m.name);
				} else if (!anonymous) continue;
				const text = ctx.textOf(m);
				if (text) members.push(oneLine(text));
			}
		const docs = [variant, ...sources.map((s) => s.owner)].find((r) => r.docs.length)?.docs ?? [];
		const doc = `doc /* ${variant.name}${docs.length ? `: ${oneLine(docs.join(' ')).replace(/\*\//g, '* /')}` : ''} */`;
		return `${oneLine(head)} { ${[doc, ...members].join(' ')} }`;
	}
}

/** `(a, b)` → `a`, `b`; `a` → `a`. */
function listItems(value: string): string[] {
	const text = value.trim();
	const inner = text.startsWith('(') && text.endsWith(')') ? text.slice(1, -1) : text;
	const out: string[] = [];
	let depth = 0;
	let quoted = false;
	let start = 0;
	for (let i = 0; i < inner.length; i++) {
		const c = inner[i]!;
		if (c === "'") quoted = !quoted;
		else if (quoted) continue;
		else if (c === '(' || c === '[' || c === '{') depth++;
		else if (c === ')' || c === ']' || c === '}') depth--;
		else if (c === ',' && depth === 0) {
			out.push(inner.slice(start, i).trim());
			start = i + 1;
		}
	}
	out.push(inner.slice(start).trim());
	return out.filter(Boolean);
}

/** Quoted names and strings blanked out (same length), so patterns don't look inside them. */
function maskQuoted(text: string): string {
	return text.replace(
		/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g,
		(q) => q[0] + '_'.repeat(q.length - 2) + q[0]
	);
}

/** Where `pattern` first matches outside quotes, or -1. */
function topLevelIndex(text: string, pattern: RegExp): number {
	return maskQuoted(text).search(pattern);
}

/** A declaration's text up to its body or its `;`, or null when it has neither. */
function headerOf(text: string): string | null {
	let i = 0;
	while (i < text.length) {
		const c = text[i]!;
		if (c === '/' && text[i + 1] === '/') i = skipTo(text, i, '\n');
		else if (c === '/' && text[i + 1] === '*') i = skipTo(text, i + 2, '*/') + 1;
		else if (c === "'" || c === '"') i = skipQuoted(text, i);
		else if (c === '{' || c === ';') return text.slice(0, i);
		i++;
	}
	return null;
}

function skipTo(text: string, from: number, end: string): number {
	const at = text.indexOf(end, from);
	return at < 0 ? text.length : at;
}

function skipQuoted(text: string, from: number): number {
	const quote = text[from]!;
	let i = from + 1;
	while (i < text.length && text[i] !== quote) i += text[i] === '\\' ? 2 : 1;
	return i;
}

/** ` : T` after the declared name (and its short name), for a declaration without a type. */
function withTypeAfterName(head: string, name: string, type: string): string {
	const at = name ? maskQuoted(head).lastIndexOf(name) : -1;
	if (at < 0) return `${head} : ${type}`;
	let end = at + name.length;
	const short = /^\s*<[^>]*>/.exec(head.slice(end));
	if (short) end += short[0].length;
	return `${head.slice(0, end)} : ${type}${head.slice(end)}`;
}

/**
 * Text on one line: `//` comments dropped, every run of white space (line
 * breaks too, and a block comment's leading `*`s) one space; strings and
 * quoted names as written.
 */
export function oneLine(text: string): string {
	let out = '';
	let i = 0;
	const space = () => {
		if (out && !out.endsWith(' ')) out += ' ';
	};
	while (i < text.length) {
		const c = text[i]!;
		if (c === '/' && text[i + 1] === '/') {
			i = skipTo(text, i, '\n');
			space();
		} else if (c === '/' && text[i + 1] === '*') {
			const end = skipTo(text, i + 2, '*/');
			const body = text
				.slice(i + 2, end)
				.replace(/\n\s*\*(?!\/)/g, ' ')
				.replace(/\s+/g, ' ');
			out += `/*${body}*/`;
			i = end + 2;
		} else if (c === "'" || c === '"') {
			const end = skipQuoted(text, i);
			out += text.slice(i, end + 1);
			i = end + 1;
		} else if (/\s/.test(c)) {
			space();
			i++;
		} else {
			out += c;
			i++;
		}
	}
	return out.trim();
}

/**
 * The rewritten text in the place of `written`: as many line breaks after
 * it, and padded with spaces to the same length when shorter, so the rest
 * of the file keeps its lines (and its offsets when it can).
 */
function keepLines(text: string, written: string): string {
	const breaks = written.split('\n').length - 1;
	const pad = Math.max(0, written.length - breaks - text.length);
	return text + ' '.repeat(pad) + '\n'.repeat(breaks);
}
