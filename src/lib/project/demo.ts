import type { ProjectInfo, ProjectSource } from './workspace.svelte';

const files = import.meta.glob<string>('/src/demo/drone/**/*.{sysml,kerml}', {
	query: '?raw',
	import: 'default',
	eager: true
});
const project = import.meta.glob<string>('/src/demo/drone/.project.json', {
	query: '?raw',
	import: 'default',
	eager: true
});

const ROOT = '/src/demo/drone/';

/** The bundled drone project shown by "Try the demo". */
export function demoProject(): ProjectSource {
	const info = Object.values(project)[0];
	return {
		id: 'demo',
		info: info ? (JSON.parse(info) as ProjectInfo) : { name: 'Drone UAV' },
		files: Object.entries(files)
			.map(([path, text]) => ({ path: path.slice(ROOT.length), text }))
			.sort((a, b) => a.path.localeCompare(b.path))
	};
}
