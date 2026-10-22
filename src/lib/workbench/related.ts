/**
 * An element's related elements as the inspector lists them: what it refers
 * to, what refers to it, each grouped by how, in plain words.
 */
import type { RelatedElement, RelationKind } from '#lib/engine/types.ts';
import type { ModelElement } from '#lib/project/elements.ts';

/** How each relationship reads, from the element (`out`) and towards it (`in`). */
export const RELATION_WORDS: Record<RelationKind, { out: string; in: string }> = {
	typed: { out: 'Defined by', in: 'Used as' },
	specializes: { out: 'Specializes', in: 'Specialized by' },
	satisfies: { out: 'Satisfies', in: 'Satisfied by' },
	verifies: { out: 'Verifies', in: 'Verified by' },
	derives: { out: 'Derived from', in: 'Derived into' },
	connects: { out: 'Connected to', in: 'Connected from' },
	binds: { out: 'Bound to', in: 'Bound from' },
	flows: { out: 'Sends to', in: 'Receives from' },
	allocates: { out: 'Allocated to', in: 'Has allocated to it' }
};

const ORDER: RelationKind[] = [
	'typed',
	'specializes',
	'satisfies',
	'verifies',
	'derives',
	'connects',
	'binds',
	'flows',
	'allocates'
];

export interface RelatedRow {
	/** The element, when it is one of the project's (rows without one are not links). */
	element: ModelElement | undefined;
	name: string;
	/** The connection, flow or allocation that relates them, by name. */
	via?: string;
	kind: string;
	isDefinition: boolean;
}

export interface RelatedGroup {
	kind: RelationKind;
	direction: 'out' | 'in';
	title: string;
	rows: RelatedRow[];
}

/**
 * The groups, outgoing first, each kind in a fixed order and its rows by
 * name. `leaveOut` drops what the inspector shows elsewhere (a requirement's
 * own "Satisfied by" and "Verified by").
 */
export function groupRelated(
	related: RelatedElement[],
	elements: ModelElement[],
	leaveOut: (kind: RelationKind, direction: 'out' | 'in') => boolean = () => false
): RelatedGroup[] {
	const byId = new Map(elements.flatMap((e) => (e.id ? [[e.id, e] as const] : [])));
	const byKey = new Map(elements.map((e) => [e.key, e]));
	const groups: RelatedGroup[] = [];
	for (const direction of ['out', 'in'] as const) {
		for (const kind of ORDER) {
			if (leaveOut(kind, direction)) continue;
			const rows = related
				.filter((r) => r.kind === kind && r.direction === direction)
				.map((r): RelatedRow => {
					const element =
						byId.get(r.element.id) ?? byKey.get(`${r.element.file}@${r.element.start_byte}`);
					return {
						element,
						name: element?.label ?? r.element.name,
						...(r.via ? { via: r.via } : {}),
						kind: element?.kind ?? r.element.kind,
						isDefinition: r.element.isDefinition
					};
				})
				.sort((a, b) => a.name.localeCompare(b.name));
			if (rows.length)
				groups.push({ kind, direction, title: RELATION_WORDS[kind][direction], rows });
		}
	}
	return groups;
}
