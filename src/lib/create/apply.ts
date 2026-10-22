/**
 * Writing what a form made into the project, as one undoable step with a
 * toast ("Created …", with Undo), through the workbench's edit actions
 * (`applySteps`): new files, the imports a package needs (a text patch
 * after its last import), changed declarations and new members (placed by
 * the engine).
 */
import type { Engine } from '#lib/engine/client.ts';
import type { DeclarationSet } from '#lib/engine/types.ts';
import type { ModelElement } from '#lib/project/elements.ts';
import { packageName } from '#lib/project/sources.ts';
import { isLibraryFile, type Workspace } from '#lib/project/workspace.svelte.ts';
import { applySteps, type WriteStep } from '#lib/workbench/actions.ts';
import { enclosingPackage, qualifiedName } from './model';
import { References, docComment, uniqueName, withImports } from './sysml';

export interface Write {
	/** New files: the path asked for (made unique) and the text. */
	files?: { path: string; text: string }[];
	/** Imports a package needs (qualified targets). */
	imports?: { pkg: ModelElement; targets: string[] }[];
	/** Declarations to change (an attribute's value). */
	declarations?: { element: ModelElement; set: DeclarationSet }[];
	/** Members to add to a package or an element. */
	members?: { parent: ModelElement; text: string }[];
}

/** The steps of a write, in the order they can be applied: files, imports, declarations, members. */
export function stepsOf(workspace: Workspace, write: Write): WriteStep[] | string {
	const steps: WriteStep[] = [];
	for (const f of write.files ?? []) steps.push({ kind: 'file', path: f.path, text: f.text });
	// One patch per file, with every package's imports in it.
	const byFile = new Map<string, { pkg: ModelElement; targets: string[] }[]>();
	for (const i of write.imports ?? []) {
		if (!i.targets.length) continue;
		const list = byFile.get(i.pkg.file) ?? [];
		list.push(i);
		byFile.set(i.pkg.file, list);
	}
	for (const [path, list] of byFile) {
		const before = workspace.text(path);
		if (before === undefined) return `${path} is not in the project.`;
		let after = before;
		// From the last package in the file to the first, so earlier offsets stay right.
		for (const { pkg, targets } of list.toSorted(
			(a, b) => (b.pkg.span.from ?? 0) - (a.pkg.span.from ?? 0)
		)) {
			const from = pkg.span.from;
			const to = pkg.span.to;
			if (from === undefined || to === undefined) continue;
			after = withImports(after, { qualifiedName: pkg.name, from, to }, targets);
		}
		if (after !== before) steps.push({ kind: 'patch', path, before, after });
	}
	for (const d of write.declarations ?? [])
		steps.push({ kind: 'declaration', path: d.element.file, element: d.element, set: d.set });
	for (const m of write.members ?? [])
		steps.push({ kind: 'member', path: m.parent.file, parent: m.parent, text: m.text });
	return steps;
}

/** Apply a write as one undoable change, confirmed by a toast with Undo. */
export async function write(workspace: Workspace, label: string, w: Write): Promise<string | null> {
	const steps = stepsOf(workspace, w);
	if (typeof steps === 'string') return steps;
	return applySteps(workspace, label, steps);
}

/** A path not in the project yet: `views/Views.sysml`, else `views/Views2.sysml`, … */
export function freePath(workspace: Workspace, path: string): string {
	if (workspace.text(path) === undefined) return path;
	const dot = path.lastIndexOf('.');
	for (let i = 2; ; i++) {
		const candidate = `${path.slice(0, dot)}${i}${path.slice(dot)}`;
		if (workspace.text(candidate) === undefined) return candidate;
	}
}

/** Every name the project's elements use (to keep new top-level names unique). */
export function takenNames(workspace: Workspace): Set<string> {
	return new Set(workspace.elements.map((e) => e.name));
}

// --- Views -------------------------------------------------------------------

