/**
 * Render a view as a table: the `@TableRendering` that applies to it says
 * which rows to collect (`rows`), which columns to show (`columns`, with
 * computed ones as `name = expression`), how to filter (`where`) and sort
 * (`sortBy`), or to count a grid instead (`pivot`). The view's `expose` and
 * `filter` clauses narrow the rows to part of the model.
 *
 * Exposure follows the SysML v2 semantics over the toolkit's resolved
 * model: `expose X` is X, `expose X::*` X's members, `expose X::**` X and
 * everything nested in it, `expose X::*::**` everything nested but X. A
 * namespace's members are what it owns and what it inherits from its types
 * and specializations — not what it imports: `SystemRequirements::*` does
 * not take in the units its `private import SI::*` brings. A view without
 * `expose` shows the whole model (the library's convention).
 */
import {
	EvalError,
	ParseError,
	evaluate,
	evaluateCondition,
	mapScope,
	parseExpr
} from '#lib/sim/expr.ts';
import type { Value } from '#lib/sim/expr.ts';
import type { ColumnEdit, RenderedTable, RowInfo } from '../../types';
import { fieldKinds } from './budget';
import type { ElementRecord } from '../model';
import { findView, listViews, tableSpec, viewChain, viewClauses } from './catalog';
import type { ViewContext } from './context';
import { ColumnEdits, type Probe } from './edits';
import { provideRows, type Row } from './rows';
import {
	compareCells,
	formatNumber,
	parseNumber,
	simpleName,
	splitPath,
	unquoteName
} from './text';

/** The fields of a `requirements` row, for a project with none yet. */
const REQUIREMENT_FIELDS = [
	'element',
	'qualifiedName',
	'id',
	'title',
	'text',
	'type',
	'status',
	'owner',
	'rationale',
	'issues',
	'satisfiedBy',
	'verifiedBy',
	'check',
	'satisfied',
	'verified',
	'file',
	'line',
	'kind',
	'priority',
	'verificationMethod'
];

