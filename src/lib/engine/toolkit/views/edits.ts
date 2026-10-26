/**
 * Which piece of SysML each table column edits, and what values it takes:
 * the `editable` descriptors of a rendered table (`name`, `shortName`, `doc`,
 * `feature:<name>`, `metadata:<Type>.<field>`, with `text`, `longText`,
 * `enum`, `number` or `enumList` values and the enum's literals). The `edit`
 * method's `setField` takes the same field names.
 *
 * Feature and metadata types come from the toolkit's resolved model: the
 * declaring definition is found through the row elements' resolved types and
 * their specializations, and a feature's type through its resolved typing —
 * an `enum def` (enum, or enumList when its multiplicity allows several), a
 * string, a number or a boolean. When nothing declares the feature, the
 * values the model already gives it say.
 */
import type { ColumnEdit, FeatureValue } from '../../types';
import { multiplicityOf } from '../model';
import type { ViewContext } from './context';
import { isPlainIdentifier, simpleName, unquoteName } from './text';

type ValueKind = ColumnEdit['kind'];

interface FieldType {
	kind?: ValueKind;
	/** Enum literal names, for `enum` and `enumList`. */
	options?: string[];
}

/** What the provider's rows offer: their field names and the types of their elements. */
export interface Probe {
	fields: string[];
	typeIds: string[];
}

interface Feature {
	name: string;
	isAttribute: boolean;
	typeId: string | null;
	many: boolean;
	/** What it specializes, as written (`ISQ::mass`), when it has no type of its own. */
	specializes?: string[];
}

const NUMERIC = new Set([
	'Real',
	'Integer',
	'Natural',
	'Positive',
	'Rational',
	'Number',
	'Complex',
	'NumericalValue',
	'ScalarQuantityValue'
]);

const LIBRARY_METADATA = ['ModelingMetadata', 'RiskMetadata'];

/**
 * A usage's attribute values, for the inspector: the attributes it sets
 * itself (`:>> description = "…"`, or new ones), then those its definition
 * and the definition's supertypes declare and it doesn't set, with what they
 * give. Each with how `setField` edits it (`feature:<name>`).
 */
