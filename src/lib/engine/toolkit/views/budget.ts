/**
 * Row providers over evaluated values: `budget:<attribute>` (a mass, power
 * or cost budget over the parts tree) and `checks` (does the design meet
 * its requirements?).
 *
 * **Budgets.** The rows are the bill of materials' (`composition`): every
 * part and item usage, by its path through the tree, with its quantity.
 * Each row's `each` is the attribute's value for one of it, evaluated by
 * the toolkit where the model binds it (on the usage, else on its type or
 * the type's supertypes); a row with no value of its own whose parts have
 * values adds them up (role `rollup`). `total` is `each` × the extended
 * quantity, `share` its part of the root's total. After a root's parts
 * come the root's own attributes of the same quantity (`emptyMass :> mass`,
 * `hoverPower :> power`), evaluated for the root (role `attribute`). A row
 * gets `limit`, `margin` and `check` when a `satisfy` claim's constraint
 * compares the row's value with a limit (`drone.takeOffMass <= 4 [kg]`).
 * Rows whose type has no such attribute, and rows with quantity 0, are left
 * out, except a part with a value whose number can vary (`[0..1]`, `[*]`):
 * it is counted at its least, shown, and every total that includes it says so. Values
 * that don't add up (g and m, a plain number, °C) give no sum and say why;
 * a value not in the total's unit has no share.
 *
 * When a value it adds up is uncertain, each row also gets its likely range
 * and the share of cases within its limit (`budgetSpread.ts`).
 *
 * **Checks.** One row per check of `Evaluation.checks()`; `metIn` is the
 * share of sampled cases that meet it, when a value it reads is uncertain.
 */
import { inputsText } from '#lib/project/checks.ts';
import {
	convert,
	formatMagnitude,
	formatQuantity,
	isAffine,
	readable,
	sumQuantities,
	whyNoSum,
	type Quantity
} from '../../quantity';
import type { Check, ColumnKind, Evaluated } from '../../types';
import { multiplicityOf, type ElementRecord } from '../model';
import { referencesIn } from '../evaluation';
import { shareText } from '../uncertainty';
import type { ViewContext } from './context';
import { addSpreads } from './budgetSpread';
import { compositionRows, type Row } from './rows';
import { simpleName, splitPath, unquoteName } from './text';

/** How the fields of the evaluated providers read. */
export function fieldKinds(spec: string): Record<string, ColumnKind> {
	if (spec.startsWith('budget:'))
		return {
			path: 'tree',
			quantity: 'number',
			extended: 'number',
			each: 'quantity',
			total: 'quantity',
			share: 'percent',
			limit: 'quantity',
			margin: 'quantity',
			check: 'check',
			likelyRange: 'quantity',
			withinLimit: 'percent'
		};
	if (spec === 'checks') return { status: 'check', limit: 'quantity', margin: 'quantity' };
	if (spec === 'requirements' || spec === 'trace') return { check: 'check' };
	return {};
}

interface BudgetLine {
	row: Row;
	record: ElementRecord;
	quantity: number;
	extended: number;
	each: Quantity | null;
	/** Why `each` is missing. */
	note: string | null;
	rolledUp: boolean;
	/** The sibling collection this part is one of (`m1 :> motors`): counted there. */
	memberOf?: string | null;
	/** Parts in this sum whose number can vary, by path from here, counted at their least. */
	variable?: { path: string; range: string; count: number }[];
}

