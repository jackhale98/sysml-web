/**
 * A budget's spread when values it adds up are uncertain (`../uncertainty.ts`):
 * each row's likely range (`likelyRange`, P5 to P95 of its total: 90 % of
 * cases) and, for a row a requirement limits, the share of cases within
 * the limit (`withinLimit`, the check's own), which the range also says in
 * brackets: `3.752 – 3.808 kg (100 % within limit)`. All rows come from one
 * sampling run, so an assembly's range and its parts' agree case by case:
 * each part's value is sampled once for each place it is used (four motors
 * vary independently), and an assembly with no value of its own adds up
 * its parts' samples.
 *
 * The range's column appears only in a budget that has a spread to show,
 * after `total` (`withSpreadColumns`): one column, so the budget still fits
 * beside the inspector. A budget over exact values renders as it always has.
 */
import type { Quantity } from '../../quantity';
import type { Check } from '../../types';
import { rangeText, shareText, type Built } from '../uncertainty';
import type { ElementRecord } from '../model';
import type { ViewContext } from './context';
import type { Row } from './rows';

/** What `budgetRows` worked out for a line of the parts tree. */
export interface SpreadLine {
	chain: string[];
	record: ElementRecord;
	quantity: number;
	extended: number;
	each: Quantity | null;
	rolledUp: boolean;
	memberOf?: string | null;
}

/** Fill `likelyRange` and `withinLimit` of a budget's rows when anything it adds up is uncertain. */
export function addSpreads(
	ctx: ViewContext,
	attribute: string,
	lines: SpreadLine[],
	rows: Row[],
	checks: Check[]
): void {
	const spreads = ctx.evaluation?.spreads;
	if (!spreads?.any) return;
	const key = (chain: string[]) => chain.join('/');
	const byKey = new Map(lines.map((l) => [key(l.chain), l]));
	// Where each line's part sits in the tree, by qualified path (`DroneArchitecture::drone::frontLeft::motor`).
	const instance = new Map<string, string>();
	for (const line of lines) {
		const up = key(line.chain.slice(0, -1));
		const own = line.record.written ?? line.record.name;
		// A root of the tree is named by its qualified name; a part below it by its path from there.
		const at = !byKey.has(up)
			? line.record.qualifiedName
			: instance.has(up) && own
				? `${instance.get(up)}::${own}`
				: null;
		if (at) instance.set(key(line.chain), at);
	}
	// Each line's value for one of it: its own, else its parts' added up (children first).
	const each = new Map<string, Built | null>();
	for (const line of [...lines].reverse()) {
		const k = key(line.chain);
		if (!line.each) continue;
		if (!line.rolledUp) {
			const at = instance.get(k);
			each.set(k, at ? spreads.feature(at, attribute) : null);
			continue;
		}
		const parts = lines.filter(
			(c) =>
				c.chain.length === line.chain.length + 1 &&
				key(c.chain.slice(0, -1)) === k &&
				c.each &&
				!c.memberOf
		);
		const built = parts.map((c) => ({ built: each.get(key(c.chain)) ?? null, times: c.quantity }));
		each.set(
			k,
			built.every((b) => b.built) ? spreads.total(built as { built: Built; times: number }[]) : null
		);
	}
	const outputs = rows.map((row) => {
		const chain = row.chain ?? [];
		if (row.info?.role === 'attribute') {
			const root = ctx.byId.get(chain[chain.length - 2] ?? '');
			const name = row.fields.get('element') ?? '';
			if (!root?.qualifiedName || !name) return { built: null, nominal: null };
			const evaluation = ctx.evaluation!;
			const value =
				evaluation.valueFor(root.qualifiedName, name) ??
				evaluation.valueAt(`${root.qualifiedName}::${name}`);
			return {
				built: spreads.feature(root.qualifiedName, name),
				nominal: value?.kind === 'number' ? { value: value.value, unit: value.unit } : null
			};
		}
		const line = byKey.get(key(chain));
		const one = line ? each.get(key(chain)) : null;
		if (!line?.each || !one || line.memberOf) return { built: null, nominal: null };
		return {
			built: spreads.total([{ built: one, times: line.extended }]),
			nominal: { value: line.each.value * line.extended, unit: line.each.unit }
		};
	});
	const found = spreads.cached(`budget:${attribute}`, () => spreads.run(outputs));
	if (!found.some(Boolean)) return;
	rows.forEach((row, i) => {
		const spread = found[i];
		// In the unit the row's total is shown in, so the two read alike.
		const unit = /^\S+ (.+)$/.exec(row.fields.get('total') ?? '')?.[1]?.replace(/·/g, '*');
		const check = limitCheck(row, checks, attribute);
		const within = check?.spread ? shareText(check.spread.met) : '';
		row.fields.set('withinLimit', within);
		// With the share of cases within the row's limit, in brackets (it moves under a narrow cell).
		const range = spread ? rangeText(spread, false, unit) : '';
		row.fields.set('likelyRange', range && within ? `${range} (${within} within limit)` : range);
	});
}

/** The check that limits a row's value (as `limitFields` finds it in `budget.ts`). */
function limitCheck(row: Row, checks: Check[], attribute: string): Check | undefined {
	const path = row.fields.get('path') ?? '';
	// A part's own value (`drone.mass`), or one of the root's attributes (`drone.takeOffMass`).
	const [by, feature] =
		row.info?.role === 'attribute'
			? [path.slice(0, path.lastIndexOf('.')), path.slice(path.lastIndexOf('.') + 1)]
			: [path, attribute];
	return checks.find((check) => {
		if (!check.limit || !check.by || check.kind !== 'satisfy') return false;
		const segments = check.limit.feature.split('.');
		return check.by.replace(/\s+/g, '') === by && segments.length === 2 && segments[1] === feature;
	});
}

/**
 * A budget's columns with `likelyRange` after `total` (else last), when its
 * rows have one and the view doesn't place it itself. (`withinLimit` is in
 * it, and a field of its own a view can choose.)
 */
export function withSpreadColumns(
	rowsSpec: string,
	columns: [string, string | null][],
	rows: Row[]
): [string, string | null][] {
	if (!rowsSpec.trim().startsWith('budget:')) return columns;
	const out = [...columns];
	const place = (field: string, after: string) => {
		if (out.some(([c, e]) => c === field || e === field)) return;
		if (!rows.some((r) => r.fields.get(field))) return;
		const at = out.findIndex(([c]) => c === after);
		out.splice(at < 0 ? out.length : at + 1, 0, [field, null]);
	};
	place('likelyRange', 'total');
	return out;
}
