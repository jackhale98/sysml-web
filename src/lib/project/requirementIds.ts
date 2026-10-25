/**
 * Requirement IDs (short names, `requirement <'SYS-001'> 'Flight endurance'`):
 * the name a requirement keeps when its title changes or it moves, which is
 * how reviews, spreadsheets and other tools refer to it. SysML text has no
 * other identity that survives a rename, so the app asks for one.
 *
 * - Two requirements with the same ID (ignoring case) are a warning at each,
 *   unless they are all in one namespace: the engine already reports that.
 * - A requirement written in a package without an ID is a note (shown in
 *   the editor, not listed as a problem), with the next free ID to use.
 *   Requirements inside another element (a sub-requirement, one in a part)
 *   are not asked for one.
 */
import type { Analysis, Diagnostic, Usage } from '#lib/engine/types.ts';
import { unescapeName } from './names';

const KINDS = new Set(['requirement', 'concern']);

interface Item {
	file: string;
	usage: Pick<Usage, 'kind' | 'name' | 'span' | 'short_name' | 'qualified_name'>;
	id: string | null;
	/** The package it is written in directly, by qualified name. */
	package: string | null;
	/** Whatever it is written in, by qualified name. */
	owner: string | null;
}

export function requirementIdProblems(analyses: readonly Analysis[]): Diagnostic[] {
	const packages = new Set(
		analyses.flatMap((a) =>
			a.model.definitions.filter((d) => d.kind === 'package').map((d) => d.qualified_name ?? d.name)
		)
	);
	const items: Item[] = analyses.flatMap(({ model }) =>
		[...model.definitions, ...model.usages]
			.filter((u) => KINDS.has(u.kind) && u.name)
			.map((usage) => ({
				file: model.file,
				usage,
				id: usage.short_name ? unescapeName(usage.short_name) : null,
				package: 'type_ref' in usage ? packageOf(usage, packages) : null,
				owner: ownerOf(usage)
			}))
	);

	const problems: Diagnostic[] = [];
	const byId = new Map<string, Item[]>();
	for (const item of items) {
		if (!item.id) continue;
		const key = item.id.toLowerCase();
		byId.set(key, [...(byId.get(key) ?? []), item]);
	}
	for (const same of byId.values()) {
		if (same.length < 2 || new Set(same.map((i) => i.owner)).size < 2) continue;
		for (const item of same) {
			const others = same.filter((o) => o !== item);
			problems.push({
				file: item.file,
				span: item.usage.span,
				severity: 'warning',
				code: 'requirement-id',
				message: `The ID ${item.id} is also used by ${others.map(describe).join(', ')}.`,
				explanation:
					'An ID names one requirement: links, reviews and spreadsheets that use it would not know which is meant.',
				suggestion: `Give one of them another ID, such as ${nextId(item, items)}.`
			});
		}
	}

	for (const item of items) {
		if (item.id || item.usage.kind !== 'requirement' || !item.package) continue;
		const suggested = nextId(item, items);
		problems.push({
			file: item.file,
			span: item.usage.span,
			severity: 'note',
			code: 'requirement-id',
			message: `${title(item)} has no ID.`,
			explanation:
				'An ID stays the same when the title changes or the requirement moves, so reviews, spreadsheets and other tools can follow it.',
			suggestion: `Set its ID in the details (such as ${suggested}), or write requirement <'${suggested}'> ${item.usage.name}.`
		});
	}
	return problems;
}

/** The package a usage is written in directly, or null when it is inside another element. */
function packageOf(usage: Pick<Usage, 'name' | 'qualified_name'>, packages: Set<string>) {
	const owner = ownerOf(usage);
	return owner !== null && packages.has(owner) ? owner : null;
}

/** `A::Sub` for `A::Sub::'Battery life'`; null for a usage without a qualified name. */
function ownerOf(usage: Pick<Usage, 'name' | 'qualified_name'>): string | null {
	const qualified = usage.qualified_name;
	if (!qualified) return null;
	const own = unescapeName(usage.name);
	for (let at = qualified.lastIndexOf('::'); at > 0; at = qualified.lastIndexOf('::', at - 1))
		if (unescapeName(qualified.slice(at + 2)) === own) return qualified.slice(0, at);
	return null;
}

function title(item: Item): string {
	return `‘${unescapeName(item.usage.name)}’`;
}

function describe(item: Item): string {
	return `${title(item)} (${item.file}:${item.usage.span.start_row})`;
}

/**
 * The next ID in the series its package uses (`SYS-012` after `SYS-011`),
 * else the project's, else `REQ-001`; never one already taken.
 */
export function nextId(
	item: Pick<Item, 'package'>,
	items: readonly Pick<Item, 'id' | 'package'>[]
) {
	const taken = new Set(items.flatMap((i) => (i.id ? [i.id.toLowerCase()] : [])));
	const near = items.filter((i) => i.package && i.package === item.package);
	const series = mostUsedSeries(near) ??
		mostUsedSeries(items) ?? { prefix: 'REQ-', max: 0, width: 3 };
	for (let n = series.max + 1; ; n++) {
		const id = `${series.prefix}${String(n).padStart(series.width, '0')}`;
		if (!taken.has(id.toLowerCase())) return id;
	}
}

function mostUsedSeries(items: readonly Pick<Item, 'id'>[]) {
	const series = new Map<string, { prefix: string; count: number; max: number; width: number }>();
	for (const { id } of items) {
		const m = id ? /^(.*?)(\d+)$/.exec(id) : null;
		if (!m) continue;
		const [, prefix, digits] = m as unknown as [string, string, string];
		const s = series.get(prefix) ?? { prefix, count: 0, max: 0, width: 0 };
		s.count++;
		s.max = Math.max(s.max, Number(digits));
		s.width = Math.max(s.width, digits.length);
		series.set(prefix, s);
	}
	let best: { prefix: string; count: number; max: number; width: number } | null = null;
	for (const s of series.values()) if (!best || s.count > best.count) best = s;
	return best;
}
