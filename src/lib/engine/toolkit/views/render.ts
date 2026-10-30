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
	EnumLiteral,
	EvalError,
	ParseError,
	evaluate,
	evaluateCondition,
	mapScope,
	parseExpr
} from '#lib/sim/expr.ts';
import type { Scope, Value } from '#lib/sim/expr.ts';
import type { ColumnEdit, Levels, RenderedTable, RowInfo, TraceMatrix } from '../../types';
import { fieldKinds } from './budget';
import { fieldDomain, fieldType, metadataDefinition, typeDomain, type Domain } from './domains';
import type { ElementRecord } from '../model';
import { findView, listViews, tableSpec, viewChain, viewClauses } from './catalog';
import type { ViewContext } from './context';
import { ColumnEdits, type Probe } from './edits';
import { provideRows, requirementRows, type Row } from './rows';
import { riskFieldLevels } from './riskLines';
import {
	compareCells,
	formatNumber,
	isPlainIdentifier,
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
	'result',
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
		rows = condition ? rows.filter((r) => holds(ctx, condition, r)) : [];
	}
	const annotations = rowsSpec.trim().startsWith('@')
		? annotationsOf(ctx, view, rowsSpec.trim().slice(1), rows)
		: undefined;

	const pivot = spec.get('pivot');
	if (pivot !== undefined) {
		const parts = pivot.split(';').map((s) => s.trim());
		if (parts.length !== 2) throw new Error('pivot expects `rowField; colField`');
		// Satisfy or verify links by requirement: a traceability matrix, with every
		// requirement in scope as a row, so the ones nothing satisfies show as gaps.
		const relation = /^relation:\s*(satisfy|verify)$/.exec(rowsSpec.trim())?.[1];
		if (relation && parts[0] === 'requirement' && parts[1] === 'by') {
			const requirements = applyScope(ctx, view, requirementRows(ctx), 'requirements', warnings);
			const table = traceMatrix(
				ctx,
				shown,
				relation as 'satisfy' | 'verify',
				rows,
				requirements,
				spec.get('sortBy')
			);
			return {
				...table,
				warnings,
				editable: table.columns.map(() => null),
				availableFields: probe.fields
			};
		}
		const [rowField, colField] = [parts[0]!, parts[1]!];
		const domains = [rowField, colField].map((f) => fieldDomain(ctx, rowsSpec.trim(), f));
		const table = pivotTable(shown, rows, rowField, colField, spec.get('sortBy'), domains);
		const scales = domains.every((d) => d?.numeric);
		const level = spec.get('cellLevel');
		return {
			...table,
			warnings,
			editable: table.columns.map(() => null),
			availableFields: probe.fields,
			...(scales
				? {
						counts: {
							rows: rowField,
							columns: colField,
							...(level ? cellLevels(ctx, table, rowField, colField, level) : {})
						}
					}
				: {}),
			...(annotations ? { annotations } : {})
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
			// `part = element`: the field under another name.
			if (isPlainIdentifier(expr) && r.fields.has(expr)) return r.fields.get(expr)!;
			return compiled[i] ? cellValue(ctx, compiled[i]!, r) : '';
		}),
		source: {
			element: r.element,
			file: r.fields.get('file') ?? '',
			line: parseNumber(r.fields.get('line') ?? '') ?? 0,
			...(r.byte !== undefined ? { byte: r.byte } : {}),
			...(r.annotation?.record ? { annotation: r.annotation.record.id } : {})
		},
		row: r,
		info: rowInfoOf(r, columns)
	}));

	const columnLevels = columns.map(([column, expr]) =>
		levelsOf(ctx, rowsSpec.trim(), column, expr)
	);

	// By a column, else by a field of the rows the table doesn't show; `;` separates further keys
	// (`-actionPriority; -rpn`). Levels (an enum's literals) sort in the order declared.
	const sortBy = spec.get('sortBy');
	if (sortBy !== undefined) {
		const keys = sortBy
			.split(';')
			.map((k) => k.trim())
			.filter(Boolean)
			.flatMap((written) => {
				const descending = written.startsWith('-');
				const key = descending ? written.slice(1).trim() : written;
				const index = columns.findIndex(([c]) => c === key);
				const field = index < 0 && rows.some((r) => r.fields.has(key));
				if (index < 0 && !field) {
					warnings.push(`sortBy column \`${key}\` is not in the column list`);
					return [];
				}
				const levels =
					(index >= 0 ? columnLevels[index] : levelsOf(ctx, rowsSpec.trim(), key, null)) ?? null;
				const at = (t: (typeof table)[number]) =>
					index >= 0 ? t.cells[index]! : (t.row.fields.get(key) ?? '');
				return [{ at, descending, levels }];
			});
		if (keys.length)
			table = table.toSorted((a, b) => {
				for (const { at, descending, levels } of keys) {
					const order = levels
						? levels.values.indexOf(at(a)) - levels.values.indexOf(at(b))
						: compareCells(at(a), at(b));
					if (order) return descending ? -order : order;
				}
				return 0;
			});
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
		columnSpecs: columns.map(([c, expr]) => (expr === null ? c : `${c} = ${expr}`)),
		rows: table.map((t) => t.cells),
		warnings,
		sources: table.map((t) => t.source),
		editable,
		availableFields: probe.fields,
		...(columnKinds.some((k) => k) ? { columnKinds } : {}),
		...(columnLevels.some((l) => l) ? { columnLevels } : {}),
		...(described ? { rowInfo: table.map((t) => t.info ?? {}) } : {}),
		...(rowsSpec.trim() === 'checks' ? { opensText: true } : {}),
		...(/^(composition|budget:|checks$)/.test(rowsSpec.trim()) ? { configurable: true } : {}),
		...(study ? { trade: study } : {}),
		...(annotations ? { annotations } : {})
	};
}