export function renderView(ctx: ViewContext, name: string): RenderedTable {
	const view = findView(ctx, name);
	if (!view) {
		const names = listViews(ctx).map((v) => v.name);
		throw new Error(
			`view \`${name}\` not found. Available views: ${names.length ? names.join(', ') : '(none)'}`
		);
	}
	const shown = view.name ?? name;
	const spec = tableSpec(ctx, view);
	if (!spec) {
		const typed =
			!view.isDefinition && view.type
				? ` (typed by \`${unquoteName(simpleName(view.type))}\`)`
				: '';
		throw new Error(
			`view \`${shown}\`${typed} has no @TableRendering annotation — nothing specifies its rows and columns (see the domain libraries for examples)`
		);
	}
	const rowsSpec = spec.get('rows');
	if (rowsSpec === undefined) throw new Error('missing `rows` in @TableRendering');
	const warnings: string[] = [];
	let rows = provideRows(ctx, rowsSpec, warnings);
	const probe = probeOf(ctx, rowsSpec, rows);

	rows = applyScope(ctx, view, rows, rowsSpec, warnings);

	// A trade study table compares the alternatives of one study: the first it exposes.
	const study = rows.find((r) => r.trade)?.trade;
	if (study) {
		const others = new Set(
			rows.flatMap((r) => (r.trade && r.trade !== study ? [r.trade.name] : []))
		);
		if (others.size)
			warnings.push(
				`this view shows one trade study, \`${study.name}\`; expose only the study to show (also exposed: ${[...others].map((n) => `\`${n}\``).join(', ')})`
			);
		rows = rows.filter((r) => !r.trade || r.trade === study);
	}

	const where = spec.get('where');
	if (where !== undefined) {
		const condition = parse(where);
		rows = condition ? rows.filter((r) => holds(condition, r)) : [];
	}

	const pivot = spec.get('pivot');
	if (pivot !== undefined) {
		const parts = pivot.split(';').map((s) => s.trim());
		if (parts.length !== 2) throw new Error('pivot expects `rowField; colField`');
		const table = pivotTable(shown, rows, parts[0]!, parts[1]!, spec.get('sortBy'));
		return {
			...table,
			warnings,
			editable: table.columns.map(() => null),
			availableFields: probe.fields
		};
	}

	const columnSpec = spec.get('columns');
	if (columnSpec === undefined) throw new Error('missing `columns` in @TableRendering');
	let columns = columnSpec
		.split(';')
		.map((c) => c.trim())
		.filter(Boolean)
		.map((c): [string, string | null] => {
			const eq = c.indexOf('=');
			return eq < 0 ? [c, null] : [c.slice(0, eq).trim(), c.slice(eq + 1).trim()];
		});
	// A column that stands for a group of fields (`alternatives`) becomes one column per field.
	const groups = rows.find((r) => r.groups)?.groups ?? {};
	columns = columns.flatMap(([column, expr]): [string, string | null][] =>
		expr === null && groups[column]
			? groups[column].map((f): [string, null] => [f, null])
			: [[column, expr]]
	);
	const compiled = columns.map(([, expr]) => (expr === null ? null : parse(expr)));

	let table = rows.map((r) => ({
		cells: columns.map(([column, expr], i) => {
			if (expr === null) return r.fields.get(column) ?? '';
			const value = compiled[i] ? number(compiled[i]!, r) : null;
			return value !== null ? formatNumber(value) : (r.fields.get(expr) ?? '');
		}),
		source: {
			element: r.element,
			file: r.fields.get('file') ?? '',
			line: parseNumber(r.fields.get('line') ?? '') ?? 0,
			...(r.byte !== undefined ? { byte: r.byte } : {})
		},
		info: rowInfoOf(r, columns)
	}));

	const sortBy = spec.get('sortBy');
	if (sortBy !== undefined) {
		const descending = sortBy.startsWith('-');
		const key = descending ? sortBy.slice(1).trim() : sortBy;
		const index = columns.findIndex(([c]) => c === key);
		if (index >= 0) {
			table = table.toSorted((a, b) => {
				const order = compareCells(a.cells[index]!, b.cells[index]!);
				return descending ? -order : order;
			});
		} else warnings.push(`sortBy column \`${key}\` is not in the column list`);
	}

	const edits = new ColumnEdits(ctx);
	const editable: (ColumnEdit | null)[] = columns.map(([column, expr]) =>
		edits.column(rowsSpec, probe, column, expr)
	);
	const kinds = fieldKinds(rowsSpec.trim());
	// A column copied from a field reads like the field; `name = expression` columns are numbers.
	const columnKinds = columns.map(([column, expr]) =>
		expr === null ? (kinds[column] ?? null) : (kinds[expr] ?? null)
	);
	const described = table.some((t) => t.info);
	return {
		view: shown,
		columns: columns.map(([c]) => c),
		rows: table.map((t) => t.cells),
		warnings,
		sources: table.map((t) => t.source),
		editable,
		availableFields: probe.fields,
		...(columnKinds.some((k) => k) ? { columnKinds } : {}),
		...(described ? { rowInfo: table.map((t) => t.info ?? {}) } : {}),
		...(rowsSpec.trim() === 'checks' ? { opensText: true } : {}),
		...(study ? { trade: study } : {})
	};
}

/** What the provider said about a row, with its notes by column. */
function rowInfoOf(r: Row, columns: [string, string | null][]): RowInfo | undefined {
	if (!r.info) return undefined;
	const { notes, ...rest } = r.info;
	const info: RowInfo = { ...rest };
	if (notes) {
		const byColumn: Record<number, string> = {};
		columns.forEach(([column, expr], i) => {
			const note = notes[expr ?? column] ?? notes[column];
			if (note) byColumn[i] = note;
		});
		if (Object.keys(byColumn).length) info.notes = byColumn;
	}
	return info;
}