export function budgetRows(ctx: ViewContext, attribute: string): Row[] {
	const evaluation = ctx.evaluation;
	const name = unquoteName(simpleName(attribute));
	const base = compositionRows(ctx, null);
	const lines = new Map<string, BudgetLine>();
	const keyOf = (chain: string[]) => chain.join('/');
	const order: BudgetLine[] = [];
	for (const row of base) {
		const record = row.chain ? ctx.byId.get(row.chain[row.chain.length - 1]!) : undefined;
		if (!record) continue;
		const line: BudgetLine = {
			row,
			record,
			quantity: Number(row.fields.get('quantity') ?? '1'),
			extended: Number(row.fields.get('extended') ?? '1'),
			each: null,
			note: null,
			rolledUp: false
		};
		lines.set(keyOf(row.chain!), line);
		order.push(line);
	}
	const childrenOf = (line: BudgetLine) =>
		order.filter(
			(l) =>
				l.row.chain!.length === line.row.chain!.length + 1 &&
				keyOf(l.row.chain!.slice(0, -1)) === keyOf(line.row.chain!)
		);

	// Children before parents: a parent without a value adds up its parts.
	const declares = new Map<string, 'required' | 'optional' | null>();
	// What adds up into a parent; shown are those of these whose number isn't 0 at its least, and
	// parts with a value whose number can vary (`o : Opt[0..1]`, `[*]`), counted at their least (0).
	const summable = new Set<BudgetLine>();
	const included = new Set<BudgetLine>();
	for (const line of [...order].reverse()) {
		const own = valueRecord(ctx, line.record, line.row.typeId ?? null, name);
		const children = childrenOf(line).filter((c) => summable.has(c));
		if (own) {
			let value = evaluation?.valueOf(own.id) ?? null;
			// Inherited as an expression (`mass = cells * cellMass`): with this part's values, not its type's.
			if (
				evaluation &&
				own.ownerId !== line.record.id &&
				line.record.qualifiedName &&
				referencesIn(own.value!).length
			)
				value = evaluation.valueFor(line.record.qualifiedName, name) ?? value;
			if (value?.kind === 'number') line.each = { value: value.value, unit: value.unit };
			else line.note = noteOf(value);
		}
		// A part that is one of a sibling collection (`m1 :> motors`) is counted in the collection.
		const siblings = new Map(childrenOf(line).map((c) => [c.record.id, c]));
		for (const c of children) {
			const collection = ctx.subsettedUsage(c.record);
			if (collection && siblings.has(collection.id)) c.memberOf = collection.name;
		}
		if (!line.each && children.length) {
			const counted = children.filter((c) => !c.memberOf);
			const parts = counted.filter((c) => c.each);
			const items = parts.map((c) => scaled(c.each!, c.quantity));
			const sum = sumQuantities(items);
			// Values that don't add up (grams and metres, a plain number, °C): no total, and why.
			if (!sum && items.length)
				line.note = `no total: the parts' ${name} values ${whyNoSum(items)}`;
			if (sum) {
				line.each = sum;
				line.rolledUp = true;
				const missing = counted.length - parts.length;
				line.note = missing
					? `adds up the parts that have a ${name}; ${missing} ${missing === 1 ? 'has' : 'have'} none`
					: `the sum of its parts`;
				// Parts whose number may vary (`[0..1]`, `[2..4]`, `[*]`), here or further down, are
				// counted at their least, and the total says so.
				line.variable = parts.flatMap((c) => {
					const range = rangeOf(c.record.header);
					const own = range ? [{ path: c.record.name ?? '', range, count: c.quantity }] : [];
					const nested = (c.variable ?? []).map((v) => ({
						...v,
						path: `${c.record.name}.${v.path}`
					}));
					return [...own, ...nested];
				});
				if (line.variable.length)
					line.note += `; counts ${line.variable.map((v) => `\`${v.path}\` (${v.range}) as ${v.count}`).join(' and ')}, whose number can vary: the total is the least it can be`;
			}
		}
		// A part whose type declares the attribute belongs in the budget, without a value too
		// (it is missing one) — unless the attribute is optional (`powerDraw [0..1]`).
		const declared = declaresAttribute(ctx, line.record, line.row.typeId ?? null, name, declares);
		if ((declared === 'required' && !own) || children.length || line.each) {
			summable.add(line);
			if (line.extended > 0 || (line.each && rangeOf(line.record.header))) included.add(line);
		}
		if (!line.each && !line.note) line.note = `no ${name} is given`;
	}

	const kept = order.filter((l) => included.has(l));
	const unit = commonUnit(kept.filter((l) => l.each && !l.rolledUp).map((l) => l.each!));
	const checks = evaluation?.checks().checks ?? [];
	const rows: Row[] = [];
	let rootTotal: Quantity | null = null;
	for (const line of kept) {
		const depth = Number(line.row.fields.get('depth') ?? '0');
		const total = line.each && !line.memberOf ? scaled(line.each, line.extended) : null;
		if (depth === 0) rootTotal = total;
		const fields = new Map(line.row.fields);
		const shown = (q: Quantity | null) => (q ? formatQuantity(inUnit(q, unit)) : '');
		fields.set('each', shown(line.each));
		fields.set('total', shown(total));
		const share = total && rootTotal ? ratio(total, rootTotal) : null;
		fields.set('share', share !== null ? percent(share) : '');
		const notes: Record<string, string> = {};
		if (line.note && (!line.each || line.rolledUp)) notes.each = line.note;
		if (line.memberOf) notes.total = `one of \`${line.memberOf}\`, counted there`;
		const range = rangeOf(line.record.header);
		if (range)
			notes.quantity = `its number can vary (${range}): counted at its least, ${line.quantity}`;
		const row: Row = {
			...line.row,
			fields,
			info: {
				depth,
				...(line.rolledUp ? { role: 'rollup' as const } : {}),
				...(Object.keys(notes).length ? { notes } : {})
			}
		};
		limitFields(row, checks, line.row.fields.get('path') ?? '', [name]);
		rows.push(row);
		// After a root and its parts: the root's own values of this quantity.
		if (depth === 0) rootAttributes(ctx, line, name, rows, checks, unit, kept);
	}
	// Uncertain values (`budgetSpread.ts`): each row's likely range and the share within its limit.
	addSpreads(
		ctx,
		name,
		order.map((l) => ({ ...l, chain: l.row.chain! })),
		rows,
		checks
	);
	return reorder(rows);
}

