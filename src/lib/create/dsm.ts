/**
 * New dependency matrices (DSM, N² chart): the kinds people can make, the
 * view each writes — typed by a view def of the `DependencyMatrices`
 * library, its elements the view's `expose`, its settings the view's own
 * `@MatrixRendering` where they differ from the def's — and the library,
 * copied into a project that lacks it (the demo's copy, as the risk
 * libraries are).
 */
import type { DependencyKind, MatrixElements } from '#lib/engine/types.ts';
import type { ProjectFile, Workspace } from '#lib/project/workspace.svelte.ts';
import { viewTitle } from '#lib/workbench/views.ts';
import library from '/src/demo/drone/libraries/DependencyMatrices.sysml?raw';
import { merge, viewWrite, type Write } from './apply';
import { previewOf, viewNameOf, type Plan } from './plans';
import { docComment, name as sysmlName } from './sysml';

export const DSM_LIBRARY: ProjectFile & { package: string } = {
	path: 'libraries/DependencyMatrices.sysml',
	package: 'DependencyMatrices',
	text: library
};

/** The library as a write, when the project doesn't have it yet (and its path is free). */
export function dsmLibraryWrite(workspace: Workspace): Write {
	const has = workspace.elements.some(
		(e) => e.kind === 'package' && e.name === DSM_LIBRARY.package && !e.isDefinition
	);
	if (has || workspace.text(DSM_LIBRARY.path) !== undefined) return {};
	return { files: [{ path: DSM_LIBRARY.path, text: DSM_LIBRARY.text }] };
}

export interface DsmKind {
	id: 'parts' | 'n2' | 'actions' | 'requirements';
	label: string;
	description: string;
	/** The library's view def. */
	definition: string;
	elements: MatrixElements;
	/** What the def counts, and what else can be chosen (as the engine offers them). */
	kinds: DependencyKind[];
	available: DependencyKind[];
	/** What the picker offers, and the question it asks. */
	covers: string;
	/** One element (a part, a process), or several (packages of requirements). */
	single: boolean;
	/** The name a new one starts with, after what it covers. */
	suffix: string;
}

export const DSM_KINDS: readonly DsmKind[] = [
	{
		id: 'parts',
		label: 'Part DSM',
		description:
			'The parts of one element against each other: what connects to, passes items to or is bound to what.',
		definition: 'DependencyMatrix',
		elements: 'parts',
		kinds: ['connection', 'flow', 'binding'],
		available: ['connection', 'flow', 'binding', 'allocation', 'typing', 'satisfy'],
		covers: 'Whose parts to compare: a part with parts, or a package of part definitions.',
		single: true,
		suffix: 'DSM'
	},
	{
		id: 'n2',
		label: 'N² interface chart',
		description:
			'The parts on the diagonal, and in each cell the interfaces and items that pass between them.',
		definition: 'InterfaceN2',
		elements: 'parts',
		kinds: ['connection', 'flow'],
		available: ['connection', 'flow', 'binding', 'allocation', 'typing', 'satisfy'],
		covers: 'Whose parts to chart: a part with parts.',
		single: true,
		suffix: 'N2'
	},
	{
		id: 'actions',
		label: 'Functional DSM',
		description:
			'The steps of a process against each other: which comes after which, and which passes items to which.',
		definition: 'FunctionalDsm',
		elements: 'actions',
		kinds: ['succession', 'flow'],
		available: ['succession', 'flow', 'binding', 'allocation', 'typing'],
		covers: 'Which process: an action with steps.',
		single: true,
		suffix: 'DSM'
	},
	{
		id: 'requirements',
		label: 'Requirement DSM',
		description:
			'Requirements against each other: which are derived from or refine which, to see what a change touches.',
		definition: 'RequirementDsm',
		elements: 'requirements',
		kinds: ['derivation', 'refinement'],
		available: ['derivation', 'refinement', 'satisfy', 'typing'],
		covers: 'Which requirements: their packages, or single requirements.',
		single: false,
		suffix: 'DSM'
	}
];

export function dsmKind(id: string | undefined): DsmKind | undefined {
	return DSM_KINDS.find((k) => k.id === id);
}

/** An element the matrix can be of, as the model tree gives it. */
export interface DsmTarget {
	qualifiedName: string;
	label: string;
	kind: string;
	isDefinition: boolean;
}