/** The provider's fields and row types, before `expose` and `where` narrow the rows. */
function probeOf(ctx: ViewContext, spec: string, rows: Row[]): Probe {
	const fields: string[] = [];
	const typeIds: string[] = [];
	if (spec === 'requirements' || spec === 'trace') {
		if (spec === 'trace') fields.push('requirement');
		fields.push(...REQUIREMENT_FIELDS);
	}
	if (spec.startsWith('type:')) {
		const id = ctx.definitionNamed(spec.slice(5).trim());
		if (id) typeIds.push(id);
	}
	for (const r of rows) {
		for (const k of r.fields.keys()) if (!fields.includes(k)) fields.push(k);
		if (r.typeId && !typeIds.includes(r.typeId)) typeIds.push(r.typeId);
	}
	return { fields, typeIds };
}

// --- expose and filter ----------------------------------------------------------

type ExposeKind = 'element' | 'members' | 'recursive' | 'nested';

interface Exposure {
	kind: ExposeKind;
	target: string;
}

/** `X` / `X::*` / `X::**` / `X::*::**`, with a trailing `[filter]` left out. */
function parseExpose(text: string): { kind: ExposeKind; base: string } {
	const t = text.replace(/\[[^\]]*\]\s*$/, '').trim();
	if (t.endsWith('::*::**')) return { kind: 'nested', base: t.slice(0, -7) };
	if (t.endsWith('::**')) return { kind: 'recursive', base: t.slice(0, -4) };
	if (t.endsWith('::*')) return { kind: 'members', base: t.slice(0, -3) };
	return { kind: 'element', base: t };
}

/** Keep the rows the view exposes and its filters accept. */
function applyScope(
	ctx: ViewContext,
	view: ElementRecord,
	rows: Row[],
	rowsSpec: string,
	warnings: string[]
): Row[] {
	const chain = viewChain(ctx, view);
	const clauses = chain.map((v) => ({ view: v, ...viewClauses(ctx.textOf(v)) }));
	// The most specific expose list wins: a usage narrows what its def exposes.
	const exposing = clauses.find((c) => c.expose.length);
	// Filters accumulate: every filter on the view and its defs applies.
	const filters = clauses.flatMap((c) => c.filter);
	if (!exposing && !filters.length) return rows;
	if (rows.some((r) => !r.anchors.length && !r.chain))
		warnings.push(
			`rows from \`${rowsSpec}\` have no owning element; expose/filter not applied to them`
		);

	const exposures: Exposure[] = [];
	for (const text of exposing?.expose ?? []) {
		const { kind, base } = parseExpose(text);
		const target = resolveTarget(ctx, base, exposing!.view);
		if (target) exposures.push({ kind, target });
		else warnings.push(`expose \`${text}\` does not name an element of the model; ignored`);
	}
	const exposed = exposing ? exposedElements(ctx, exposures) : null;
	const accepts = filters.length ? filterOf(ctx, view, !!exposing, filters, warnings) : null;

	return rows.filter((r) => {
		if (!r.anchors.length && !r.chain) return true;
		if (exposed && !isExposed(r, exposures, exposed)) return false;
		if (!accepts) return true;
		const elements = r.chain ? [r.chain[r.chain.length - 1]!] : r.anchors;
		return elements.some(accepts);
	});
}

function isExposed(r: Row, exposures: Exposure[], exposed: Set<string>): boolean {
	if (!r.chain) return r.anchors.some((a) => exposed.has(a));
	// A composition row is where the walk put it: `drone::**` exposes `drone.rotors.motor`
	// but not the same motor in another assembly.
	const chain = r.chain;
	const last = chain.length - 1;
	return exposures.some(({ kind, target }) => {
		switch (kind) {
			case 'element':
				return chain[last] === target;
			case 'members':
				return chain[last - 1] === target;
			case 'recursive':
				return chain.includes(target);
			case 'nested':
				return chain.indexOf(target) >= 0 && chain.indexOf(target) < last;
		}
	});
}

