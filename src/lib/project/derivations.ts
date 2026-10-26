/**
 * Requirement derivations (`#derivation connection { end #original ::> A;
 * end #derive ::> B; }`, SysML's RequirementDerivation), read from the text
 * with where each is written, and resolved to the project's requirements by
 * name as the requirements table names them. Comments are removed first, so
 * text inside them is never read as model.
 *
 * The coverage rule (`coverage.ts`) follows them, the specification report
 * draws its derivation tree from them, and a circle of them (A derived from
 * B derived from A) is a problem: it makes neither requirement come from a
 * need.
 */
import type { Diagnostic, Span } from '#lib/engine/types.ts';
import { utf16ToByte } from './elements';
import { unescapeName } from './names';
import type { RequirementRow } from './requirements';

/** The text with comments blanked out (same length, so offsets still match). */
export function withoutComments(text: string): string {
	return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
}

/** A name as written, without the spaces around `::`, `.` and `~`. */
function compact(reference: string): string {
	return reference.trim().replace(/\s*(::|\.|~)\s*/g, '$1');
}

const NAME = String.raw`(?:'(?:[^'\\]|\\.)*'|[\w$]+)`;
const QUALIFIED = String.raw`${NAME}(?:\s*::\s*${NAME})*`;

export interface Derivation {
	/** The requirement derived from, as written. */
	original: string;
	/** The requirements derived from it, as written. */
	derived: string[];
	file: string;
	/** Where the connection is written (UTF-16 offsets). */
	from?: number;
	to?: number;
}

/**
 * `#derivation connection { end #original ::> A; end #derive ::> B; … }`
 * (also `@Derivation` and `derivation connection` spellings).
 */
