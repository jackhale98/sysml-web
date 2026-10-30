/**
 * Command palette logic: the items it can offer, a forgiving fuzzy matcher
 * and the ranking/grouping of results. Pure and DOM-free so it can be tested.
 */
import type { ModelElement, TreeNode } from '#lib/project/elements.ts';
import { keywordOf } from '#lib/ui/kinds.ts';
import type { ViewInfo } from '#lib/engine/types.ts';
import type { CreateRequest, FileLayout, FileRequest, Tab } from './ui.svelte.ts';
import { viewTitle } from './views.ts';

/** A half-open `[start, end)` range of UTF-16 offsets into a string. */
export type Range = readonly [start: number, end: number];

export type PaletteGroup = 'rows' | 'elements' | 'views' | 'files' | 'commands' | 'help';

/** Display order of the groups. */
export const GROUPS: readonly PaletteGroup[] = [
	'rows',
	'elements',
	'views',
	'files',
	'commands',
	'help'
];

export const GROUP_HEADINGS: Record<PaletteGroup, string> = {
	rows: 'In this table',
	elements: 'Elements',
	views: 'Views',
	files: 'Files',
	commands: 'Commands',
	help: 'Help'
};

/** A query starting with this searches the help only. */
export const HELP_PREFIX = '?';
/** Help topics offered for a query (all of them for a bare `?`). */
export const MAX_HELP = 8;

export const MAX_ELEMENTS = 8;
/** Rows of the open table offered before everything else. */
export const MAX_ROWS = 6;
export const MAX_RESULTS = 50;
/** Views offered before the person types anything. */
export const DEFAULT_VIEWS = 6;

export type PaletteAction =
	| { type: 'element'; key: string; file: string }
	/** Go to a row of the open table (`index` into its rendered rows). */
	| { type: 'row'; view: string; index: number }
	/** Show only the open table's rows that match `query`. */
	| { type: 'filter'; view: string; query: string }
	| { type: 'open'; tab: Tab }
	| { type: 'layout'; layout: FileLayout }
	| { type: 'toggle-inspector' }
	| { type: 'show-problems' }
	| { type: 'switch-theme' }
	| { type: 'import-requirements' }
	| { type: 'export-json' }
	| { type: 'api-server' }
	/** Open a guided form (`#lib/create`). */
	| { type: 'create'; request: CreateRequest }
	/** Make a file, or rename, move or delete one (`files/FileHost.svelte`). */
	| { type: 'file'; request: FileRequest }
	/** Copy an element under a new name, right after it. */
	| { type: 'duplicate'; key: string }
	/** Open the help, at a topic or at the start. */
	| { type: 'help'; topic: string | null };

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
	/** Only offered for a query, not in the list shown before typing. */
	quiet?: boolean;
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
	/** The help's topics. */
	help?: readonly PaletteItem[];
	/** Rows of the table on screen, when one is. */
	rows?: readonly PaletteItem[];
	/** That table, to offer filtering it: `count` is how many rows its own search keeps. */
	table?: { view: string; title: string; count: (query: string) => number };
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

/** One command per state machine: run it in the emulator. */
export function machineItems(
	machines: readonly { name: string; qualifiedName?: string }[]
): PaletteItem[] {
	return machines.map((m) => {
		const machine = m.qualifiedName ?? m.name;
		return {
			id: `emulate:${machine}`,
			group: 'commands' as const,
			label: `Run ${m.name}`,
			keyword: 'state machine',
			aliases: `simulate emulate ${machine}`,
			kind: 'state',
			isDefinition: true,
			action: { type: 'open' as const, tab: { kind: 'emulator' as const, machine, title: m.name } }
		};
	});
}

/** One command per action flow that can run: run it step by step. */
export function flowItems(
	flows: readonly { name: string; qualifiedName?: string; runnable: boolean }[]
): PaletteItem[] {
	return flows
		.filter((f) => f.runnable)
		.map((f) => {
			const action = f.qualifiedName ?? f.name;
			return {
				id: `run-flow:${action}`,
				group: 'commands' as const,
				label: `Run ${f.name}`,
				keyword: 'action flow',
				aliases: `simulate run action flow ${action}`,
				kind: 'action',
				isDefinition: true,
				action: { type: 'open' as const, tab: { kind: 'flow' as const, action, title: f.name } }
			};
		});
}

