/**
 * Command palette logic: the items it can offer, a forgiving fuzzy matcher
 * and the ranking/grouping of results. Pure and DOM-free so it can be tested.
 */
import type { ModelElement, TreeNode } from '#lib/project/elements.ts';
import { keywordOf } from '#lib/ui/kinds.ts';
import type { FileLayout, Tab } from './ui.svelte.ts';

/** A half-open `[start, end)` range of UTF-16 offsets into a string. */
export type Range = readonly [start: number, end: number];

export type PaletteGroup = 'elements' | 'views' | 'files' | 'commands';

/** Display order of the groups. */
export const GROUPS: readonly PaletteGroup[] = ['elements', 'views', 'files', 'commands'];

export const GROUP_HEADINGS: Record<PaletteGroup, string> = {
	elements: 'Elements',
	views: 'Views',
	files: 'Files',
	commands: 'Commands'
};

export const MAX_ELEMENTS = 8;
export const MAX_RESULTS = 50;
/** Views offered before the person types anything. */
export const DEFAULT_VIEWS = 6;

export type PaletteAction =
	| { type: 'element'; key: string; file: string }
	| { type: 'open'; tab: Tab }
	| { type: 'layout'; layout: FileLayout }
	| { type: 'toggle-inspector' }
	| { type: 'show-problems' }
	| { type: 'switch-theme' };

export interface PaletteItem {
	/** Unique across all groups. */
	id: string;
	group: PaletteGroup;
	label: string;
	/** Short id such as `SYS-001` (elements). */
	shortId?: string | null;
	/** The SysML keyword (`part def`) or a short descriptor, shown dimmed. */
	keyword?: string;
	/** Secondary text that is shown but never matched, e.g. the file name. */
	detail?: string;
	/** Extra words that find the item without being shown. */
	aliases?: string;
	/** Element glyph. */
	kind?: string;
	isDefinition?: boolean;
	/** Element from a library file. */
	library?: boolean;
	action: PaletteAction;
}

export type MatchField = 'label' | 'shortId' | 'keyword' | 'aliases';

export interface ItemMatch {
	score: number;
	/** Matched characters per displayed field. */
	ranges: Partial<Record<MatchField, Range[]>>;
}

export interface PaletteResult {
	item: PaletteItem;
	/** `null` when there is no query. */
	match: ItemMatch | null;
}

export interface PaletteSources {
	elements: readonly PaletteItem[];
	views: readonly PaletteItem[];
	files: readonly PaletteItem[];
	commands: readonly PaletteItem[];
}

// ---------------------------------------------------------------------------
// Fuzzy matching

const TIER_PREFIX = 1000;
const TIER_WORD_START = 800;
const TIER_SUBSTRING = 600;
const TIER_ACRONYM = 450;
const TIER_SUBSEQUENCE = 300;

/** Lower-case without changing string length, so offsets stay valid. */
function lowerOf(text: string): string {
	const lower = text.toLowerCase();
	if (lower.length === text.length) return lower;
	let out = '';
	for (const ch of text) {
		const l = ch.toLowerCase();
		out += l.length === ch.length ? l : ch;
	}
	return out;
}

const ALNUM = /[\p{L}\p{N}]/u;

/** Whether a word starts at `i`: after a separator, or at a camelCase hump. */
function isWordStart(text: string, i: number): boolean {
	if (i === 0) return true;
	const prev = text.charAt(i - 1);
	const cur = text.charAt(i);
	if (!ALNUM.test(prev)) return true;
	return prev !== prev.toUpperCase() && cur !== cur.toLowerCase();
}

interface TokenMatch {
	score: number;
	ranges: Range[];
}

