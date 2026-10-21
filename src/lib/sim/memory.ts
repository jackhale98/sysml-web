/**
 * Emulator runs outlive their tab: switching to the text to edit the model
 * unmounts the emulator, and coming back should resume where it was.
 */
import type { History } from './model.ts';

export interface SavedRun {
	history: History;
	/** `structureKey` of the machine when the run started. */
	startedKey: string | null;
	pending: Record<string, unknown>;
	speed: number;
}

const LIMIT = 12;
const runs = new Map<string, SavedRun>();

export function remember(key: string, run: SavedRun) {
	runs.delete(key);
	runs.set(key, run);
	while (runs.size > LIMIT) runs.delete(runs.keys().next().value!);
}

export function recall(key: string): SavedRun | undefined {
	return runs.get(key);
}

export function forget(key: string) {
	runs.delete(key);
}
