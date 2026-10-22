/**
 * What the guided forms (`#lib/create`) read about elements: what each is
 * one of, how to refer to it, and its features — its own, then those its
 * type, specializations and subsetted usages give it, nearest first — with
 * their values evaluated in the element (`Evaluation.valueAt`).
 *
 * Whether an attribute is a number comes from its value type: the
 * toolkit's derived `type` of the attribute's declaration (`mass :>
 * ISQ::mass` is a `MassValue`, a `ScalarQuantityValue`). The first such
 * read costs a derivation pass over the model (~180 ms on the demo in
 * Node), so it is only made for attributes, once per analysis.
 */
import type { ElementFeatures, Evaluated, FeatureInfo } from '../../types';
import { multiplicityOf, type ElementRecord } from '../model';
import type { ViewContext } from './context';

const NUMERIC_TYPES = new Set([
	'ScalarValues::Real',
	'ScalarValues::Integer',
	'ScalarValues::Natural',
	'ScalarValues::Rational',
	'ScalarValues::Positive',
	'ScalarValues::NumericalValue',
	'Quantities::ScalarQuantityValue'
]);

const valueTypes = new WeakMap<ViewContext, Map<string, string[]>>();

export function elementFeatures(
	ctx: ViewContext,
	ids: readonly string[]
): Record<string, ElementFeatures> {
	const out: Record<string, ElementFeatures> = {};
	for (const id of ids) {
		const record = ctx.byId.get(id);
		if (!record?.qualifiedName) continue;
		out[id] = featuresOf(ctx, record);
	}
	return out;
}

function featuresOf(ctx: ViewContext, record: ElementRecord): ElementFeatures {
	const definition = record.isDefinition ? record.id : ctx.effectiveType(record);
	const kinds = (definition ? [definition, ...ctx.supers(definition)] : [])
		.map((k) => ctx.byId.get(k))
		.filter((r): r is ElementRecord => !!r?.isDefinition && !!r.qualifiedName)
		.map((r) => r.qualifiedName!);
	const owners = [record.id, ...ctx.supers(record.id)];
	const byName = new Map<string, ElementRecord[]>();
	const order: string[] = [];
	for (const owner of owners)
		for (const m of ctx.ownedBy(owner)) {
			if (m.isDefinition || !m.name || !FEATURE_KINDS.has(m.kind)) continue;
			if (!byName.has(m.name)) {
				byName.set(m.name, []);
				order.push(m.name);
			}
			byName.get(m.name)!.push(m);
		}
	const evaluation = ctx.evaluation;
	const features: FeatureInfo[] = order.map((name) => {
		const records = byName.get(name)!;
		const nearest = records[0]!;
		const own = nearest.ownerId === record.id;
		const declaration = records.find((r) => !r.redefines) ?? nearest;
		const valued = records.find((r) => r.value !== null);
		const typed = records.find((r) => r.typeIds.length);
		const typeId = typed?.typeIds[0] ?? null;
		const declaring = own ? null : nearest.ownerId ? ctx.byId.get(nearest.ownerId) : undefined;
		const isAttribute = nearest.kind === 'attribute';
		const types = isAttribute ? valueTypesOf(ctx, declaration, nearest) : [];
		let evaluated: Evaluated | null = null;
		if (isAttribute && evaluation)
			evaluated = evaluation.valueAt(`${record.qualifiedName}::${nearest.written ?? name}`);
		const numeric =
			isAttribute && (types.some((t) => NUMERIC_TYPES.has(t)) || evaluated?.kind === 'number');
		return {
			name,
			written: nearest.written ?? name,
			kind: nearest.kind,
			own,
			id: nearest.id,
			declaredBy: declaring?.name ?? null,
			declaredIn: declaration.ownerId
				? (ctx.byId.get(declaration.ownerId)?.qualifiedName ?? null)
				: null,
			type: typeId ? qualifiedNameOf(ctx, typeId) : null,
			typeId,
			ref: /^\s*(?:\w+\s+)*?ref\b/.test(nearest.header),
			variation: /^\s*(?:\w+\s+)*?variation\b/.test(nearest.header),
			multiplicity: records.map((r) => multiplicityOf(r.header)).find((m) => m !== null) ?? null,
			value: valued?.value ?? null,
			valueType: types[0] ? lastSegment(types[0]) : null,
			numeric,
			evaluated
		};
	});
	return {
		id: record.id,
		name: record.name ?? '',
		qualifiedName: record.qualifiedName!,
		kind: record.kind,
		isDefinition: record.isDefinition,
		kinds,
		reference: referenceOf(ctx, record),
		usedBy: record.isDefinition
			? ctx.records
					.filter(
						(r) =>
							ctx.isContent(r) &&
							!r.isDefinition &&
							r.qualifiedName &&
							r.typeIds.includes(record.id) &&
							!/^\s*(?:\w+\s+)*?(?:ref|variant)\b/.test(r.header)
					)
					.map((r) => r.qualifiedName!)
			: [],
		features
	};
}

const FEATURE_KINDS = new Set(['attribute', 'part', 'item', 'port', 'subject', 'occurrence']);

/** The value types of an attribute (qualified), from its declaration, else from the nearest record. */
function valueTypesOf(ctx: ViewContext, declaration: ElementRecord, nearest: ElementRecord) {
	let cache = valueTypes.get(ctx);
	if (!cache) valueTypes.set(ctx, (cache = new Map()));
	for (const r of [declaration, nearest]) {
		const hit = cache.get(r.id);
		if (hit?.length) return hit;
		const types =
			ctx.withHandle(r.id, (h, s) => {
				const found = s.derivedElements(h, 'type');
				try {
					return found.map((t) => s.qualifiedName(t) ?? '').filter(Boolean);
				} finally {
					for (const t of found) t.free();
				}
			}) ?? [];
		cache.set(r.id, types);
		if (types.length) return types;
	}
	return [];
}

function qualifiedNameOf(ctx: ViewContext, id: string): string | null {
	const record = ctx.byId.get(id);
	if (record) return record.qualifiedName;
	return ctx.withHandle(id, (h, s) => s.qualifiedName(h) ?? null) ?? null;
}

/**
 * How another package refers to the element: the outermost element of its
 * owner chain that a package owns is imported, and the rest is a feature
 * chain (`drone.battery`), or a membership path through a definition or a
 * variation (`batteryOptions::lithiumPolymer`).
 */
function referenceOf(ctx: ViewContext, record: ElementRecord): ElementFeatures['reference'] {
	if (record.kind === 'package') return null;
	const chain = [...ctx.ownerChain(record).map((id) => ctx.byId.get(id)), record];
	let top = chain.findIndex(
		(r, i) => i > 0 && r?.kind !== 'package' && chain[i - 1]?.kind === 'package'
	);
	if (top < 0) top = chain.length - 1;
	const head = chain[top];
	if (!head?.qualifiedName) return null;
	let text = head.written ?? head.name ?? '';
	for (let i = top + 1; i < chain.length; i++) {
		const r = chain[i]!;
		const owner = chain[i - 1]!;
		if (!r) return null;
		const membership =
			owner?.isDefinition ||
			r.membership === 'VariantMembership' ||
			/^\s*(?:\w+\s+)*?variation\b/.test(owner?.header ?? '');
		text += `${membership ? '::' : '.'}${r.written ?? r.name ?? ''}`;
	}
	return { imports: head.qualifiedName, text };
}

const lastSegment = (qualified: string) => qualified.split('::').pop() ?? qualified;