/** What the provider said about a row, with its notes and problems by column. */
function rowInfoOf(r: Row, columns: [string, string | null][]): RowInfo | undefined {
	if (!r.info) return undefined;
	const { notes, problems, ...rest } = r.info;
	const info: RowInfo = { ...rest };
	const byColumn = (by: Record<string, string>) => {
		const out: Record<number, string> = {};
		columns.forEach(([column, expr], i) => {
			const said = by[expr ?? column] ?? by[column];
			if (said) out[i] = said;
		});
		return Object.keys(out).length ? out : undefined;
	};
	const n = notes && byColumn(notes);
	if (n) info.notes = n;
	const p = problems && byColumn(problems);
	if (p) info.problems = p;
	return Object.keys(info).length ? info : undefined;
}

/**
 * For rows of metadata annotations: the metadata def, and the package new
 * lines go in — the first package the view exposes, else the one most of
 * its rows are written in.
 */
function annotationsOf(
	ctx: ViewContext,
	view: ElementRecord,
	meta: string,
	rows: Row[]
): RenderedTable['annotations'] {
	const def = metadataDefinition(ctx, meta);
	const metadata = (def ? ctx.byId.get(def)?.qualifiedName : null) ?? meta;
	const packageOf = (id: string | null | undefined): ElementRecord | undefined => {
		for (let at = id ? ctx.byId.get(id) : undefined; at;) {
			if (/Package$/.test(at.metaclass)) return at;
			at = at.ownerId ? ctx.byId.get(at.ownerId) : undefined;
		}
		return undefined;
	};
	const clauses = viewChain(ctx, view).map((v) => ({ v, ...viewClauses(ctx.textOf(v)) }));
	const exposing = clauses.find((c) => c.expose.length);
	for (const text of exposing?.expose ?? []) {
		const id = ctx.resolveIn(exposing!.v.id, parseExpose(text).base);
		const record = id ? ctx.byId.get(id) : undefined;
		if (record && /Package$/.test(record.metaclass) && ctx.isContent(record))
			return { metadata, package: record.qualifiedName };
	}
	const counts = new Map<string, number>();
	for (const r of rows) {
		const pkg = packageOf(r.annotation?.record?.ownerId);
		if (pkg?.qualifiedName) counts.set(pkg.qualifiedName, (counts.get(pkg.qualifiedName) ?? 0) + 1);
	}
	const best = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
	return { metadata, package: best };
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
	// A metadata def's fields, even before an annotation gives them (a new FMEA's columns).
	const meta = spec.startsWith('@') ? metadataDefinition(ctx, spec.slice(1).trim()) : null;
	if (meta) {
		fields.push('element');
		for (const t of [meta, ...ctx.supers(meta)])
			for (const f of ctx.ownedBy(t))
				if (f.name && f.kind === 'attribute' && !fields.includes(f.name)) fields.push(f.name);
	}
	for (const r of rows) {
		for (const k of r.fields.keys()) if (!fields.includes(k)) fields.push(k);
		if (r.typeId && !typeIds.includes(r.typeId)) typeIds.push(r.typeId);
	}
	return { fields, typeIds };
}

// --- expose and filter ----------------------------------------------------------

export type ExposeKind = 'element' | 'members' | 'recursive' | 'nested';

interface Exposure {
	kind: ExposeKind;
	target: string;
}

