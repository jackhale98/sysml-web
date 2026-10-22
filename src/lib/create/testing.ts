/**
 * For tests: a workspace on the real toolkit (in Node), so a form's plan is
 * applied exactly as the app applies it — edits by the engine, one undoable
 * step — and the result analysed, evaluated and checked.
 */
import type { Engine } from '#lib/engine/client.ts';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import { Workspace, type ProjectFile } from '#lib/project/workspace.svelte.ts';

/** The host as the app's asynchronous engine. */
export function hostEngine(host: ToolkitHost): Engine {
	return new Proxy({} as Engine, {
		get(_, method: string) {
			if (method === 'terminate') return () => {};
			if (method === 'then') return undefined;
			const fn = (host as unknown as Record<string, (...args: unknown[]) => unknown>)[method];
			if (typeof fn !== 'function') throw new Error(`The host has no ${method}`);
			return async (...args: unknown[]) => fn.apply(host, args);
		}
	});
}

/** A workspace with the files open and analysed. */
export async function openWorkspace(host: ToolkitHost, files: ProjectFile[]): Promise<Workspace> {
	const workspace = new Workspace();
	await workspace.open({ id: 'test', info: { name: 'Rover' }, files }, hostEngine(host));
	return workspace;
}

/** Run a change, then wait for the analysis (and checks) of the texts it leaves. */
export async function analysed<T>(workspace: Workspace, change: () => Promise<T> | T): Promise<T> {
	const before = workspace.checks;
	const result = await change();
	for (let i = 0; i < 200 && workspace.checks === before; i++)
		await new Promise((r) => setTimeout(r, 25));
	return result;
}

/** Problems of the model (syntax errors and diagnostics), as `file:line message`. */
export function problemsOf(workspace: Workspace): string[] {
	return workspace.problems
		.filter((p) => p.code !== 'check')
		.map((p) => `${p.file}:${p.span.start_row} ${p.message}`);
}