/** Match one lower-case token against a text; `null` when it cannot. */
function matchToken(token: string, text: string, lower: string): TokenMatch | null {
	const n = token.length;
	// Longer texts rank slightly below shorter ones within a tier.
	const lengthPenalty = Math.min(text.length, 100) * 0.2;

	const first = lower.indexOf(token);
	if (first >= 0) {
		if (first === 0) {
			const exact = text.length === n ? 100 : 0;
			return { score: TIER_PREFIX + exact - lengthPenalty, ranges: [[0, n]] };
		}
		let at = first;
		while (at >= 0 && !isWordStart(text, at)) at = lower.indexOf(token, at + 1);
		if (at >= 0) {
			return {
				score: TIER_WORD_START - Math.min(at, 100) * 0.5 - lengthPenalty,
				ranges: [[at, at + n]]
			};
		}
		return {
			score: TIER_SUBSTRING - Math.min(first, 100) * 0.5 - lengthPenalty,
			ranges: [[first, first + n]]
		};
	}
	if (n < 2) return null;

	// Initials of successive words: "bms" finds "BatteryManagementSystem".
	const acronym: number[] = [];
	for (let i = 0, t = 0; i < lower.length && t < n; i++) {
		if (lower.charAt(i) === token.charAt(t) && isWordStart(text, i)) {
			acronym.push(i);
			t++;
		}
	}
	if (acronym.length === n) {
		return {
			score: TIER_ACRONYM - lengthPenalty,
			ranges: acronym.map((i): Range => [i, i + 1])
		};
	}

	// Subsequence: the tightest run of in-order characters.
	let best: number[] | null = null;
	let bestSpan = Infinity;
	let tries = 0;
	for (
		let s = lower.indexOf(token.charAt(0));
		s >= 0 && tries < 24;
		s = lower.indexOf(token.charAt(0), s + 1)
	) {
		tries++;
		const picked = [s];
		let from = s + 1;
		for (let t = 1; t < n; t++) {
			const at = lower.indexOf(token.charAt(t), from);
			if (at < 0) break;
			picked.push(at);
			from = at + 1;
		}
		if (picked.length < n) break; // later starts cannot do better
		const span = from - s;
		if (span < bestSpan) {
			best = picked;
			bestSpan = span;
		}
	}
	if (!best || bestSpan > n * 4 + 2) return null;
	const gap = Math.min((bestSpan - n) * 3, 120);
	return { score: TIER_SUBSEQUENCE - gap - lengthPenalty, ranges: mergeRanges(best.map(single)) };
}

function single(i: number): Range {
	return [i, i + 1];
}

/** Sort ranges and join those that touch or overlap. */
export function mergeRanges(ranges: readonly Range[]): Range[] {
	const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const merged: [number, number][] = [];
	for (const [start, end] of sorted) {
		const last = merged[merged.length - 1];
		if (last && start <= last[1]) last[1] = Math.max(last[1], end);
		else merged.push([start, end]);
	}
	return merged;
}

export interface MatchTarget {
	field: MatchField;
	text: string;
	/** How much a hit on this field counts (1 = full). */
	weight: number;
}

/**
 * Match a query against several fields. The query is split on spaces; every
 * word must match some field (case-insensitively), and each is scored by its
 * best field. Per word: prefix > word start > substring > subsequence.
 */
export function matchFields(query: string, targets: readonly MatchTarget[]): ItemMatch | null {
	const tokens = lowerOf(query).split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return { score: 0, ranges: {} };
	const lowers = targets.map((t) => lowerOf(t.text));
	const ranges: Partial<Record<MatchField, Range[]>> = {};
	let total = 0;
	for (const token of tokens) {
		let best: { score: number; field: MatchField; ranges: Range[] } | null = null;
		for (const [i, target] of targets.entries()) {
			if (!target.text) continue;
			const m = matchToken(token, target.text, lowers[i] ?? target.text);
			if (!m) continue;
			const score = m.score * target.weight;
			if (!best || score > best.score) best = { score, field: target.field, ranges: m.ranges };
		}
		if (!best) return null;
		const hit = best;
		total += hit.score;
		ranges[hit.field] = [...(ranges[hit.field] ?? []), ...hit.ranges];
	}
	for (const field of Object.keys(ranges) as MatchField[]) {
		ranges[field] = mergeRanges(ranges[field] ?? []);
	}
	return { score: total / tokens.length, ranges };
}

/** Score a single string; `null` when the query does not match. */
export function fuzzyMatch(query: string, text: string): { score: number; ranges: Range[] } | null {
	const m = matchFields(query, [{ field: 'label', text, weight: 1 }]);
	return m ? { score: m.score, ranges: m.ranges.label ?? [] } : null;
}

export function matchItem(query: string, item: PaletteItem): ItemMatch | null {
	return matchFields(query, [
		{ field: 'label', text: item.label, weight: 1 },
		{ field: 'shortId', text: item.shortId ?? '', weight: 1 },
		{ field: 'keyword', text: item.keyword ?? '', weight: 0.5 },
		{ field: 'aliases', text: item.aliases ?? '', weight: 0.4 }
	]);
}

export interface Segment {
	text: string;
	hit: boolean;
}

/** Split a text into plain and matched runs, for `<mark>` highlighting. */
export function segments(text: string, ranges: readonly Range[] | undefined): Segment[] {
	if (!ranges?.length) return [{ text, hit: false }];
	const out: Segment[] = [];
	let at = 0;
	for (const [start, end] of mergeRanges(ranges)) {
		const s = Math.max(start, at);
		const e = Math.min(end, text.length);
		if (e <= s) continue;
		if (s > at) out.push({ text: text.slice(at, s), hit: false });
		out.push({ text: text.slice(s, e), hit: true });
		at = e;
	}
	if (at < text.length) out.push({ text: text.slice(at), hit: false });
	return out;
}

