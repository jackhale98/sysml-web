/**
 * The starting points offered when making a project. Only these few lines
 * load with the projects page; a template's files load when it is chosen.
 */
import type { ProjectFile, ProjectInfo } from '../workspace.svelte.ts';

export type TemplateId = 'blank' | 'requirements' | 'flashlight';

export interface TemplateInfo {
	id: TemplateId;
	title: string;
	/** One line, in plain words. */
	summary: string;
}

export const TEMPLATES: readonly TemplateInfo[] = [
	{
		id: 'blank',
		title: 'Blank',
		summary: 'A first requirement, the system part and three views. Build it your way.'
	},
	{
		id: 'requirements',
		title: 'Requirements first',
		summary: 'For moving a requirements spreadsheet: the usual columns, a trace and a report.'
	},
	{
		id: 'flashlight',
		title: 'Small system',
		summary: 'A flashlight: parts, a wire between them, a mass budget and its on/off states.'
	}
];

export interface Template {
	/** The project as the template makes it, named and described by the person. */
	make(
		name: string,
		description: string,
		viewLibraries: ProjectFile[]
	): { info: ProjectInfo; files: ProjectFile[] };
}

/** A template's files, loaded on demand. */
export async function loadTemplate(id: TemplateId): Promise<Template> {
	switch (id) {
		case 'requirements':
			return { make: (await import('./requirements.ts')).requirementsProject };
		case 'flashlight':
			return { make: (await import('./flashlight.ts')).flashlightProject };
		default:
			return { make: (await import('./blank.ts')).starterProject };
	}
}

export function isTemplateId(id: string | null | undefined): id is TemplateId {
	return TEMPLATES.some((t) => t.id === id);
}
