/**
 * Things the guides can do for the person: the "Next steps" checklist, the
 * help's "How do I…" answers and `#do:` links in a project's tour all name
 * one of these, and the workbench runs it the same way wherever it is asked.
 */
import { resolve } from '$app/paths';
import type { Engine } from '#lib/engine/client.ts';
import { pwa } from '#lib/offline/pwa.svelte.ts';
import type { ModelElement } from '#lib/project/elements.ts';
import { leaving } from '#lib/project/leaving.svelte.ts';
import type { ProjectSession } from '#lib/project/session.svelte.ts';
import { isLibraryFile, type Workspace } from '#lib/project/workspace.svelte.ts';
import { toasts } from '#lib/ui/toasts.svelte.ts';
import { canOwnMembers, type AddKind } from './templates.ts';
import type { WorkbenchUi } from './ui.svelte.ts';
import { viewTitle } from './views.ts';

export const GUIDE_ACTIONS = [
	'add-requirement',
	'add-part',
	'link',
	'connect-ports',
	'new-view',
	'budget',
	'rollup',
	'limit',
	'trade',
	'state-machine',
	'action-flow',
	'report',
	'import-requirements',
	'requirements',
	'problems',
	'save-github',
	'download',
	'install',
	'switch-project',
	'new-project',
	'palette',
	'settings',
	'help'
] as const;

export type GuideAction = (typeof GUIDE_ACTIONS)[number];

export function isGuideAction(id: string): id is GuideAction {
	return (GUIDE_ACTIONS as readonly string[]).includes(id);
}

export interface GuideContext {
	ui: WorkbenchUi;
	workspace: Workspace;
	engine?: Engine;
	session?: ProjectSession;
}

const own = (workspace: Workspace) => workspace.elements.filter((e) => !isLibraryFile(e.file));

/** The package an element is in (its nearest package, by its owner's name). */
function packageOf(workspace: Workspace, element: ModelElement): ModelElement | undefined {
	let current: ModelElement | undefined = element;
	for (let depth = 0; current && depth < 12; depth++) {
		if (current.kind === 'package') return current;
		const parent: string | null = current.parent;
		const file: string = current.file;
		current = parent
			? workspace.elements.find((e) => e.file === file && e.name === parent)
			: undefined;
	}
	return own(workspace).find((e) => e.kind === 'package' && e.file === element.file);
}

/** The top part of the design: a part at package level, the one with the most inside first. */
export function topPart(workspace: Workspace): ModelElement | undefined {
	const elements = own(workspace);
	const packages = new Set(elements.filter((e) => e.kind === 'package').map((e) => e.name));
	const tops = elements.filter(
		(e) => e.kind === 'part' && !e.isDefinition && (!e.parent || packages.has(e.parent))
	);
	const inside = (p: ModelElement) =>
		elements.filter((e) => e.parent === p.name && e.file === p.file).length;
	return [...tops].sort((a, b) => inside(b) - inside(a))[0];
}

/** Where a new part goes: the definition of the top part (`System`), else a package. */
function partOwner(workspace: Workspace): ModelElement | undefined {
	const top = topPart(workspace);
	const typeName = top?.typeRef?.split('::').pop();
	const def = own(workspace).find(
		(e) => e.isDefinition && e.kind === 'part' && e.name === typeName
	);
	if (def && canOwnMembers(def.kind, def.isDefinition)) return def;
	return (top && packageOf(workspace, top)) ?? own(workspace).find((e) => e.kind === 'package');
}

/** Where a new requirement goes: beside the first one, else the first package. */
function requirementOwner(workspace: Workspace): ModelElement | undefined {
	const first = own(workspace).find((e) => e.kind === 'requirement' && !e.isDefinition);
	return (first && packageOf(workspace, first)) ?? own(workspace).find((e) => e.kind === 'package');
}

function openAdd(ui: WorkbenchUi, kind: AddKind, owner: ModelElement | undefined) {
	ui.addKind = kind;
	ui.addOwner = owner?.key ?? null;
	ui.addSheet = true;
}

/** A saved view of a kind (`TraceMatrix`), if the project has one. */
function savedView(workspace: Workspace, definition: string) {
	return workspace.views.find(
		(v) =>
			v.isUsage &&
			!v.builtin &&
			!isLibraryFile(v.file) &&
			(v.definition ?? '').split('::').pop() === definition
	);
}