/** The model's own views (saved diagrams and tables) and the standard tables. */
export function modelViewItems(views: readonly ViewInfo[]): PaletteItem[] {
	return (
		views
			// The bare view defs (`BillOfMaterials`) are made into saved views with "New view: …".
			.filter((v) => v.isUsage && !v.builtin && !v.file.startsWith('libraries/'))
			.map((v) => ({
				id: `model-view:${v.qualifiedName ?? v.name}`,
				group: 'views' as const,
				label: viewTitle(v.name),
				keyword: `view : ${v.definition ?? ''}`,
				aliases: v.name,
				kind: 'view',
				isDefinition: false,
				action: {
					type: 'open' as const,
					tab: { kind: 'view' as const, name: v.name, title: viewTitle(v.name) }
				}
			}))
	);
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
		command('requirements', 'Open requirements', { type: 'open', tab: { kind: 'requirements' } }),
		command(
			'review',
			'Review changes',
			{ type: 'open', tab: { kind: 'review' } },
			{ aliases: 'diff compare semantic what changed version pull request' }
		),
		command(
			'new-view',
			'New view…',
			{ type: 'create', request: { kind: 'view' } },
			{ aliases: 'create add table diagram budget report saved view', kind: 'view' }
		),
		command(
			'new-trade-study',
			'New trade study…',
			{ type: 'create', request: { kind: 'trade' } },
			{ aliases: 'create compare alternatives options choose decision matrix weighted score' }
		),
		command(
			'new-fmea',
			'New FMEA…',
			{ type: 'create', request: { kind: 'fmea' } },
			{
				aliases:
					'create risk failure mode effects analysis dfmea pfmea ufmea design process use error worksheet rpn'
			}
		),
		command(
			'risk-policy',
			'Risk policy…',
			{ type: 'create', request: { kind: 'riskPolicy' } },
			{
				aliases: 'risk accept alarp reduce matrix zones rpn thresholds iso 14971 bands'
			}
		),
		command(
			'new-hazard',
			'New hazard…',
			{ type: 'create', request: { kind: 'hazard' } },
			{ aliases: 'create risk harm severity hazard log risk control iso 14971 safety' }
		),
		command(
			'new-dsm',
			'New DSM…',
			{ type: 'create', request: { kind: 'dsm' } },
			{
				aliases:
					'create dependency matrix design structure n2 n-squared interface chart modules coupling change impact'
			}
		),
		command(
			'new-file',
			'New file…',
			{ type: 'file', request: { kind: 'new' } },
			{ aliases: 'create add sysml file package folder' }
		),
		command(
			'import-requirements',
			'Import requirements…',
			{ type: 'import-requirements' },
			{ aliases: 'excel xlsx csv spreadsheet paste upload' }
		),
		command(
			'export-json',
			'Download as SysML v2 JSON…',
			{ type: 'export-json' },
			{ aliases: 'export json interchange kerml omg standard file other tools save download' }
		),
		command(
			'api-server',
			'Connect to a SysML v2 API server…',
			{ type: 'api-server' },
			{ aliases: 'rest api syson pilot server open save push pull commit systems modeling' }
		),
		command(
			'help',
			'Help',
			{ type: 'help', topic: null },
			{
				keyword: '?',
				detail: 'Type ? to search it',
				aliases: 'guide how do i learn explain shortcuts keyboard'
			}
		)
	];
}

/** Rename, move and delete the file on show (none when no file is). */
export function openFileItems(path: string | null): PaletteItem[] {
	if (!path) return [];
	const name = baseName(path);
	const item = (
		kind: 'rename' | 'move' | 'delete',
		label: string,
		aliases: string
	): PaletteItem => ({
		id: `command:${kind}-file`,
		group: 'commands',
		label,
		detail: name,
		aliases,
		action: { type: 'file', request: { kind, path } }
	});
	return [
		item('rename', 'Rename file', 'file name path'),
		item('move', 'Move file', 'file folder directory path'),
		item('delete', 'Delete file', 'file remove trash')
	];
}

