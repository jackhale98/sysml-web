/**
 * Analyses sent to the page only when they changed. An edit changes the
 * analysis of the file edited (element ids are stable across sessions), so
 * after a keystroke in a 600-file project one analysis crosses to the page
 * instead of all of them: the page's structured clone of the results is the
 * main thread's work, and unchanged results keep their identity there
 * (`collectElements` reuses what it built from them).
 *
 * The worker's `AnalysisSender` replaces an analysis the page already has
 * (the same JSON as last sent for that file) with `null`; the page's
 * `AnalysisReceiver` puts back the one it holds. A restarted worker has sent
 * nothing yet, so it sends everything.
 */
import type { SourceFile } from '../protocol';
import type { Analysis } from '../types';

export class AnalysisSender {
	private readonly sent = new Map<string, string>();

	send(files: SourceFile[], analyses: Analysis[]): (Analysis | null)[] {
		const paths = new Set(files.map((f) => f.path));
		for (const path of this.sent.keys()) if (!paths.has(path)) this.sent.delete(path);
		return analyses.map((analysis, i) => {
			const path = files[i]!.path;
			const json = JSON.stringify(analysis);
			if (this.sent.get(path) === json) return null;
			this.sent.set(path, json);
			return analysis;
		});
	}
}

export class AnalysisReceiver {
	private readonly held = new Map<string, Analysis>();

	receive(files: SourceFile[], results: (Analysis | null)[]): Analysis[] {
		return results.map((result, i) => {
			const path = files[i]!.path;
			if (result) {
				this.held.set(path, result);
				return result;
			}
			const held = this.held.get(path);
			if (!held) throw new Error(`the engine sent no analysis of ${path}`);
			return held;
		});
	}
}