export function readDerivations(file: string, source: string): Derivation[] {
	if (!/derivation/i.test(source)) return [];
	const text = withoutComments(source);
	const out: Derivation[] = [];
	// No `\s*` ahead of `derivation`: blanked comments are long runs of spaces,
	// and one would be rescanned from each of them.
	const block = /(?:[#@]\s*)?derivation\s+connection\b[^{;]*\{([\s\S]*?)\}/gi;
	for (const match of text.matchAll(block)) {
		const body = match[1]!;
		const end = (role: string) =>
			[
				...body.matchAll(
					new RegExp(
						String.raw`end\s+#${role}\s+(?:${NAME}\s*)?(?:::>|references)\s*(${QUALIFIED})\s*;`,
						'g'
					)
				)
			].map((m) => compact(m[1]!));
		const original = end('original')[0];
		const derived = end('derive');
		const from = match.index! + match[0].search(/\S/);
		if (original && derived.length)
			out.push({ original, derived, file, from, to: match.index! + match[0].length });
	}
	return out;
}

/** Every model file's derivations. */
export function projectDerivations(
	texts: Record<string, string>,
	include: (path: string) => boolean = () => true
): Derivation[] {
	return Object.entries(texts)
		.filter(([path]) => /\.(sysml|kerml)$/.test(path) && include(path))
		.flatMap(([path, text]) => readDerivations(path, text));
}

export interface DerivationLink {
	original: RequirementRow;
	derived: RequirementRow;
	/** The connection that states it. */
	at: Derivation;
}

/** Derivations between requirement rows: each name found by title or ID, in its own file first. */
export function derivationLinks(
	requirements: readonly RequirementRow[],
	derivations: readonly Derivation[]
): DerivationLink[] {
	return derivationEnds(requirements, derivations).flatMap((l) =>
		l.derived ? [{ ...l, derived: l.derived }] : []
	);
}

/**
 * The same, with the derived ends that don't resolve (`derived: null`): a
 * need whose derived requirement went missing (renamed in the text) isn't
 * covered through the ones left.
 */
export function derivationEnds(
	requirements: readonly RequirementRow[],
	derivations: readonly Derivation[]
): (Omit<DerivationLink, 'derived'> & { derived: RequirementRow | null })[] {
	const byName = new Map<string, RequirementRow[]>();
	for (const r of requirements)
		for (const name of new Set([r.title, r.id ?? '']))
			if (name) byName.set(name, [...(byName.get(name) ?? []), r]);
	const find = (reference: string, file: string) => {
		const name = unescapeName(lastSegment(reference));
		const matches = byName.get(name) ?? [];
		return matches.find((r) => r.file === file) ?? matches[0];
	};
	return derivations.flatMap((d) => {
		const original = find(d.original, d.file);
		if (!original) return [];
		return d.derived.flatMap((name) => {
			const derived = find(name, d.file) ?? null;
			return derived !== original ? [{ original, derived, at: d }] : [];
		});
	});
}

function lastSegment(reference: string): string {
	const parts = reference.match(/'(?:[^'\\]|\\.)*'|[^:]+/g) ?? [reference];
	return parts[parts.length - 1]!.trim();
}

/**
 * Circles of derivation: requirements each derived, in turn, from the next,
 * back to the first. Each circle once, from the requirement written first.
 */
export function derivationCycles(links: readonly DerivationLink[]): DerivationLink[][] {
	const from = new Map<RequirementRow, DerivationLink[]>();
	for (const l of links) from.set(l.original, [...(from.get(l.original) ?? []), l]);
	const order = new Map<RequirementRow, number>();
	for (const l of links)
		for (const r of [l.original, l.derived]) if (!order.has(r)) order.set(r, order.size);
	const cycles: DerivationLink[][] = [];
	const seen = new Set<string>();
	// Depth first from each requirement, along derivations to ones written after it,
	// back to it: each circle is found once, from its first requirement.
	for (const start of order.keys()) {
		const rank = order.get(start)!;
		const walk = (at: RequirementRow, path: DerivationLink[], on: Set<RequirementRow>) => {
			for (const l of from.get(at) ?? []) {
				if (l.derived === start) {
					const cycle = [...path, l];
					const key = cycle.map((c) => c.derived.key).join(' ');
					if (!seen.has(key)) {
						seen.add(key);
						cycles.push(cycle);
					}
				} else if (order.get(l.derived)! > rank && !on.has(l.derived) && path.length < 32) {
					on.add(l.derived);
					walk(l.derived, [...path, l], on);
					on.delete(l.derived);
				}
			}
		};
		walk(start, [], new Set([start]));
	}
	return cycles;
}

/** How a requirement is named in a message: `SYS-001 Flight endurance`. */
function label(r: RequirementRow): string {
	return r.id ? `${r.id} ${r.title}` : r.title;
}

/** A warning at the first derivation of each circle, naming the whole circle. */
export function derivationCycleProblems(
	links: readonly DerivationLink[],
	textOf: (path: string) => string | undefined
): Diagnostic[] {
	return derivationCycles(links).flatMap((cycle) => {
		const first = cycle[0]!.at;
		const text = textOf(first.file);
		if (text === undefined || first.from === undefined || first.to === undefined) return [];
		const names = [...cycle.map((l) => label(l.original)), label(cycle[0]!.original)];
		return [
			{
				file: first.file,
				span: spanOf(text, first.from, first.to),
				severity: 'warning',
				code: 'derivation-cycle',
				message: `Circular derivation: ${names.join(' → ')}. A requirement can’t be derived, through others, from itself.`,
				explanation:
					'Derivation says where a requirement comes from. In a circle none of them comes from a need, and coverage through derived requirements can’t be worked out for them.'
			} satisfies Diagnostic
		];
	});
}

/** A span from UTF-16 offsets (lines and columns 1-based). */
export function spanOf(text: string, from: number, to: number): Span {
	const at = (offset: number) => {
		const before = text.slice(0, offset);
		const row = before.split('\n').length;
		return { row, col: offset - before.lastIndexOf('\n') };
	};
	const start = at(from);
	const end = at(to);
	return {
		start_row: start.row,
		start_col: start.col,
		end_row: end.row,
		end_col: end.col,
		start_byte: utf16ToByte(text, from),
		end_byte: utf16ToByte(text, to),
		from,
		to
	};
}
