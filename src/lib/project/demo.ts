import type { ProjectInfo, ProjectSource } from './workspace.svelte';
// Imported directly: glob patterns skip dot-files such as `.project.json`.
import projectJson from '/src/demo/drone/.project.json?raw';

const files = import.meta.glob<string>('/src/demo/drone/**/*.{sysml,kerml,md}', {
	query: '?raw',
	import: 'default',
	eager: true
});

const ROOT = '/src/demo/drone/';

/** The bundled drone project shown by "Try the demo". */
export function demoProject(): ProjectSource {
	return {
		id: 'demo',
		info: JSON.parse(projectJson) as ProjectInfo,
		files: Object.entries(files)
			.map(([path, text]) => ({ path: path.slice(ROOT.length), text }))
			.sort((a, b) => a.path.localeCompare(b.path))
	};
}
