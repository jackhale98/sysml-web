/**
 * Save a standard report into the project as a view of its own, so its
 * scope and title can be changed like any SysML: the report defs go into
 * the project's `ModelViews` when it has none yet, and a `view` typed by
 * the def goes next to the project's other saved views.
 */
import type { Engine } from '#lib/engine/client.ts';
import type { ModelElement } from '#lib/project/elements.ts';
import { isLibraryFile, type Workspace } from '#lib/project/workspace.svelte.ts';
import modelViews from '/src/demo/drone/libraries/ModelViews.sysml?raw';
import type { ReportContext } from './context.ts';
import { diagramScope, icdModel } from './icd.ts';
import type { ModelIndex } from './model.ts';
import { requirementsInScope } from './specification.ts';

/** The report section of the bundled `ModelViews` library, to copy into a project. */
export function reportLibrary(source = modelViews): string {
	const start = source.indexOf('    // --- Reports');
	const end = source.lastIndexOf('}');
	return start >= 0 && end > start ? source.slice(start, end).trimEnd() + '\n' : '';
}

/** The qualified name of an element as written (`A::'b c'`). */
export function qualifiedName(index: ModelIndex, element: ModelElement): string {
	const names: string[] = [];
	for (let e: ModelElement | undefined = element; e; e = index.owner.get(e.key))
		names.unshift(e.name);
	return names.join('::');
}

/** What a saved copy of a standard report should expose, from what it shows now. */
export function defaultExposes(ctx: ReportContext): string[] {
	const out = new Set<string>();
	if (ctx.kind === 'specification') {
		for (const tr of requirementsInScope(ctx))
			if (tr.package) out.add(`${qualifiedName(ctx.index, tr.package)}::*`);
	} else if (ctx.kind === 'icd') {
		const scope = diagramScope(ctx);
		if (scope) out.add(`${qualifiedName(ctx.index, scope)}::*`);
		const model = icdModel(ctx);
		for (const e of [
			...model.interfaces.map((i) => i.element),
			...model.portDefinitions.map((p) => p.element)
		]) {
			const owner = ctx.index.owner.get(e.key);
			if (owner?.kind === 'package') out.add(`${qualifiedName(ctx.index, owner)}::*`);
		}
	}
	return [...out];
}

function uniqueName(workspace: Workspace, base: string): string {
	const taken = new Set(workspace.elements.map((e) => e.name));
	if (!taken.has(base)) return base;
	for (let i = 2; ; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`;
}

export function reportViewText(
	name: string,
	definition: string,
	doc: string,
	exposes: string[]
): string {
	const lines = [
		`view ${name} : ModelViews::${definition} {`,
		`    doc /* ${doc.replace(/\*\//g, '* /')} */`,
		...exposes.map((e) => `    expose ${e};`),
		'}'
	];
	return lines.join('\n');
}

/**
 * Add the report to the model. Returns the new view's name, or an error
 * message.
 */
export async function saveReport(
	workspace: Workspace,
	engine: Engine,
	ctx: ReportContext,
	definition: string
): Promise<{ name: string } | { error: string }> {
	let created = '';
	const error = await workspace.transact(
		`Saved the ${ctx.kindLabel.toLowerCase()} as a view`,
		async () => {
			// 1. The report defs, in the project's ModelViews.
			if (!workspace.views.some((v) => !v.isUsage && v.name === definition)) {
				let library = workspace.paths.find((p) => p.endsWith('ModelViews.sysml'));
				if (!library) {
					const bundled = await engine.viewLibraries();
					for (const file of bundled)
						if (workspace.text(file.path) === undefined) workspace.setText(file.path, file.text);
					library = bundled.find((f) => f.path.endsWith('ModelViews.sysml'))?.path;
				}
				const source = library ? workspace.text(library) : undefined;
				if (!library || source === undefined)
					return 'The project has no ModelViews library to add the report to.';
				const failed = await workspace.edit(library, {
					op: 'insertMember',
					path: library,
					source,
					parent: 'ModelViews',
					text: reportLibrary()
				});
				if (failed) return failed;
			}
			// 2. The view, next to the project's other saved views.
			const saved = workspace.views.find((v) => v.isUsage && !v.builtin && !isLibraryFile(v.file));
			const name = uniqueName(
				workspace,
				ctx.kind === 'icd' ? 'interfaceControlDocument' : 'systemSpecification'
			);
			const text = reportViewText(name, definition, ctx.kindLabel, defaultExposes(ctx));
			const file = saved?.file;
			const owner = file
				? workspace.tree.find((n) => n.element.file === file && n.element.kind === 'package')
						?.element
				: undefined;
			if (file && owner) {
				const source = workspace.text(file) ?? '';
				const failed = await workspace.edit(file, {
					op: 'insertMember',
					path: file,
					source,
					parent: owner.name,
					text
				});
				if (failed) return failed;
			} else {
				const path =
					workspace.text('views/Reports.sysml') === undefined
						? 'views/Reports.sysml'
						: `views/Reports${Date.now()}.sysml`;
				const indented = text.replace(/^/gm, '    ');
				workspace.setText(
					path,
					`package Reports {\n    doc /* Saved reports. */\n\n${indented}\n}\n`
				);
			}
			created = name;
			return null;
		}
	);
	return error ? { error } : { name: created };
}