/** What can be done with the selected element (none when nothing is, or it is a library's). */
export function selectionItems(
	element: ModelElement | undefined,
	isLibrary: (file: string) => boolean
): PaletteItem[] {
	if (!element || isLibrary(element.file)) return [];
	return [
		{
			id: 'command:duplicate',
			group: 'commands',
			label: `Duplicate ${element.label}`,
			detail: 'Ctrl+D or ⌘D',
			aliases: 'copy clone',
			action: { type: 'duplicate', key: element.key }
		}
	];
}

/** "Help: Add a part", one per topic of the help (offered for a query, or after `?`). */
export function helpItems(
	topics: readonly { id: string; title: string; keywords?: string }[]
): PaletteItem[] {
	return topics.map((t) => ({
		id: `help:${t.id}`,
		group: 'help' as const,
		label: `Help: ${t.title}`,
		aliases: t.keywords ?? '',
		quiet: true,
		action: { type: 'help' as const, topic: t.id }
	}));
}

/** "New view: Bill of materials", one per kind of view the form makes (offered for a query). */
export function newViewItems(
	kinds: readonly { id: string; label: string; description: string }[]
): PaletteItem[] {
	return kinds.map((k) => ({
		id: `command:new-view:${k.id}`,
		group: 'commands' as const,
		label: `New view: ${k.label}`,
		detail: k.description,
		aliases: 'create add saved view',
		kind: 'view',
		quiet: true,
		action: { type: 'create' as const, request: { kind: 'view' as const, viewKind: k.id } }
	}));
}

/**
 * The rows of a rendered table as palette items: found by any cell, named by
 * the table's title (or name) column, with its ID column as the short id.
 */
export function tableRowItems(
	view: string,
	title: string,
	columns: readonly string[],
	rows: readonly (readonly string[])[]
): PaletteItem[] {
	const find = (pattern: RegExp) => columns.findIndex((c) => pattern.test(c.trim()));
	const id = find(/^(id|short ?name|req(uirement)? ?id|number)$/i);
	let name = find(/^(title|name|element)$/i);
	if (name < 0) name = columns.findIndex((_, i) => i !== id);
	return rows.map((cells, index) => {
		const label = cells[name] || cells.find(Boolean) || `Row ${index + 1}`;
		return {
			id: `row:${view}:${index}`,
			group: 'rows' as const,
			label,
			shortId: id >= 0 ? cells[id] || null : null,
			detail: title,
			aliases: cells
				.filter((_, i) => i !== name && i !== id)
				.join(' · ')
				.slice(0, 400),
			action: { type: 'row' as const, view, index }
		};
	});
}

// ---------------------------------------------------------------------------
// Search

export function rank(items: readonly PaletteItem[], query: string): PaletteResult[] {
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
	if (q.startsWith(HELP_PREFIX)) {
		const rest = q.slice(HELP_PREFIX.length).trim();
		const help = sources.help ?? [];
		return rest ? rank(help, rest) : help.map((item) => ({ item, match: null }));
	}
	if (!q) {
		return [
			...sources.views.slice(0, DEFAULT_VIEWS),
			...sources.commands.filter((c) => !c.quiet)
		].map((item) => ({
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

	// In a table, its rows come first, with a way to show only the ones that match.
	const rowHits = rank(sources.rows ?? [], q);
	const rows: PaletteResult[] = rowHits.slice(0, MAX_ROWS);
	const kept = sources.table?.count(q) ?? 0;
	if (sources.table && kept > 1) {
		const { view, title } = sources.table;
		rows.push({
			item: {
				id: `filter:${view}`,
				group: 'rows',
				label: `Show only the ${kept} rows matching “${q}”`,
				detail: title,
				action: { type: 'filter', view, query: q }
			},
			match: null
		});
	}

	const help = rank(sources.help ?? [], q).slice(0, MAX_HELP);
	return [
		...rows,
		...elements.slice(0, MAX_ELEMENTS),
		...views,
		...files,
		...commands,
		...help
	].slice(0, MAX_RESULTS);
}
