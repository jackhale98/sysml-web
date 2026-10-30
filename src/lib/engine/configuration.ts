/**
 * Showing a product configuration (`toolkit/variability.ts`): the page adds
 * this pseudo-file, holding the configuration's qualified name, to the files
 * it sends with a call. The engine then answers the call (a table, the
 * checks, a diagram) for the model with that configuration's choices made,
 * worked out apart from the analysed model, which stays as written.
 */
import type { SourceFile } from './protocol';

export const CONFIGURATION_FILE = '.tessera/configuration';

/** The files with a configuration to show, or as they are when none is chosen. */
export function withConfiguration(files: SourceFile[], configuration: string | null): SourceFile[] {
	return configuration ? [...files, { path: CONFIGURATION_FILE, text: configuration }] : files;
}

/** The files without the pseudo-file, and the configuration it names (null when none). */
export function splitConfiguration(files: SourceFile[]): {
	files: SourceFile[];
	configuration: string | null;
} {
	const at = files.findIndex((f) => f.path === CONFIGURATION_FILE);
	if (at < 0) return { files, configuration: null };
	return { files: files.filter((_, i) => i !== at), configuration: files[at]!.text.trim() || null };
}
