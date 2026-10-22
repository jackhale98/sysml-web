/**
 * The project's views: every `view def` and `view` usage, with the
 * `@TableRendering` that applies to it (its own, over what it inherits from
 * the view def it is typed by or specializes) and its `expose`, `filter`
 * and `render` clauses as written.
 */
import type { ViewInfo } from '../../types';
import type { ElementRecord } from '../model';
import type { ViewContext } from './context';
import { collapseWhitespace, simpleName, splitPath, unescape, unquote, unquoteName } from './text';

const isView = (r: ElementRecord) =>
	r.metaclass === 'ViewUsage' || r.metaclass === 'ViewDefinition';

/** The views the SysML standard library defines, which the app draws. */
const STANDARD_VIEWS = new Set([
	'GeneralView',
	'InterconnectionView',
	'StateTransitionView',
	'ActionFlowView',
	'SequenceView'
]);

/**
 * The standard view a chain of view defs comes down to. The standard library's
 * defs are not in the model the app reads, so a def's `:> GeneralView` is
 * matched as written.
 */
function standardOf(chain: ElementRecord[]): string | undefined {
	for (const [i, r] of chain.entries()) {
		if (i > 0 && STANDARD_VIEWS.has(r.name ?? '')) return r.name ?? undefined;
		const written = r.isDefinition ? r.specializes : r.type ? [r.type] : [];
		const found = written.map((w) => unquoteName(simpleName(w))).find((w) => STANDARD_VIEWS.has(w));
		if (found) return found;
	}
	return undefined;
}

/** Every view def and view usage, in file and declaration order. */
export function listViews(ctx: ViewContext): ViewInfo[] {
	return viewRecords(ctx).map((view) => {
		const clauses = viewClauses(ctx.textOf(view));
		const doc = view.docs.length ? collapseWhitespace(view.docs.join(' ')) : '';
		const info: ViewInfo = {
			name: view.name ?? '',
			...(view.qualifiedName ? { qualifiedName: view.qualifiedName } : {}),
			file: view.path,
			isUsage: !view.isDefinition,
			hasTable: tableSpec(ctx, view) !== null,
			builtin: !ctx.isContent(view)
		};
		if (!view.isDefinition && view.type) info.definition = unquoteName(simpleName(view.type));
		const chain = viewChain(ctx, view);
		const standard = standardOf(chain);
		if (standard && standard !== info.definition) info.standard = standard;
		if (doc) info.doc = doc;
		// `render` as written on the view, else as its view defs say.
		const render = [clauses, ...chain.slice(1).map((r) => viewClauses(ctx.textOf(r)))].find(
			(c) => c.render.length
		)?.render[0];
		if (render) info.renderAs = render;
		if (clauses.expose.length) info.exposes = clauses.expose;
		return info;
	});
}

export function viewRecords(ctx: ViewContext): ElementRecord[] {
	// Project files first, then the bundled libraries (the records come in session order).
	const views = ctx.records.filter((r) => isView(r) && r.name && r.qualifiedName);
	return [...views.filter((v) => ctx.isContent(v)), ...views.filter((v) => !ctx.isContent(v))];
}

/** A view by qualified name (any suffix of it) or simple name: the first that matches. */
export function findView(ctx: ViewContext, name: string): ElementRecord | undefined {
	const views = viewRecords(ctx);
	const wanted = splitPath(name);
	if (wanted.length > 1) {
		const found = views.find((v) => endsWith(splitPath(v.qualifiedName ?? ''), wanted));
		if (found) return found;
	}
	const simple = wanted[wanted.length - 1];
	return views.find((v) => v.name === simple);
}

function endsWith(path: string[], suffix: string[]): boolean {
	return (
		suffix.length <= path.length &&
		suffix.every((s, i) => path[path.length - suffix.length + i] === s)
	);
}