/**
 * Put each root's attribute rows after the root's whole subtree (they are
 * pushed right after the root while walking).
 */
function reorder(rows: Row[]): Row[] {
	const out: Row[] = [];
	let pending: Row[] = [];
	for (const row of rows) {
		const depth = row.info?.depth ?? 0;
		if (row.info?.role === 'attribute') {
			pending.push(row);
			continue;
		}
		if (depth === 0 && pending.length) {
			out.push(...pending);
			pending = [];
		}
		out.push(row);
	}
	out.push(...pending);
	return out;
}

/** The root's attributes that measure the same quantity (`emptyMass :> mass`). */
function rootAttributes(
	ctx: ViewContext,
	root: BudgetLine,
	name: string,
	rows: Row[],
	checks: Check[],
	unit: string | null,
	kept: BudgetLine[]
) {
	const evaluation = ctx.evaluation;
	if (!evaluation || !root.record.qualifiedName) return;
	const kinds = new Set([name, ...quantityKinds(ctx, name, kept)]);
	const seen = new Set<string>();
	const owners = [root.record.id, ...ctx.supers(root.record.id)];
	// In the order the definition declares them (a usage's redefinitions come first otherwise).
	const declared = (a: ElementRecord) => {
		const redefined = a.redefinesQualified ? splitPath(a.redefinesQualified).pop() : null;
		const declaration = (redefined && findDeclaration(ctx, owners, redefined)) || a;
		return declaration.span.start_byte + (declaration === a ? 1e9 : 0);
	};
	const candidates = owners
		.flatMap((owner) => ctx.ownedBy(owner))
		.filter((a) => a.kind === 'attribute' && a.name);
	const ordered = candidates.toSorted((x, y) => declared(x) - declared(y));
	for (const a of ordered) {
		if (a.kind !== 'attribute' || !a.name || seen.has(a.name) || a.name === name) continue;
		const specializes = a.specializes.map((s) => unquoteName(simpleName(s)));
		const redefined = a.redefinesQualified ? splitPath(a.redefinesQualified).pop() : null;
		const declaration = redefined ? findDeclaration(ctx, owners, redefined) : a;
		const of = declaration?.specializes.map((s) => unquoteName(simpleName(s))) ?? specializes;
		if (!of.some((s) => kinds.has(s))) continue;
		seen.add(a.name);
		const at = `${root.record.qualifiedName}::${a.written ?? a.name}`;
		// Inherited as an expression: with the root's values (`evaluate` would use its type's).
		const value =
			(a.ownerId !== root.record.id && a.value && referencesIn(a.value).length
				? evaluation.valueFor(root.record.qualifiedName, a.written ?? a.name)
				: null) ?? evaluation.valueAt(at);
		const path = `${root.row.fields.get('path') ?? root.record.name}.${a.name}`;
		const fields = new Map<string, string>([
			['element', a.name],
			['path', path],
			['type', ''],
			['parent', root.record.name ?? ''],
			['depth', '1'],
			['quantity', ''],
			['extended', ''],
			['each', ''],
			['total', value?.kind === 'number' ? formatQuantity(inUnit(value, unit, true)) : ''],
			['share', ''],
			['doc', a.docs.join(' ')],
			['file', a.path],
			['line', String(a.span.start_row)]
		]);
		const notes: Record<string, string> = {};
		if (value?.kind !== 'number') notes.total = noteOf(value) ?? 'not evaluated';
		const row: Row = {
			fields,
			anchors: [a.id],
			chain: [...root.row.chain!, a.id],
			element: a.qualifiedName ?? '',
			typeId: null,
			info: { depth: 1, role: 'attribute', ...(Object.keys(notes).length ? { notes } : {}) }
		};
		limitFields(row, checks, root.row.fields.get('path') ?? '', [a.name]);
		rows.push(row);
	}
}

