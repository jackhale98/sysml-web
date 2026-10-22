/**
 * What the traceability matrices say, in words people read: element names
 * split from camel case (`batteryAbuseTest` → "Battery abuse test"), the
 * owner path beside them (`drone ›`), the gap a requirement with no link
 * is, and the grid as a spreadsheet exports it.
 */
import type { ExportTable } from '#lib/dataio/export.ts';
import type { TraceMatrix } from '#lib/engine/types.ts';

/** How each relation is worded. */
export const RELATION_WORDS = {
	satisfy: {
		by: 'Satisfied by',
		verb: 'is satisfied by',
		gap: 'Not satisfied',
		done: 'satisfied',
		what: 'design elements'
	},
	verify: {
		by: 'Verified by',
		verb: 'is verified by',
		gap: 'Not verified',
		done: 'verified',
		what: 'verification cases'
	}
} as const;

/**
 * A declared name for display: `batteryAbuseTest` → "Battery abuse test",
 * `GPSReceiver` → "GPS receiver", `battery_pack` → "Battery pack". A name
 * already in words (`'Flight endurance'`) is left as it is.
 */
export function humanize(name: string): string {
	const plain = name.replace(/^'|'$/g, '');
	if (!plain || /\s/.test(plain)) return plain;
	const words = plain
		.replace(/_+/g, ' ')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
		.split(/\s+/)
		.filter(Boolean);
	return words
		.map((w, i) => {
			if (w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w)) return w;
			return i === 0 ? w[0]!.toUpperCase() + w.slice(1) : w.toLowerCase();
		})
		.join(' ');
}

type Element = TraceMatrix['elements'][number];

/** "Flight controller", with "drone" before it where it is written `drone.flightController`. */
export function elementLabel(e: Element): { name: string; owner: string } {
	return { name: humanize(e.name), owner: e.path.join('.') };
}

/** One line: "Flight controller (drone)". */
export function elementText(e: Element): string {
	const { name, owner } = elementLabel(e);
	return owner ? `${name} (${owner})` : name;
}

/** The group an element's column belongs to: the first part of what is written (`drone` for `drone.battery`). */
export function groupOf(e: Element): string {
	return e.path[0] ?? e.written;
}

/**
 * Where each column's group starts and ends, among the columns shown: only
 * groups of more than one column are drawn as groups.
 */
export function groupEdges(
	elements: Element[],
	shown: number[]
): { first: boolean; last: boolean }[] {
	const keys = shown.map((c) => groupOf(elements[c]!));
	return keys.map((key, i) => {
		const size = keys.filter((k) => k === key).length;
		return {
			first: size > 1 && keys[i - 1] !== key,
			last: size > 1 && keys[i + 1] !== key
		};
	});
}

/** The requirement as one line: "SYS-001 Flight endurance". */
export function requirementText(r: TraceMatrix['requirements'][number]): string {
	return r.id ? `${r.id} ${r.title}` : r.title;
}

/** For each requirement, the columns it has a link in (in column order). */
export function marksByRow(matrix: TraceMatrix): number[][] {
	const out = matrix.requirements.map(() => new Set<number>());
	for (const link of matrix.links) out[link.row]?.add(link.column);
	return out.map((set) => [...set].sort((a, b) => a - b));
}

/**
 * The grid for a spreadsheet: ID and requirement, a column per element under
 * its readable name, ✓ where a link is, and how many each requirement has
 * (0 for a gap).
 */
export function matrixExport(
	matrix: TraceMatrix,
	rows: number[],
	meta: Pick<ExportTable, 'title' | 'project' | 'doc'>
): ExportTable {
	const marks = marksByRow(matrix);
	return {
		...meta,
		header: ['ID', 'Requirement', ...matrix.elements.map(elementText), 'Total'],
		rows: rows.map((i) => {
			const r = matrix.requirements[i]!;
			const marked = marks[i] ?? [];
			return [
				r.id,
				r.title,
				...matrix.elements.map((_, c) => (marked.includes(c) ? '✓' : '')),
				String(marked.length)
			];
		})
	};
}