/**
 * What an expose target names: a name relative to the namespaces around the
 * view (innermost first) or from the root, else the model element whose
 * qualified name ends with it (a name an import makes visible).
 */
function resolveTarget(ctx: ViewContext, base: string, view: ElementRecord): string | null {
	const session = ctx.session;
	const segments = splitPath(base);
	if (!segments.length) return null;
	const tryResolve = (qualified: string): string | null => {
		const handle = session?.resolve(qualified);
		if (!session || !handle) return null;
		try {
			return session.elementId(handle);
		} finally {
			handle.free();
		}
	};
	const plain = segments.join('::');
	const scopes = [...ctx.ownerChain(view), view.id]
		.reverse()
		.map((id) => ctx.byId.get(id)?.qualifiedName)
		.filter((q): q is string => !!q);
	// Innermost first, as names resolve.
	for (const prefix of [...scopes, '']) {
		for (const name of new Set([base.trim(), plain])) {
			const found = tryResolve(prefix ? `${prefix}::${name}` : name);
			if (found) return found;
		}
	}
	const matches = ctx.records.filter((r) => {
		const path = splitPath(r.qualifiedName ?? '');
		return (
			path.length >= segments.length &&
			segments.every((s, i) => path[path.length - segments.length + i] === s)
		);
	});
	return (matches.find((r) => ctx.isContent(r)) ?? matches[0])?.id ?? null;
}

/** The elements the exposures cover. */
function exposedElements(ctx: ViewContext, exposures: Exposure[]): Set<string> {
	const out = new Set<string>();
	const visited = new Set<string>();
	const nest = (id: string) => {
		for (const member of membersOf(ctx, id)) {
			out.add(member);
			if (!visited.has(member)) {
				visited.add(member);
				nest(member);
			}
		}
	};
	for (const { kind, target } of exposures) {
		if (kind === 'element' || kind === 'recursive') out.add(target);
		if (kind === 'members') for (const m of membersOf(ctx, target)) out.add(m);
		if (kind === 'recursive' || kind === 'nested') {
			visited.add(target);
			nest(target);
		}
	}
	return out;
}

/** A namespace's members: what it owns, and what it inherits and doesn't redefine. */
function membersOf(ctx: ViewContext, id: string): string[] {
	const own = ctx.ownedBy(id);
	const out = own.map((r) => r.id);
	const names = new Set(own.map((r) => r.name).filter(Boolean));
	const redefined = new Set(own.flatMap((r) => (r.rootId ? [r.rootId] : [])));
	for (const s of ctx.supers(id)) {
		for (const inherited of ctx.ownedBy(s)) {
			if (inherited.isDefinition) continue;
			if (
				redefined.has(inherited.rootId ?? inherited.id) ||
				(inherited.name && names.has(inherited.name))
			)
				continue;
			out.push(inherited.id);
		}
	}
	return out;
}

/**
 * Which elements the view's filters accept. A view usage that exposes
 * something has its filters evaluated by the toolkit (its `viewInfo`
 * exposure, which applies them with the language's semantics); otherwise a
 * filter is read as a disjunction (`or`) of `@SysML::<Metaclass>` (an element
 * of that metaclass or a specialization of it: a part is an item),
 * `@<MetadataDef>` and `kind = <kind>` terms, and anything else is reported
 * and ignored.
 */