/** The quantity the budgeted attribute measures (`mass :> ISQ::mass` → `mass`). */
function quantityKinds(ctx: ViewContext, name: string, kept: BudgetLine[]): string[] {
	for (const line of kept) {
		const typeId = line.row.typeId;
		if (!typeId) continue;
		for (const t of [typeId, ...ctx.supers(typeId)])
			for (const a of ctx.ownedBy(t))
				if (a.kind === 'attribute' && a.name === name && !a.redefines && a.specializes.length)
					return a.specializes.map((s) => unquoteName(simpleName(s)));
	}
	return [];
}

function findDeclaration(
	ctx: ViewContext,
	owners: string[],
	name: string
): ElementRecord | undefined {
	for (const owner of owners)
		for (const a of ctx.ownedBy(owner)) if (a.name === name && !a.redefines) return a;
	return undefined;
}

/**
 * `limit`, `margin`, `check` and `requirement` for a row whose value a
 * claim's constraint compares with a limit: `<by>.<feature>` where `by` is
 * the row's path.
 */
function limitFields(row: Row, checks: Check[], path: string, features: string[]) {
	for (const check of checks) {
		if (!check.limit || !check.by || check.kind !== 'satisfy') continue;
		const by = check.by.replace(/\s+/g, '');
		const segments = check.limit.feature.split('.');
		if (by !== path || segments.length !== 2 || !features.includes(segments[1]!)) continue;
		row.fields.set('limit', `${symbolOf(check.limit.operator)} ${formatQuantity(check.limit)}`);
		row.fields.set(
			'margin',
			check.margin
				? `${formatQuantity({ value: check.margin.value, unit: check.margin.unit })}${check.margin.ratio !== null ? ` (${percent(check.margin.ratio)})` : ''}`
				: ''
		);
		row.fields.set('check', check.status);
		row.fields.set('requirement', check.requirement?.id ?? check.requirement?.name ?? '');
		if (!check.margin && check.status === 'undecided') {
			row.info ??= {};
			row.info.notes = { ...row.info.notes, margin: check.explanation };
		}
		return;
	}
	for (const key of ['limit', 'margin', 'check', 'requirement'])
		if (!row.fields.has(key)) row.fields.set(key, '');
}

/** The record that binds `name` for a usage: its own, else its type's or a supertype's. */
function valueRecord(
	ctx: ViewContext,
	usage: ElementRecord,
	typeId: string | null,
	name: string
): ElementRecord | undefined {
	const owners = [usage.id, ...(typeId ? [typeId, ...ctx.supers(typeId)] : [])];
	for (const owner of owners)
		for (const a of ctx.ownedBy(owner))
			if (a.kind === 'attribute' && a.name === name && a.value !== null) return a;
	return undefined;
}

/** Whether the usage's type declares the attribute, and whether a value is expected. */
function declaresAttribute(
	ctx: ViewContext,
	usage: ElementRecord,
	typeId: string | null,
	name: string,
	cache: Map<string, 'required' | 'optional' | null>
): 'required' | 'optional' | null {
	const key = `${usage.id}:${typeId ?? ''}`;
	const hit = cache.get(key);
	if (hit !== undefined) return hit;
	const owners = [usage.id, ...(typeId ? [typeId, ...ctx.supers(typeId)] : [])];
	let found: 'required' | 'optional' | null = null;
	for (const owner of owners) {
		const declaration = ctx
			.ownedBy(owner)
			.find((a) => a.kind === 'attribute' && a.name === name && !a.redefines);
		if (!declaration) continue;
		found = /^0(\.\.|$)/.test(multiplicityOf(declaration.header) ?? '') ? 'optional' : 'required';
		break;
	}
	cache.set(key, found);
	return found;
}

