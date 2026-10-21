/**
 * The view libraries every project has: `Reporting` (the `@TableRendering`
 * convention and a few domain-neutral tables) and `ModelViews` (the standard
 * tables and reports). They are the demo's copies; a project that doesn't
 * declare one of the packages gets it added to its session as resolution
 * context, so `view x : ModelViews::RequirementsTable` works anywhere. Their
 * views are listed as `builtin`, and they never produce rows.
 */
import type { SourceFile } from '../../protocol';
import modelViews from '/src/demo/drone/libraries/ModelViews.sysml?raw';
import reporting from '/src/demo/drone/libraries/Reporting.sysml?raw';

export const VIEW_LIBRARIES: readonly (SourceFile & { package: string })[] = [
	{ path: 'libraries/Reporting.sysml', package: 'Reporting', text: reporting },
	{ path: 'libraries/ModelViews.sysml', package: 'ModelViews', text: modelViews }
];

/** The bundled libraries as files (for "add to the project" and new projects). */
export function viewLibraries(): SourceFile[] {
	return VIEW_LIBRARIES.map(({ path, text }) => ({ path, text }));
}

/** The bundled libraries whose package the project doesn't declare (and whose path is free). */
export function missingViewLibraries(files: readonly SourceFile[]): SourceFile[] {
	return VIEW_LIBRARIES.filter(
		(lib) =>
			!files.some((f) => f.path === lib.path) &&
			!files.some((f) => declaresPackage(f.text, lib.package))
	).map(({ path, text }) => ({ path, text }));
}

function declaresPackage(text: string, name: string): boolean {
	return new RegExp(`(^|[\\s;{}])package\\s+(${name}|'${name}')(?![\\w'])`).test(text);
}