// ---------------------------------------------------------------------------
// Items

function baseName(path: string): string {
	return path.split('/').pop() ?? path;
}

export function elementItems(
	elements: readonly ModelElement[],
	isLibrary: (file: string) => boolean
): PaletteItem[] {
	return elements.map((e) => ({
		id: `element:${e.key}`,
		group: 'elements',
		label: e.label,
		shortId: e.shortName,
		keyword: keywordOf(e.kind, e.isDefinition),
		detail: baseName(e.file),
		kind: e.kind,
		isDefinition: e.isDefinition,
		library: isLibrary(e.file),
		action: { type: 'element', key: e.key, file: e.file }
	}));
}

function descendants(node: TreeNode): number {
	return node.children.reduce((sum, c) => sum + 1 + descendants(c), 0);
}

/** A general view per package, the busiest packages first. */
export function viewItems(packages: readonly TreeNode[]): PaletteItem[] {
	return packages
		.map((node, order) => ({ node, order, size: descendants(node) }))
		.sort((a, b) => b.size - a.size || a.order - b.order)
		.map(({ node }) => ({
			id: `view:${node.element.key}`,
			group: 'views',
			label: node.element.label,
			keyword: 'general view',
			kind: 'package',
			isDefinition: false,
			action: {
				type: 'open',
				tab: {
					kind: 'diagram',
					view: 'general',
					scope: node.element.name,
					title: node.element.label
				}
			}
		}));
}

export function fileItems(paths: readonly string[]): PaletteItem[] {
	return paths.map((path) => ({
		id: `file:${path}`,
		group: 'files',
		label: path,
		action: { type: 'open', tab: { kind: 'file', path } }
	}));
}

export function commandItems(themeChoice: string): PaletteItem[] {
	const command = (
		id: string,
		label: string,
		action: PaletteAction,
		extra: Partial<PaletteItem> = {}
	): PaletteItem => ({ id: `command:${id}`, group: 'commands', label, action, ...extra });
	return [
		command(
			'text',
			'Show text only',
			{ type: 'layout', layout: 'text' },
			{ aliases: 'layout editor' }
		),
		command(
			'split',
			'Show text and diagram',
			{ type: 'layout', layout: 'split' },
			{ aliases: 'layout split side by side' }
		),
		command(
			'diagram',
			'Show diagram only',
			{ type: 'layout', layout: 'diagram' },
			{ aliases: 'layout graph' }
		),
		command(
			'inspector',
			'Toggle inspector',
			{ type: 'toggle-inspector' },
			{ aliases: 'panel details' }
		),
		command(
			'problems',
			'Show problems',
			{ type: 'show-problems' },
			{ aliases: 'diagnostics errors warnings' }
		),
		command(
			'theme',
			'Switch theme',
			{ type: 'switch-theme' },
			{ detail: `Now ${themeChoice}`, aliases: 'dark light mode appearance' }
		),
		command(
			'overview',
			'Open overview',
			{ type: 'open', tab: { kind: 'home' } },
			{ aliases: 'home' }
		),
		command('requirements', 'Open requirements', { type: 'open', tab: { kind: 'requirements' } })
	];
}

// ---------------------------------------------------------------------------
// Search

function rank(items: readonly PaletteItem[], query: string): PaletteResult[] {
	const hits: PaletteResult[] = [];
	for (const item of items) {
		const match = matchItem(query, item);
		if (match) hits.push({ item, match });
	}
	// Array#sort is stable, so equal scores keep their source order.
	return hits.sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0));
}

/**
 * The palette's results for a query, grouped in display order. Without a
 * query: the most useful views, then the commands.
 */
export function search(sources: PaletteSources, query: string): PaletteResult[] {
	const q = query.trim();
	if (!q) {
		return [...sources.views.slice(0, DEFAULT_VIEWS), ...sources.commands].map((item) => ({
			item,
			match: null
		}));
	}

	const views = rank(sources.views, q);
	const files = rank(sources.files, q);
	const commands = rank(sources.commands, q);
	let elements = rank(
		sources.elements.filter((e) => !e.library),
		q
	);
	// Library elements only turn up when nothing else does.
	if (q.length >= 2 && !elements.length && !views.length && !files.length && !commands.length) {
		elements = rank(
			sources.elements.filter((e) => e.library),
			q
		);
	}

	return [...elements.slice(0, MAX_ELEMENTS), ...views, ...files, ...commands].slice(
		0,
		MAX_RESULTS
	);
}
