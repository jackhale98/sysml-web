/**
 * Suggestions for a type or a more general definition, as offered by the
 * inspector's type picker: the project's own definitions first, then the
 * standard library. Pure, so the ranking and the text to insert are tested.
 */
import type { LibraryHit } from '#lib/engine/types.ts';
import type { ModelElement } from '#lib/project/elements.ts';
import { fuzzyMatch, type Range } from './palette.ts';

export interface TypeSuggestion {
	id: string;
	/** Name shown. */
	label: string;
	/** Text written into the model. */
	insert: string;
	kind: string;
	source: 'project' | 'library';
	/** Where it is: a file in the project, or a library package. */
	detail: string;
	/** A plain-language line about it. */
	description?: string;
	/** Matched ranges of `label`, for highlighting. */
	ranges?: readonly Range[];
}

/** The definition kinds that can type (or generalise) an element of `kind`. */
export function definitionKinds(kind: string): { project: string[]; library: string[] } {
	switch (kind) {
		case 'attribute':
			return { project: ['attribute', 'enum'], library: ['attribute def', 'enum def', 'datatype'] };
		case 'ref':
			return { project: ['part', 'item', 'attribute', 'port'], library: ['part def', 'item def'] };
		case 'item':
			return { project: ['item', 'part'], library: ['item def', 'part def'] };
		case 'connection':
			return {
				project: ['connection', 'interface'],
				library: ['connection def', 'interface def']
			};
		default:
			return { project: [kind], library: [`${kind} def`] };
	}
}

/** Value types most attributes use, with what they mean. */
export const COMMON_VALUE_TYPES: readonly { qualifiedName: string; description: string }[] = [
	{ qualifiedName: 'ScalarValues::Real', description: 'A number, such as 0.3 or 1250' },
	{ qualifiedName: 'ScalarValues::Integer', description: 'A whole number' },
	{ qualifiedName: 'ScalarValues::Boolean', description: 'True or false' },
	{ qualifiedName: 'ScalarValues::String', description: 'Text' },
	{ qualifiedName: 'ISQBase::MassValue', description: 'A mass, e.g. 1.2 [kg]' },
	{ qualifiedName: 'ISQBase::LengthValue', description: 'A length, e.g. 350 [mm]' },
	{ qualifiedName: 'ISQBase::DurationValue', description: 'A duration, e.g. 25 [min]' },
	{ qualifiedName: 'ISQSpaceTime::SpeedValue', description: 'A speed, e.g. 15 [m/s]' },
	{ qualifiedName: 'ISQMechanics::PowerValue', description: 'A power, e.g. 400 [W]' },
	{ qualifiedName: 'ISQMechanics::ForceValue', description: 'A force, e.g. 20 [N]' },
	{ qualifiedName: 'ISQThermodynamics::EnergyValue', description: 'An energy, e.g. 98 [W*h]' }
];

const lastSegment = (qualifiedName: string) => qualifiedName.split('::').pop() ?? qualifiedName;
const packageOf = (qualifiedName: string) => qualifiedName.split('::').slice(0, -1).join('::');

/** Library packages that `ISQ::*` and `SI::*` bring in (they re-export their parts). */
function reexports(imported: string, pkg: string): boolean {
	if (imported === 'ISQ') return pkg.startsWith('ISQ');
	if (imported === 'SI') return pkg === 'SI' || pkg === 'SIPrefixes';
	return false;
}

/**
 * Whether `file` can use a library name without qualifying it: it imports
 * the name, or its package with `::*` / `::**`.
 */
export function imports(file: string, qualifiedName: string): boolean {
	const pkg = packageOf(qualifiedName);
	for (const match of file.matchAll(/\bimport\s+([^;{]+?)\s*;/g)) {
		const path = match[1]!.replace(/\s+/g, '').replace(/^all\b/, '');
		if (path === qualifiedName) return true;
		const wildcard = path.match(/^(.*)::\*\*?$/);
		if (!wildcard) continue;
		const imported = wildcard[1]!;
		if (imported === pkg || reexports(imported, pkg)) return true;
		if (path.endsWith('::**') && pkg.startsWith(`${imported}::`)) return true;
	}
	return false;
}

/** The project's definitions of the right kinds, best matches first. */
export function projectSuggestions(
	elements: readonly ModelElement[],
	kinds: readonly string[],
	query: string,
	exclude: readonly string[] = []
): TypeSuggestion[] {
	const q = query.trim();
	const seen = new Set<string>();
	const out: { suggestion: TypeSuggestion; score: number }[] = [];
	for (const e of elements) {
		if (!e.isDefinition || !kinds.includes(e.kind) || exclude.includes(e.name)) continue;
		if (seen.has(e.name)) continue;
		const match = q ? fuzzyMatch(q, e.label) : { score: 0, ranges: [] };
		const idMatch = q && e.shortName ? fuzzyMatch(q, e.shortName) : null;
		if (q && !match && !idMatch) continue;
		seen.add(e.name);
		out.push({
			suggestion: {
				id: `project:${e.key}`,
				label: e.label,
				insert: e.name,
				kind: e.kind,
				source: 'project',
				detail: e.file.split('/').pop() ?? e.file,
				description: e.doc?.split('\n')[0] ?? undefined,
				ranges: match?.ranges
			},
			score: Math.max(match?.score ?? 0, idMatch?.score ?? 0)
		});
	}
	return out
		.sort(
			(a, b) => (q ? b.score - a.score : 0) || a.suggestion.label.localeCompare(b.suggestion.label)
		)
		.map(({ suggestion }) => suggestion);
}

/** Library definitions of the right kinds, written so `file` resolves them. */
export function librarySuggestions(
	hits: readonly LibraryHit[],
	kinds: readonly string[],
	query: string,
	file: string
): TypeSuggestion[] {
	const out: TypeSuggestion[] = [];
	const seen = new Set<string>();
	for (const hit of hits) {
		if (!hit.isDefinition || !kinds.includes(hit.kind) || seen.has(hit.qualifiedName)) continue;
		seen.add(hit.qualifiedName);
		out.push(libraryEntry(hit.qualifiedName, hit.kind, file, query));
	}
	return out;
}

/** The common value types, for an attribute whose type is still empty. */
export function commonValueTypes(file: string): TypeSuggestion[] {
	return COMMON_VALUE_TYPES.map(({ qualifiedName, description }) => ({
		...libraryEntry(
			qualifiedName,
			qualifiedName.startsWith('Scalar') ? 'datatype' : 'attribute def',
			file,
			''
		),
		description
	}));
}

function libraryEntry(
	qualifiedName: string,
	kind: string,
	file: string,
	query: string
): TypeSuggestion {
	const name = lastSegment(qualifiedName);
	return {
		id: `library:${qualifiedName}`,
		label: name,
		insert: imports(file, qualifiedName) ? name : qualifiedName,
		kind: kind.replace(/ def$/, ''),
		source: 'library',
		detail: packageOf(qualifiedName),
		ranges: query.trim() ? fuzzyMatch(query.trim(), name)?.ranges : undefined
	};
}