/** Add up a value of the top part: its mass, or the first number it has. */
async function rollup({ ui, workspace, engine }: GuideContext) {
	const top = topPart(workspace);
	if (top?.id && engine) {
		const features = (await engine.elementFeatures(workspace.sourceFiles(), [top.id]))[top.id];
		const numbers = features?.features.filter((f) => f.kind === 'attribute' && f.numeric) ?? [];
		const attribute = numbers.find((f) => f.name === 'mass') ?? numbers[0];
		if (attribute) {
			ui.create = { kind: 'rollup', element: top.key, attribute: attribute.name };
			return;
		}
	}
	if (top) {
		ui.select(top.key, 'explorer');
		ui.inspectorOpen = true;
	}
	toasts.show(
		'Give a part a number first (an attribute such as mass), then choose Add up next to it.'
	);
}

export async function runGuideAction(action: GuideAction, context: GuideContext): Promise<void> {
	const { ui, workspace, session } = context;
	ui.helpOpen = false;
	switch (action) {
		case 'add-requirement':
			openAdd(ui, 'requirement', requirementOwner(workspace));
			return;
		case 'add-part':
			openAdd(ui, 'part', partOwner(workspace));
			return;
		case 'link': {
			// The requirement's details, where "Add what satisfies it" picks the part.
			const rows = workspace.requirements;
			const gap = rows.find((r) => r.satisfiedBy.length === 0) ?? rows[0];
			const requirement = gap && workspace.elements.find((e) => e.key === gap.key);
			if (!requirement) {
				toasts.show('Add a requirement first, then say which part meets it.');
				return;
			}
			ui.select(requirement.key, 'explorer');
			if (ui.phone) ui.showDetails('full');
			else ui.inspectorOpen = true;
			toasts.show('Under “Satisfied by”, choose Add what satisfies it, and pick the part.');
			return;
		}
		case 'connect-ports': {
			const top = topPart(workspace);
			ui.create = { kind: 'view', viewKind: 'interconnection', target: top?.key };
			return;
		}
		case 'new-view':
			ui.create = { kind: 'view' };
			return;
		case 'budget':
			ui.create = { kind: 'view', viewKind: 'budget', target: topPart(workspace)?.key };
			return;
		case 'state-machine':
		case 'action-flow': {
			// With nothing to draw yet, start by adding a state or action definition.
			const kind = action === 'state-machine' ? 'state' : 'action';
			const any = own(workspace).some((e) => e.kind === kind && e.isDefinition);
			if (any) ui.create = { kind: 'view', viewKind: kind === 'state' ? 'states' : 'actions' };
			else {
				openAdd(
					ui,
					`${kind} def`,
					own(workspace).find((e) => e.kind === 'package')
				);
				toasts.show(
					kind === 'state'
						? 'Name the state machine, then right-click it in a diagram to draw its states.'
						: 'Name the process, then right-click it in a diagram to draw its steps.'
				);
			}
			return;
		}
		case 'report':
			ui.create = { kind: 'view', viewKind: 'specification' };
			return;
		case 'rollup':
			await rollup(context);
			return;
		case 'limit': {
			const first = own(workspace).find((e) => e.kind === 'requirement' && !e.isDefinition);
			if (first) ui.create = { kind: 'limit', element: first.key };
			else toasts.show('Add a requirement first; a limit is written into one.');
			return;
		}
		case 'trade':
			ui.create = { kind: 'trade' };
			return;
		case 'import-requirements':
			ui.importOpen = true;
			return;
		case 'requirements': {
			const table = savedView(workspace, 'RequirementsTable');
			ui.open(
				table
					? { kind: 'view', name: table.name, title: viewTitle(table.name) }
					: { kind: 'requirements' }
			);
			return;
		}
		case 'problems':
			ui.problemsOpen = true;
			ui.mobilePane = 'problems';
			return;
		case 'save-github':
			ui.sourceControlOpen = true;
			return;
		case 'download':
			if (session) {
				try {
					await session.exportKpar();
				} catch (error) {
					toasts.show(error instanceof Error ? error.message : String(error), { tone: 'error' });
				}
			}
			return;
		case 'install':
			pwa.offerInstall();
			return;
		case 'switch-project':
		case 'new-project':
			if (!(await leaving.confirm('switch'))) return;
			location.assign(resolve(action === 'new-project' ? '/projects?new' : '/projects'));
			return;
		case 'palette':
			ui.paletteOpen = true;
			return;
		case 'settings':
			ui.settingsOpen = true;
			return;
		case 'help':
			ui.showHelp();
			return;
	}
}