export function featureValues(ctx: ViewContext, id: string): FeatureValue[] {
	const record = ctx.byId.get(id);
	if (!record || record.isDefinition) return [];
	const type = ctx.effectiveType(record);
	const edits = new ColumnEdits(ctx);
	const probe: Probe = { fields: [], typeIds: type ? [type] : [] };
	const out: FeatureValue[] = [];
	const seen = new Set<string>();
	const declaring = new Map<string, { by: string | null; value: string | null }>();
	for (const t of type ? [type, ...ctx.supers(type)] : []) {
		for (const f of ctx.ownedBy(t)) {
			if (f.isDefinition || f.kind !== 'attribute' || !f.name || declaring.has(f.name)) continue;
			declaring.set(f.name, { by: ctx.nameOf(t) ?? null, value: f.value });
		}
	}
	// A value field edits plain values; an expression (`capacity * usableFraction`) is edited on
	// the attribute itself, where it can be written whole.
	const editFor = (name: string, value: string | null) => {
		const e = edits.forFeature(probe, name);
		const literal = value === null || /^\s*(?:"|-?\d|true\b|false\b|\(?\s*[\w']+::)/.test(value);
		return e && (literal || e.kind !== 'text') && (literal || e.kind !== 'number') ? e : null;
	};
	for (const f of ctx.ownedBy(id)) {
		if (f.isDefinition || f.kind !== 'attribute' || !f.name || seen.has(f.name)) continue;
		seen.add(f.name);
		out.push({
			name: f.name,
			value: f.value,
			own: true,
			declaredBy: declaring.get(f.name)?.by ?? null,
			edit: editFor(f.name, f.value),
			elementId: f.id
		});
	}
	for (const [name, { by, value }] of declaring) {
		if (seen.has(name)) continue;
		out.push({ name, value, own: false, declaredBy: by, edit: editFor(name, value) });
	}
	return out;
}

export class ColumnEdits {
	private readonly ctx: ViewContext;
	private readonly features = new Map<string, Feature[]>();

	constructor(ctx: ViewContext) {
		this.ctx = ctx;
	}

	/** How cells of the column `name` (or `name = expr`) are edited: only columns that copy a field of the row's own element. */
	column(spec: string, probe: Probe, name: string, expr: string | null): ColumnEdit | null {
		let f = name;
		if (expr !== null) {
			const e = expr.trim();
			if (!isPlainIdentifier(e) || !probe.fields.includes(e)) return null;
			f = e;
		}
		const plain = (field: string, kind: ValueKind): ColumnEdit => ({ field, kind });
		if (spec === 'requirements' || spec === 'trace') {
			switch (f) {
				case 'id':
					return plain('shortName', 'text');
				case 'title':
				case 'element':
				case 'requirement':
					return plain('name', 'text');
				case 'text':
					return plain('doc', 'longText');
				case 'status':
				case 'owner':
					return this.metadata(probe, 'StatusInfo', f, true);
				case 'rationale': {
					const declared =
						this.feature(probe, f, false) &&
						probe.typeIds.some((t) => this.declared(t, f) !== null);
					if (declared) return this.feature(probe, f, false);
					const edit = this.metadata(probe, 'Rationale', 'text', true);
					return edit ? { ...edit, kind: 'longText' } : null;
				}
				case 'qualifiedName':
				case 'type':
				case 'issues':
				case 'satisfiedBy':
				case 'verifiedBy':
				case 'satisfied':
				case 'verified':
				case 'check':
				case 'result': // from the verification cases' recorded results, recorded on a case
				case 'file':
				case 'line':
					return null;
				default:
					return this.feature(probe, f, ['kind', 'priority', 'verificationMethod'].includes(f));
			}
		}
		if (spec.startsWith('@')) {
			if (f === 'element' || f === 'file' || f === 'line') return null;
			return this.metadata(probe, spec.slice(1).trim(), f, false);
		}
		if (spec.startsWith('type:')) {
			if (f === 'element') return plain('name', 'text');
			if (['type', 'kind', 'parent', 'file', 'line'].includes(f)) return null;
			return this.feature(probe, f, false);
		}
		if (spec === 'hazards') {
			if (f === 'element') return plain('name', 'text');
			if (f === 'description') return this.feature(probe, f, true);
			return null;
		}
		if (spec.startsWith('kind:')) {
			if (f === 'element') return plain('name', 'text');
			if (f === 'doc') return plain('doc', 'longText');
			return null;
		}
		return null;
	}

	/** How `setField` edits feature `f` of an element of the probe's types. */
	forFeature(probe: Probe, f: string): ColumnEdit | null {
		return this.feature(probe, f, true);
	}

	/** A body value `feature:<f>`: declared as an attribute by a row's type, or already set somewhere (or `always`). */
	private feature(probe: Probe, f: string, always: boolean): ColumnEdit | null {
		const field = `feature:${f}`;
		for (const t of probe.typeIds) {
			const declared = this.declared(t, f);
			if (!declared) continue;
			if (!declared.isAttribute) return null;
			return edit(field, this.typeOf(declared), 'text');
		}
		// `mass :> ISQ::mass` has no type of its own: a quantity, a number with a unit.
		for (const t of probe.typeIds)
			for (const s of [t, ...this.ctx.supers(t)]) {
				const found = this.featuresOf(s).find((x) => x.name === f);
				if (found?.isAttribute && found.specializes?.some((w) => this.isQuantity(w)))
					return edit(field, { kind: 'number' }, 'text');
			}
		if (!always && !probe.fields.includes(f)) return null;
		return edit(field, this.fromFeatureValues(f), 'text');
	}

	/** Whether a written specialization names one of the ISQ's quantities (`ISQ::mass`, `mass`). */
	private isQuantity(written: string): boolean {
		const simple = unquoteName(simpleName(written));
		if (/^ISQ\w*::/.test(written)) return true;
		return (
			!!this.resolve(`ISQ::${simple}`) ||
			this.ctx.records.some(
				(r) =>
					r.kind === 'attribute' &&
					r.name === simple &&
					r.specializes.some((w) => /^ISQ\w*::/.test(w))
			)
		);
	}

	/** A metadata field `metadata:<Meta>.<f>`, declared by the metadata def or given on some row. */
	private metadata(probe: Probe, meta: string, f: string, always: boolean): ColumnEdit | null {
		const field = `metadata:${meta}.${f}`;
		const def = this.metadataDefinition(meta);
		const declared = def ? this.declared(def, f) : null;
		if (declared) {
			if (!declared.isAttribute) return null;
			return edit(field, this.typeOf(declared), 'text');
		}
		if (!always && !probe.fields.includes(f)) return null;
		return edit(field, this.fromMetadataValues(meta, f), 'text');
	}

	/** The metadata def named `meta`: the project's, one an annotation uses, or the standard library's. */
	private metadataDefinition(meta: string): string | null {
		const own = this.ctx.definitionNamed(meta);
		if (own) return own;
		const used = this.ctx.annotations.find(
			(a) => unquoteName(simpleName(a.metadata_type)) === meta && a.metadata_qualified_type
		)?.metadata_qualified_type;
		for (const name of [used, ...LIBRARY_METADATA.map((p) => `${p}::${meta}`)]) {
			if (!name) continue;
			const id = this.resolve(name);
			if (id) return id;
		}
		return null;
	}

	private resolve(qualifiedName: string): string | null {
		const session = this.ctx.session;
		const handle = session?.resolve(qualifiedName);
		if (!session || !handle) return null;
		try {
			return session.elementId(handle);
		} finally {
			handle.free();
		}
	}

	/** The declaration of feature `f` in type `typeId` or its supertypes (the first one with a type). */
	private declared(typeId: string, f: string): Feature | null {
		for (const t of [typeId, ...this.ctx.supers(typeId)]) {
			const found = this.featuresOf(t).find((x) => x.name === f && x.typeId);
			if (found) return found;
		}
		return null;
	}

	/** The features a type owns: from its records, or read from the library. */
	private featuresOf(typeId: string): Feature[] {
		const cached = this.features.get(typeId);
		if (cached) return cached;
		let list: Feature[];
		if (this.ctx.byId.has(typeId)) {
			list = this.ctx
				.ownedBy(typeId)
				.filter((r) => !r.isDefinition && r.name)
				.map((r) => ({
					name: r.name!,
					isAttribute: r.kind === 'attribute',
					typeId: r.typeIds[0] ?? null,
					many: isMany(multiplicityOf(r.header)),
					specializes: r.specializes
				}));
		} else {
			list =
				this.ctx.withHandle(typeId, (handle, s) =>
					s.members(handle).map((m) => {
						try {
							const types = s.typings(m);
							const type = types[0] ? s.elementId(types[0]) : null;
							for (const t of types) t.free();
							return {
								name: s.name(m) ?? '',
								isAttribute: s.metaclass(m) === 'AttributeUsage',
								typeId: type,
								many: false
							};
						} finally {
							m.free();
						}
					})
				) ?? [];
		}
		this.features.set(typeId, list);
		return list;
	}

	private typeOf(feature: Feature): FieldType {
		return feature.typeId ? this.classify(feature.typeId, feature.many) : {};
	}

	/** What values of a type look like. */
	private classify(typeId: string, many: boolean): FieldType {
		let current: string | undefined = typeId;
		for (let i = 0; current && i < 16; i++) {
			const name = this.ctx.nameOf(current) ?? '';
			if (name === 'String') return { kind: 'text' };
			if (name === 'Boolean') return { kind: 'enum', options: ['true', 'false'] };
			if (NUMERIC.has(name)) return { kind: 'number' };
			if (this.ctx.metaclassOf(current) === 'EnumerationDefinition')
				return { kind: many ? 'enumList' : 'enum', options: this.literals(current) };
			const record = this.ctx.byId.get(current);
			if (!record) return byName(name);
			const generals = this.ctx.generalsOf(record);
			if (!generals.length) {
				// A library type the model adapter has only as written (`:> Integer`).
				const written = record.specializes[0];
				return written ? byName(unquoteName(simpleName(written))) : {};
			}
			current = generals[0];
		}
		return {};
	}

	private literals(enumId: string): string[] {
		if (this.ctx.byId.has(enumId))
			return this.ctx
				.ownedBy(enumId)
				.filter((r) => r.metaclass === 'EnumerationUsage' && r.name)
				.map((r) => r.name!);
		return (
			this.ctx.withHandle(enumId, (handle, s) =>
				s.members(handle).flatMap((m) => {
					try {
						return s.metaclass(m) === 'EnumerationUsage' ? [s.name(m) ?? ''] : [];
					} finally {
						m.free();
					}
				})
			) ?? []
		).filter(Boolean);
	}

	/** The type a feature's existing values reveal: the first `:>> f = …` written anywhere. */
	private fromFeatureValues(f: string): FieldType {
		const value = this.ctx.records.find((r) => r.name === f && r.value !== null)?.value;
		return value ? this.fromValue(value) : {};
	}

	/** Same, for a metadata field: the first value an annotation of that type gives it. */
	private fromMetadataValues(meta: string, f: string): FieldType {
		for (const a of this.ctx.annotations) {
			if (unquoteName(simpleName(a.metadata_type)) !== meta) continue;
			const value = a.values.find(([k]) => k === f)?.[1];
			if (value) return this.fromValue(value);
		}
		return {};
	}

	/** What a value written in the source says about its type. */
	private fromValue(text: string): FieldType {
		const t = text.trim();
		if (t.startsWith('"')) return { kind: 'text' };
		if (t === 'true' || t === 'false') return { kind: 'enum', options: ['true', 'false'] };
		const number = t.split('[')[0]!.trim();
		if (number && Number.isFinite(Number(number))) return { kind: 'number' };
		const list = t.startsWith('(') && t.endsWith(')');
		const first = list ? (t.slice(1, -1).split(',')[0] ?? '').trim() : t;
		const at = first.lastIndexOf('::');
		if (at < 0 || !isNamePath(first)) return {};
		const qualifier = first.slice(0, at);
		const def = this.ctx.definitionNamed(qualifier);
		const type = def ? this.classify(def, list) : {};
		return {
			kind: list ? 'enumList' : 'enum',
			...(type.options && (type.kind === 'enum' || type.kind === 'enumList')
				? { options: type.options }
				: {})
		};
	}
}

/** A library type by its name: the scalar types, and ISQ's quantity values (`MassValue`). */
function byName(name: string): FieldType {
	if (name === 'String') return { kind: 'text' };
	if (name === 'Boolean') return { kind: 'enum', options: ['true', 'false'] };
	if (NUMERIC.has(name) || name.endsWith('Value')) return { kind: 'number' };
	return {};
}

function edit(field: string, type: FieldType, fallback: ValueKind): ColumnEdit {
	return { field, kind: type.kind ?? fallback, ...(type.options ? { options: type.options } : {}) };
}

/** `A::B::'c'`: name segments only. */
function isNamePath(text: string): boolean {
	return text.split('::').every((s) => isPlainIdentifier(s.trim()) || /^'[^']+'$/.test(s.trim()));
}

/** Whether a multiplicity allows more than one value (`[0..*]`, `[1..*]`, `[2]`, `[*]`). */
function isMany(multiplicity: string | null): boolean {
	if (!multiplicity) return false;
	const above = (s: string) => s === '*' || (/^\d+$/.test(s) && Number(s) > 1);
	const [lower, upper] = multiplicity.split('..').map((s) => s.trim());
	return upper !== undefined ? above(upper) : above(lower!);
}
