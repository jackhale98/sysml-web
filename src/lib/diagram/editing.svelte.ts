/**
 * What nodes need from the canvas while it is being edited: which node is
 * being renamed in place, and the gestures a node can start. Shared through
 * Svelte context so node data stays plain.
 */
import { getContext, setContext } from 'svelte';

const KEY = Symbol('diagram-editing');

export interface EditingActions {
	/** Save a new name; resolves to an error message or null. */
	rename(id: string, name: string): Promise<string | null>;
	/** Open the node's actions (context menu) at a client point, or by the node. */
	menu(id: string, point?: { x: number; y: number }): void;
}

export class DiagramEditing {
	/** Node id with its name field open. */
	renaming = $state<string | null>(null);
	/** Shown under the name field when saving failed. */
	renameError = $state<string | null>(null);
	/** Node the next tap or pick will connect from. */
	connectingFrom = $state<string | null>(null);
	/** A connection is being dragged. */
	dragging = $state(false);
	/** The selected node, whose connections are highlighted. */
	focus = $state<string | null>(null);
	/** The nodes it connects to (replaced whole, never mutated). */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	linked = $state.raw<ReadonlySet<string>>(new Set());

	constructor(readonly actions: EditingActions) {}

	startRename(id: string) {
		this.renameError = null;
		this.renaming = id;
	}

	cancelRename() {
		this.renaming = null;
		this.renameError = null;
	}

	async commitRename(id: string, name: string): Promise<boolean> {
		const error = await this.actions.rename(id, name);
		if (error) {
			this.renameError = error;
			return false;
		}
		if (this.renaming === id) this.renaming = null;
		return true;
	}
}

export function provideEditing(editing: DiagramEditing): DiagramEditing {
	return setContext(KEY, editing);
}

export function useEditing(): DiagramEditing | undefined {
	return getContext<DiagramEditing | undefined>(KEY);
}
