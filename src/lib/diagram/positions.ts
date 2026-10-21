/**
 * Diagram layout the person controls: node positions they set by dragging,
 * kept per diagram in the project file `layout/diagrams.json`
 * (`{ "<view>:<scope>": { "<nodeId>": [x, y] } }`). Layout is not SysML, so
 * it lives beside the model, but it is saved and exported with it.
 */

export const LAYOUT_FILE = 'layout/diagrams.json';

export type Point = [number, number];
export type DiagramPositions = Record<string, Point>;
export type LayoutFile = Record<string, DiagramPositions>;

export interface XY {
	x: number;
	y: number;
}

export interface Box extends XY {
	id: string;
	width: number;
	height: number;
}

/** The key of one diagram in the layout file. */
export function diagramKey(view: string, scope: string | null): string {
	return `${view}:${scope ?? ''}`;
}

/** Read the layout file, ignoring anything that is not a position. */
export function parseLayout(text: string | undefined): LayoutFile {
	if (!text?.trim()) return {};
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return {};
	}
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
	const file: LayoutFile = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
		const positions: DiagramPositions = {};
		for (const [id, point] of Object.entries(value as Record<string, unknown>)) {
			if (
				Array.isArray(point) &&
				point.length === 2 &&
				point.every((n) => typeof n === 'number' && Number.isFinite(n))
			) {
				positions[id] = [point[0], point[1]];
			}
		}
		if (Object.keys(positions).length) file[key] = positions;
	}
	return file;
}

/** Stable, diff-friendly JSON: one node per line, keys sorted. */
export function serializeLayout(file: LayoutFile): string {
	const keys = Object.keys(file)
		.filter((k) => Object.keys(file[k] ?? {}).length)
		.sort();
	if (!keys.length) return '{}\n';
	const diagrams = keys.map((key) => {
		const positions = file[key]!;
		const lines = Object.keys(positions)
			.sort()
			.map((id) => {
				const [x, y] = positions[id]!;
				return `\t\t${JSON.stringify(id)}: [${Math.round(x)}, ${Math.round(y)}]`;
			});
		return `\t${JSON.stringify(key)}: {\n${lines.join(',\n')}\n\t}`;
	});
	return `{\n${diagrams.join(',\n')}\n}\n`;
}

/** The file with one diagram's positions merged in (`null` clears that diagram). */
export function withPositions(
	file: LayoutFile,
	key: string,
	positions: Record<string, XY> | null
): LayoutFile {
	const next = { ...file };
	if (positions === null) {
		delete next[key];
		return next;
	}
	const merged: DiagramPositions = { ...(next[key] ?? {}) };
	for (const [id, p] of Object.entries(positions)) merged[id] = [Math.round(p.x), Math.round(p.y)];
	next[key] = merged;
	return next;
}

/**
 * When exactly one node went away and one appeared, it was most likely
 * renamed: return [old id, new id] so its position can follow.
 */
export function renamedNode(before: string[], after: string[]): [string, string] | null {
	const next = new Set(after);
	const prev = new Set(before);
	const gone = before.filter((id) => !next.has(id));
	const added = after.filter((id) => !prev.has(id));
	if (gone.length !== 1 || added.length !== 1) return null;
	return [gone[0]!, added[0]!];
}

const GAP = 28;

function overlaps(a: Box, b: Box): boolean {
	return (
		a.x < b.x + b.width + GAP &&
		b.x < a.x + a.width + GAP &&
		a.y < b.y + b.height + GAP &&
		b.y < a.y + a.height + GAP
	);
}

/**
 * Place nodes around the ones whose position is fixed. `auto` is ELK's
 * layout of the whole graph; free nodes keep their place relative to the
 * fixed ones (ELK's arrangement shifted onto them) and step aside, nearest
 * first, when that spot is taken.
 */
export function placeAround(auto: Box[], fixed: Map<string, XY>): Map<string, XY> {
	const result = new Map<string, XY>();
	const anchored = auto.filter((b) => fixed.has(b.id));
	if (!anchored.length) {
		for (const b of auto) result.set(b.id, { x: b.x, y: b.y });
		return result;
	}
	let dx = 0;
	let dy = 0;
	for (const b of anchored) {
		const p = fixed.get(b.id)!;
		dx += p.x - b.x;
		dy += p.y - b.y;
	}
	dx /= anchored.length;
	dy /= anchored.length;

	const placed: Box[] = anchored.map((b) => ({ ...b, ...fixed.get(b.id)! }));
	for (const b of placed) result.set(b.id, { x: b.x, y: b.y });
	for (const b of auto) {
		if (fixed.has(b.id)) continue;
		const box = { ...b, x: Math.round(b.x + dx), y: Math.round(b.y + dy) };
		const spot = freeSpot(box, placed);
		placed.push(spot);
		result.set(b.id, { x: spot.x, y: spot.y });
	}
	return result;
}

/** The nearest position to `box` that overlaps nothing in `placed`. */
export function freeSpot(box: Box, placed: Box[]): Box {
	if (!placed.some((p) => overlaps(box, p))) return box;
	const step = 40;
	for (let ring = 1; ring < 60; ring++) {
		const candidates: Box[] = [];
		for (let i = -ring; i <= ring; i++) {
			candidates.push(
				{ ...box, x: box.x + i * step, y: box.y + ring * step },
				{ ...box, x: box.x + ring * step, y: box.y + i * step },
				{ ...box, x: box.x + i * step, y: box.y - ring * step },
				{ ...box, x: box.x - ring * step, y: box.y + i * step }
			);
		}
		candidates.sort(
			(a, b) => Math.hypot(a.x - box.x, a.y - box.y) - Math.hypot(b.x - box.x, b.y - box.y)
		);
		const free = candidates.find((c) => !placed.some((p) => overlaps(c, p)));
		if (free) return free;
	}
	return box;
}