/** A multiplicity whose number can vary (`0..1`, `2..4`, `1..*`), as written; null for a fixed one. */
function rangeOf(header: string): string | null {
	const text = multiplicityOf(header)?.trim();
	if (!text) return null;
	const [lower, upper] = text.split('..').map((x) => x.trim());
	if (upper === undefined) return lower === '*' ? text : null;
	return lower === upper ? null : text;
}

function noteOf(value: Evaluated | null | undefined): string | null {
	if (!value) return 'not evaluated';
	if (value.kind === 'undecided') return `not computed: ${value.reason}`;
	if (value.kind === 'none') return 'no value is given';
	if (value.kind === 'text') return `not a number: ${value.text}`;
	return null;
}

const scaled = (q: Quantity, n: number): Quantity => ({ value: q.value * n, unit: q.unit });

/** `part`'s share of `whole`; null when it isn't in the whole's unit nor converts to it. */
function ratio(part: Quantity, whole: Quantity): number | null {
	if (!whole.value || isAffine(part.unit) || isAffine(whole.unit)) return null;
	if (part.unit === whole.unit) return part.value / whole.value;
	if (!part.unit || !whole.unit) return null;
	const p = convert(part.value, part.unit, whole.unit);
	return p === null ? null : p / whole.value;
}

/** The unit most of the values are given in (they read alike down the column). */
function commonUnit(values: Quantity[]): string | null {
	const counts = new Map<string, number>();
	for (const q of values) if (q.unit) counts.set(q.unit, (counts.get(q.unit) ?? 0) + 1);
	let best: string | null = null;
	for (const [unit, n] of counts) if (!best || n > counts.get(best)!) best = unit;
	return best;
}

/** `q` in the table's unit, or (for a total, when the table's unit reads badly) a readable one. */
function inUnit(q: Quantity, unit: string | null, readableTotal = false): Quantity {
	if (readableTotal) return readable(q);
	if (!unit || !q.unit || q.unit === unit) return q;
	const v = convert(q.value, q.unit, unit);
	return v === null ? q : { value: v, unit };
}

export function percent(ratio: number): string {
	const p = ratio * 100;
	const digits = Math.abs(p) < 10 ? 1 : 0;
	return `${formatMagnitude(Number(p.toFixed(digits)))} %`;
}

export const symbolOf = (operator: string) =>
	({ '<=': '≤', '>=': '≥', '<': '<', '>': '>', '==': '=' })[operator] ?? operator;

// --- checks ----------------------------------------------------------------------

/** One row per check: claims, unclaimed requirement constraints and assertions. */
export function checkRows(ctx: ViewContext): Row[] {
	const report = ctx.evaluation?.checks();
	if (!report) return [];
	return report.checks.map((check) => {
		const values = check.values.map((v) => `${v.feature} = ${valueText(v.value)}`).join('; ');
		const fields = new Map<string, string>([
			['status', check.status],
			['id', check.requirement?.id ?? ''],
			['requirement', check.requirement?.name ?? (check.name ? check.name : '')],
			['qualifiedName', check.requirement?.qualifiedName ?? ''],
			['by', check.by ?? ''],
			['kind', check.kind],
			['constraint', check.constraint],
			['values', values],
			[
				'limit',
				check.limit ? `${symbolOf(check.limit.operator)} ${formatQuantity(check.limit)}` : ''
			],
			[
				'margin',
				check.margin
					? `${formatQuantity({ value: check.margin.value, unit: check.margin.unit })}${check.margin.ratio !== null ? ` (${percent(check.margin.ratio)})` : ''}`
					: ''
			],
			['detail', check.explanation],
			['inputs', inputsText(check)],
			['verdict', check.detail],
			['metIn', check.spread ? shareText(check.spread.met) : ''],
			['checkable', check.checkable ? '1' : '0'],
			['file', check.file],
			['line', String(check.span.start_row)]
		]);
		const row: Row = {
			fields,
			anchors: check.requirement?.elementId ? [check.requirement.elementId] : [],
			element: '',
			byte: check.span.start_byte
		};
		return row;
	});
}

/** A value as a check row shows it: `27.54 min`, `1 kg`, or `unknown`. */
export function valueText(value: Evaluated): string {
	switch (value.kind) {
		case 'number': {
			const q = readable({ value: value.value, unit: value.unit });
			return formatQuantity(q);
		}
		case 'text':
			return value.text;
		case 'none':
			return 'no value';
		case 'undecided':
			return 'unknown';
	}
}