/** Which elements the kind's picker offers. */
export function canCompare(kind: DsmKind, target: Pick<DsmTarget, 'kind' | 'isDefinition'>) {
	switch (kind.elements) {
		case 'parts':
			return (
				target.kind === 'part' ||
				(kind.id === 'parts' && target.kind === 'package') ||
				(target.kind === 'item' && !target.isDefinition)
			);
		case 'actions':
			return ['action', 'perform', 'use_case', 'use case'].includes(target.kind);
		case 'requirements':
			return target.kind === 'package' || (target.kind === 'requirement' && !target.isDefinition);
	}
}

export interface DsmInput {
	kind: DsmKind;
	title: string;
	doc?: string;
	targets: DsmTarget[];
	/** Parts: the parts of the parts too, one level deeper. */
	deeper?: boolean;
	kinds: DependencyKind[];
	order: 'model' | 'clustered';
}

/** What `expose` says for a target: its members (`drone::*`), a level deeper (`drone::**`), or a requirement itself. */
export function dsmExpose(input: Pick<DsmInput, 'deeper'>, target: DsmTarget): string {
	if (target.kind === 'requirement') return target.qualifiedName;
	return `${target.qualifiedName}::${input.deeper && target.kind !== 'package' ? '**' : '*'}`;
}

/** The view usage, as the demo writes its matrices. */
export function dsmViewText(
	input: DsmInput,
	spell: (qualified: string) => string = (q) => q
): string {
	const { kind } = input;
	const lines = [
		`view ${sysmlName(viewNameOf(input.title))} : ${spell(`DependencyMatrices::${kind.definition}`)} {`
	];
	if (input.doc?.trim()) lines.push(`    ${docComment(input.doc)}`);
	for (const t of input.targets) lines.push(`    expose ${dsmExpose(input, t)};`);
	const settings: string[] = [];
	const kinds = kind.available.filter((k) => input.kinds.includes(k));
	if (kinds.join(';') !== kind.kinds.join(';'))
		settings.push(`dependencies = "${kinds.join('; ')}";`);
	if (input.order === 'clustered') settings.push('order = "clustered";');
	if (input.deeper && input.targets.some((t) => t.kind !== 'package')) settings.push('levels = 2;');
	if (settings.length)
		lines.push(`    @${spell('DependencyMatrices::MatrixRendering')} { ${settings.join(' ')} }`);
	lines.push('}');
	return lines.join('\n');
}

/** The name a new matrix starts with: "Drone DSM", "Requirement DSM". */
export function dsmTitle(kind: DsmKind, targets: Pick<DsmTarget, 'label'>[]): string {
	const about = targets.length === 1 ? targets[0]!.label : null;
	if (!about) return kind.elements === 'requirements' ? 'Requirement DSM' : `Dependency matrix`;
	const words = about.replace(/^'|'$/g, '');
	return `${words[0]!.toUpperCase()}${words.slice(1)} ${kind.suffix}`;
}

/**
 * Whether a view's name is taken: as written, or as it reads (`droneDSM`
 * and `droneDsm` are both "Drone DSM").
 */
export function nameTaken(taken: ReadonlySet<string>, name: string): boolean {
	const lower = name.toLowerCase();
	return [...taken].some((t) => t.toLowerCase() === lower);
}

/** What is wrong with the choices, in plain words, or null. */
export function dsmProblem(input: {
	kind: DsmKind | undefined;
	title: string;
	targets: DsmTarget[];
	kinds: DependencyKind[];
	taken: ReadonlySet<string>;
}): string | null {
	if (!input.kind) return 'Choose what kind of matrix to make.';
	if (!input.targets.length && input.kind.elements !== 'requirements')
		return `Choose ${input.kind.elements === 'actions' ? 'the process' : 'whose parts to compare'}.`;
	if (input.kind.single && input.targets.length > 1) return 'Choose one element.';
	if (!input.kinds.length) return 'Choose at least one kind of link to count.';
	if (!input.title.trim()) return 'Give the matrix a name.';
	if (nameTaken(input.taken, viewNameOf(input.title)))
		return `There is already a view called “${input.title.trim()}”. Choose another name.`;
	return null;
}

export function planDsm(workspace: Workspace, input: DsmInput, libraries: Write = {}): Plan {
	const name = viewNameOf(input.title);
	const view = viewWrite(workspace, (spell) => [dsmViewText(input, spell)]);
	return {
		write: merge(libraries, view),
		preview: previewOf(view),
		label: `Created the dependency matrix ${viewTitle(name)}`,
		open: { name, title: viewTitle(name) }
	};
}