function filterOf(
	ctx: ViewContext,
	view: ElementRecord,
	exposes: boolean,
	filters: string[],
	warnings: string[]
): (id: string) => boolean {
	if (!view.isDefinition && exposes && view.qualifiedName && ctx.session) {
		try {
			const info = JSON.parse(ctx.session.viewInfo(view.qualifiedName)) as {
				exposed: { id: string }[];
			};
			const accepted = new Set(info.exposed.map((e) => e.id));
			return (id) => accepted.has(id);
		} catch {
			// Fall through to reading the filters ourselves.
		}
	}
	const unsupported = new Set<string>();
	const tests = filters.map((filter) => {
		const terms = filter.split(/\s+or\s+/).map((t) =>
			t
				.trim()
				.replace(/^\(+|\)+$/g, '')
				.trim()
		);
		const understood: ((id: string) => boolean)[] = [];
		let unknown = false;
		for (const term of terms) {
			const kind = /^kind\s*==?\s*([\w]+)/.exec(term);
			if (kind) {
				const k = kind[1]!.toLowerCase();
				understood.push((id) => (ctx.metaclassOf(id) ?? '').toLowerCase().startsWith(k));
				continue;
			}
			if (!/^@[\w:']+$/.test(term)) {
				unknown = true;
				continue;
			}
			const meta = unquoteName(simpleName(term.slice(1)));
			if (meta === 'Element') understood.push(() => true);
			else if (ctx.isMetaclass(meta))
				understood.push((id) => ctx.metaclassConforms(ctx.metaclassOf(id) ?? '', meta));
			else
				understood.push((id) =>
					ctx.metadataOf(id).some((a) => unquoteName(simpleName(a.metadata_type)) === meta)
				);
		}
		return (id: string) => {
			if (understood.some((test) => test(id))) return true;
			if (unknown) unsupported.add(filter);
			return unknown;
		};
	});
	const accepts = (id: string) => tests.every((test) => test(id));
	return (id) => {
		const ok = accepts(id);
		for (const u of unsupported) {
			const message = `filter \`${u}\` is not supported for tables; ignored`;
			if (!warnings.includes(message)) warnings.push(message);
		}
		return ok;
	};
}

// --- expressions ---------------------------------------------------------------

type Compiled = ReturnType<typeof parseExpr>;

function parse(source: string): Compiled | null {
	try {
		return parseExpr(source);
	} catch (error) {
		if (error instanceof ParseError) return null;
		throw error;
	}
}

/**
 * A row's fields as variables: numbers as numbers, everything else by its
 * simple name (`RiskCategory::software` compares as `software`).
 */
function scopeOf(r: Row) {
	const values = new Map<string, Value>();
	for (const [k, v] of r.fields) {
		const n = parseNumber(v);
		values.set(k, n !== null ? n : simpleName(v));
	}
	return mapScope(values);
}

function number(expr: Compiled, r: Row): number | null {
	try {
		const value = evaluate(expr, scopeOf(r));
		return typeof value === 'number' ? value : null;
	} catch (error) {
		if (error instanceof EvalError) return null;
		throw error;
	}
}

function holds(expr: Compiled, r: Row): boolean {
	try {
		return evaluateCondition(expr, scopeOf(r));
	} catch (error) {
		if (error instanceof EvalError) return false;
		throw error;
	}
}

// --- pivot -----------------------------------------------------------------------

/** Counts of rows per (row field, column field) value; rows descending unless `sortBy` names the row field. */
function pivotTable(
	view: string,
	rows: Row[],
	rowField: string,
	colField: string,
	sort: string | undefined
): Pick<RenderedTable, 'view' | 'columns' | 'rows' | 'sources'> {
	const rowKeys: string[] = [];
	const colKeys: string[] = [];
	const counts = new Map<string, number>();
	for (const r of rows) {
		const rv = r.fields.get(rowField) ?? '';
		const cv = r.fields.get(colField) ?? '';
		if (!rowKeys.includes(rv)) rowKeys.push(rv);
		if (!colKeys.includes(cv)) colKeys.push(cv);
		const key = JSON.stringify([rv, cv]);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	const s = sort?.trim();
	if (s === rowField) rowKeys.sort(compareCells);
	else rowKeys.sort((a, b) => compareCells(b, a));
	colKeys.sort(compareCells);
	return {
		view,
		columns: [`${rowField}\\${colField}`, ...colKeys],
		rows: rowKeys.map((rk) => [
			rk,
			...colKeys.map((ck) => {
				const n = counts.get(JSON.stringify([rk, ck])) ?? 0;
				return n ? String(n) : '';
			})
		]),
		sources: []
	};
}