/** The package the project keeps its saved views in, if it has one. */
export function viewsPackage(workspace: Workspace): ModelElement | null {
	const saved = workspace.views.find((v) => v.isUsage && !v.builtin && !isLibraryFile(v.file));
	if (!saved) return null;
	const view = workspace.elements.find(
		(e) => e.file === saved.file && e.kind === 'view' && e.name === saved.name
	);
	if (view) return enclosingPackage(workspace.tree, view.key);
	return (
		workspace.tree.find((n) => n.element.file === saved.file && n.element.kind === 'package')
			?.element ?? null
	);
}

/** The view libraries' files the project lacks (`Reporting`, `ModelViews`), to copy in. */
export async function missingLibraries(
	workspace: Workspace,
	engine: Engine
): Promise<{ path: string; text: string }[]> {
	const has = (name: string) =>
		workspace.elements.some((e) => e.kind === 'package' && e.name === name && !e.isDefinition);
	if (has('ModelViews') && has('Reporting')) return [];
	const bundled = await engine.viewLibraries();
	return bundled.filter(
		(f) =>
			workspace.text(f.path) === undefined &&
			!has(
				f.path
					.split('/')
					.pop()!
					.replace(/\.sysml$/, '')
			)
	);
}

/**
 * Where a new view goes, and how its text refers to the view defs: the
 * project's views package (with the imports the text needs), or a new
 * `views/Views.sysml` with one.
 */
export function viewWrite(
	workspace: Workspace,
	views: (spell: (qualified: string) => string) => string[]
): Write {
	const pkg = viewsPackage(workspace);
	const pkgName = pkg
		? qualifiedName(workspace.tree, pkg.key)
		: `${packageName(workspace.info?.name ?? 'Model').replace(/'/g, '')}Views`;
	const refs = new References(pkgName);
	const spell = (q: string) => {
		const at = q.lastIndexOf('::');
		const owner = q.slice(0, at);
		// The view libraries' defs come in with their package, as the starter project imports them.
		if (owner === 'ModelViews' || owner === 'StandardViewDefinitions') {
			refs.library(`${owner}::*`);
			return q.slice(at + 2);
		}
		return refs.name(q);
	};
	const texts = views(spell);
	if (pkg)
		return {
			imports: [{ pkg, targets: refs.imports }],
			members: texts.map((text) => ({ parent: pkg, text: `\n${text}` }))
		};
	const name = uniqueName(
		pkgName,
		workspace.elements.filter((e) => e.kind === 'package').map((e) => e.name)
	);
	const body = [
		`    ${docComment('Saved views: tables and diagrams that are part of the model.')}`,
		'',
		...refs.imports.map((i) => `    private import ${i};`),
		'',
		...texts.flatMap((t) => [t.replace(/^/gm, '    '), ''])
	];
	return {
		files: [
			{
				path: freePath(workspace, 'views/Views.sysml'),
				text: `package ${name} {\n${body.join('\n').replace(/\n+$/, '')}\n}\n`
			}
		]
	};
}

/** Wait until the analysis has the view (to open it as what it is: a table or a diagram). */
export async function viewReady(
	workspace: Workspace,
	name: string,
	timeout = 8000
): Promise<boolean> {
	const started = Date.now();
	while (Date.now() - started < timeout) {
		if (workspace.views.some((v) => v.name === name && v.isUsage)) return true;
		await new Promise((r) => setTimeout(r, 80));
	}
	return false;
}

/**
 * Open a new view once the analysis has it. Called before the form closes:
 * the workspace and the UI are taken now, while the form still has them.
 */
export function openView(
	workspace: Workspace,
	ui: { open(tab: { kind: 'view'; name: string; title: string }): void },
	view: { name: string; title: string }
): Promise<void> {
	return viewReady(workspace, view.name).then(() =>
		ui.open({ kind: 'view', name: view.name, title: view.title })
	);
}

/** Combine writes into one. */
export function merge(...writes: Write[]): Write {
	return {
		files: writes.flatMap((w) => w.files ?? []),
		imports: writes.flatMap((w) => w.imports ?? []),
		declarations: writes.flatMap((w) => w.declarations ?? []),
		members: writes.flatMap((w) => w.members ?? [])
	};
}