/** The view def a view is typed by (usage) or specializes (def), if it is in the model. */
function nextInChain(ctx: ViewContext, view: ElementRecord): ElementRecord | undefined {
	const candidates = view.isDefinition ? view.generalIds : [...view.typeIds, ...view.generalIds];
	for (const id of candidates) {
		const record = id ? ctx.byId.get(id) : undefined;
		if (record?.metaclass === 'ViewDefinition') return record;
	}
	// A specialization the model adapter only has as written.
	for (const written of view.isDefinition ? view.specializes : []) {
		const simple = unquoteName(simpleName(written));
		const found = ctx.records.find((r) => r.metaclass === 'ViewDefinition' && r.name === simple);
		if (found) return found;
	}
	return undefined;
}

/** The view, then the defs whose clauses it inherits: most specific first. */
export function viewChain(ctx: ViewContext, view: ElementRecord): ElementRecord[] {
	const chain = [view];
	for (let next = nextInChain(ctx, view); next && chain.length <= 16;) {
		if (chain.includes(next)) break;
		chain.push(next);
		next = nextInChain(ctx, next);
	}
	return chain;
}

/** `@TableRendering` values that apply: inherited ones, overridden field by field by the view's own. */
export function tableSpec(ctx: ViewContext, view: ElementRecord): Map<string, string> | null {
	let spec: Map<string, string> | null = null;
	for (const record of viewChain(ctx, view).reverse()) {
		const own = ctx
			.metadataOf(record.id)
			.find((a) => unquoteName(simpleName(a.metadata_type)) === 'TableRendering');
		if (!own) continue;
		spec ??= new Map();
		for (const [key, value] of own.values) spec.set(key, unescape(unquote(value)));
	}
	return spec;
}

export interface ViewClauses {
	expose: string[];
	filter: string[];
	render: string[];
}

/** The `expose`, `filter` and `render` statements directly in a view's body, as written. */
export function viewClauses(text: string): ViewClauses {
	const out: ViewClauses = { expose: [], filter: [], render: [] };
	let depth = 0;
	for (let i = 0; i < text.length; i++) {
		const c = text[i]!;
		if (c === "'" || c === '"') {
			const end = closing(text, i);
			i = end;
		} else if (c === '/' && text[i + 1] === '*') {
			const end = text.indexOf('*/', i + 2);
			i = end < 0 ? text.length : end + 1;
		} else if (c === '/' && text[i + 1] === '/') {
			const end = text.indexOf('\n', i);
			i = end < 0 ? text.length : end;
		} else if (c === '{') depth++;
		else if (c === '}') depth--;
		else if (depth === 1 && /[\s{;]/.test(text[i - 1] ?? ' ')) {
			const keyword = /^(expose|filter|render)\s/.exec(text.slice(i, i + 8))?.[1] as
				keyof ViewClauses | undefined;
			if (!keyword) continue;
			const end = statementEnd(text, i);
			if (end < 0) break;
			const body = text.slice(i + keyword.length, end).trim();
			if (body) out[keyword].push(keyword === 'render' ? renderName(body) : body);
			i = end;
		}
	}
	return out;
}

/** `render asTreeDiagram` → `asTreeDiagram`; `render r : R` → `r`. */
function renderName(body: string): string {
	const named = /^(?:rendering\s+)?([^\s:;]+)/.exec(body);
	return named?.[1] ?? body;
}

/** The `;` that ends a statement, past strings. */
function statementEnd(text: string, from: number): number {
	for (let i = from; i < text.length; i++) {
		const c = text[i]!;
		if (c === "'" || c === '"') i = closing(text, i);
		else if (c === ';') return i;
		else if (c === '{' || c === '}') return -1;
	}
	return -1;
}

function closing(text: string, at: number): number {
	const quote = text[at]!;
	for (let i = at + 1; i < text.length; i++) {
		if (text[i] === '\\') i++;
		else if (text[i] === quote) return i;
	}
	return text.length;
}