/**
 * `X` / `X::*` / `X::**` / `X::*::**`, with a trailing `[filter]` left out and
 * a leading `$::` (the global scope, as the toolkit prints lifted JSON) dropped.
 */
export function parseExpose(text: string): { kind: ExposeKind; base: string } {
	const t = text
		.replace(/\[[^\]]*\]\s*$/, '')
		.trim()
		.replace(/^\$::/, '');
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

/** What an expose target names, from where the view is written. */
function resolveTarget(ctx: ViewContext, base: string, view: ElementRecord): string | null {
	return ctx.resolveIn(view.id, base);
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
 * simple name (`RiskCategory::software` compares as `software`); a call
 * the language doesn't have is a calc of the model (`Rpn(…)`).
 */
function scopeOf(ctx: ViewContext, r: Row): Scope {
	const values = new Map<string, Value>();
	for (const [k, v] of r.fields) {
		const n = parseNumber(v);
		values.set(k, n !== null ? n : unquoteName(simpleName(v)));
	}
	return { ...mapScope(values), call: ctx.calcs.hook };
}

/** A computed cell: a number as tables write numbers, an enum literal by its name, text as it is. */
function cellValue(ctx: ViewContext, expr: Compiled, r: Row): string {
	try {
		const value = evaluate(expr, scopeOf(ctx, r));
		if (typeof value === 'number') return formatNumber(value);
		if (value instanceof EnumLiteral) return value.name;
		if (typeof value === 'string') return value;
		if (typeof value === 'boolean') return String(value);
		return '';
	} catch (error) {
		if (error instanceof EvalError) return '';
		throw error;
	}
}

function holds(ctx: ViewContext, expr: Compiled, r: Row): boolean {
	try {
		return evaluateCondition(expr, scopeOf(ctx, r));
	} catch (error) {
		if (error instanceof EvalError) return false;
		throw error;
	}
}

/**
 * The levels a column's values are drawn from, in order: a field declared
 * with an enum (`category`), a field an FMEA line gets from its controls
 * (`controlStatus`), or a calc that returns an enum (`ActionPriority(…)`).
 */
function levelsOf(
	ctx: ViewContext,
	rowsSpec: string,
	column: string,
	expr: string | null
): Levels | null {
	const field = expr === null ? column : isPlainIdentifier(expr) ? expr : null;
	if (field !== null) {
		const type = fieldType(ctx, rowsSpec, field);
		const domain = type ? typeDomain(ctx, type) : null;
		if (domain && !domain.numeric)
			return { enum: ctx.byId.get(type!)?.name ?? '', values: domain.values };
		return rowsSpec.startsWith('@') ? riskFieldLevels(ctx, field) : null;
	}
	const call = /^([\p{L}_][\p{L}\p{N}_:']*)\s*\(/u.exec(expr ?? '')?.[1];
	return call && expr!.trim().endsWith(')') ? ctx.calcs.returnLevels(call) : null;
}

/**
 * A pivot's `cellLevel`: an expression of the row and column values
 * (`Acceptability(severity, likelihood)`) evaluated for every cell, so each
 * cell has the level the model gives it (the risk matrix's zones).
 */
function cellLevels(
	ctx: ViewContext,
	table: Pick<RenderedTable, 'columns' | 'rows'>,
	rowField: string,
	colField: string,
	source: string
): { levels: string[][]; levelValues?: string[] } | Record<string, never> {
	const expr = parse(source);
	if (!expr) return {};
	const columns = table.columns.slice(1);
	const levels = table.rows.map((r) =>
		columns.map((c) =>
			cellValue(ctx, expr, {
				fields: new Map([
					[rowField, r[0] ?? ''],
					[colField, c]
				]),
				anchors: [],
				element: ''
			})
		)
	);
	const values = levelsOf(ctx, '', '', source);
	return { levels, ...(values ? { levelValues: values.values } : {}) };
}

// --- pivot -----------------------------------------------------------------------

/**
 * Counts of rows per (row field, column field) value; rows descending unless
 * `sortBy` names the row field. A field whose type bounds its values (a
 * rating of 1 to 10, an enum) has every value as a row or column, in
 * order, so the empty cells show too.
 */
function pivotTable(
	view: string,
	rows: Row[],
	rowField: string,
	colField: string,
	sort: string | undefined,
	domains: (Domain | null)[] = []
): Pick<RenderedTable, 'view' | 'columns' | 'rows' | 'sources'> {
	const [rowDomain, colDomain] = domains;
	const rowKeys: string[] = [...(rowDomain?.values ?? [])];
	const colKeys: string[] = [...(colDomain?.values ?? [])];
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
	// An enum's literals keep their order; numbers and text sort.
	if (!rowDomain || rowDomain.numeric) {
		if (s === rowField) rowKeys.sort(compareCells);
		else rowKeys.sort((a, b) => compareCells(b, a));
	}
	if (!colDomain || colDomain.numeric) colKeys.sort(compareCells);
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

/**
 * A traceability matrix: a row per requirement in scope (and per requirement
 * a link in scope names), a column per element that satisfies or verifies
 * one, `1` where a link is (the count, when there are more). Rows ascend when
 * `sortBy` names the requirement, else descend, as a pivot's do; columns are
 * in the order written names sort, so `drone`, `drone.battery`, … stay together.
 */
function traceMatrix(
	ctx: ViewContext,
	view: string,
	relation: 'satisfy' | 'verify',
	links: Row[],
	requirements: Row[],
	sort: string | undefined
): Pick<RenderedTable, 'view' | 'columns' | 'rows' | 'sources'> & { matrix: TraceMatrix } {
	interface Entry {
		label: string;
		id: string;
		title: string;
		elementId: string | null;
		source: RenderedTable['sources'][number];
	}
	const entries = new Map<string, Entry>();
	const entryOf = (record: ElementRecord): Entry => {
		const id = record.shortName ?? '';
		const title = record.name ?? '';
		return {
			label: id ? `${id} ${title}` : title,
			id,
			title,
			elementId: record.id,
			source: {
				element: record.qualifiedName ?? '',
				file: record.path,
				line: record.span.start_row
			}
		};
	};
	for (const r of requirements) {
		const record = ctx.byId.get(r.anchors[0] ?? '');
		if (record && !entries.has(record.id)) entries.set(record.id, entryOf(record));
	}
	const columns = new Map<string, TraceMatrix['elements'][number]>();
	const found: { requirement: string; by: string; link: NonNullable<Row['link']> }[] = [];
	for (const r of links) {
		const link = r.link;
		if (!link || !link.by) continue;
		const record = link.requirement_id ? ctx.byId.get(link.requirement_id) : undefined;
		const key = record?.id ?? `?${r.fields.get('requirement') ?? link.requirement}`;
		if (!entries.has(key)) {
			const title = r.fields.get('title') ?? '';
			entries.set(
				key,
				record
					? entryOf(record)
					: {
							label: r.fields.get('requirement') ?? title,
							id: '',
							title,
							elementId: null,
							source: { element: '', file: link.path, line: link.span.start_row }
						}
			);
		}
		const by = link.by;
		const column = columns.get(by);
		const target = link.by_id ? ctx.byId.get(link.by_id) : undefined;
		if (!column || (!column.elementId && target)) {
			const path = splitPath(by);
			columns.set(by, {
				written: by,
				name: target?.name ?? path[path.length - 1] ?? by,
				path: path.slice(0, -1),
				qualifiedName: target?.qualifiedName ?? '',
				elementId: target?.id ?? null,
				kind: target?.kind ?? null
			});
		}
		found.push({ requirement: key, by, link });
	}
	const rowKeys = [...entries.keys()];
	const label = (key: string) => entries.get(key)!.label;
	if (sort?.trim() === 'requirement') rowKeys.sort((a, b) => compareCells(label(a), label(b)));
	else rowKeys.sort((a, b) => compareCells(label(b), label(a)));
	const colKeys = [...columns.keys()].sort(compareCells);
	const rowAt = new Map(rowKeys.map((k, i) => [k, i]));
	const colAt = new Map(colKeys.map((k, i) => [k, i]));
	const counts = rowKeys.map(() => colKeys.map(() => 0));
	const marks: TraceMatrix['links'] = [];
	for (const { requirement, by, link } of found) {
		const row = rowAt.get(requirement)!;
		const column = colAt.get(by)!;
		counts[row]![column]! += 1;
		marks.push({
			row,
			column,
			file: link.path,
			line: link.span.start_row,
			start: link.span.start_byte,
			end: link.span.end_byte
		});
	}
	const ordered = rowKeys.map((k) => entries.get(k)!);
	return {
		view,
		columns: ['requirement', ...colKeys],
		rows: ordered.map((e, i) => [e.label, ...counts[i]!.map((n) => (n ? String(n) : ''))]),
		sources: ordered.map((e) => e.source),
		matrix: {
			relation,
			requirements: ordered.map(({ id, title, elementId }) => ({ id, title, elementId })),
			elements: colKeys.map((k) => columns.get(k)!),
			links: marks
		}
	};
}
