import { getContext, setContext } from 'svelte';
import type { Workspace } from './workspace.svelte';

const KEY = Symbol('workspace');

export function provideWorkspace(workspace: Workspace): Workspace {
	return setContext(KEY, workspace);
}

/** The project open in the surrounding /p/[project] layout. */
export function useWorkspace(): Workspace {
	return getContext<Workspace>(KEY);
}
