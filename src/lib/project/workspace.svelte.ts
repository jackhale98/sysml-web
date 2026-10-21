/**
 * The open project: its files, the engine's analysis of each, and the
 * plain-language views derived from them.
 */
import type { Engine } from '#lib/engine/client.ts';
import type { Analysis, Diagnostic } from '#lib/engine/types.ts';
import { collectRequirements, type RequirementRow } from './requirements';

export interface ProjectFile {
	/** Path relative to the project root, forward slashes. */
	path: string;
	text: string;
}

/** `.project.json` (KerML 10.3 InterchangeProject); only what the UI shows. */
export interface ProjectInfo {
	name: string;
	description?: string;
	version?: string;
}

export interface ProjectSource {
	id: string;
	info: ProjectInfo;
	files: ProjectFile[];
}

export type LoadState =
	| { phase: 'idle' }
	| { phase: 'loading'; done: number; total: number }
	| { phase: 'ready'; millis: number }
	| { phase: 'error'; message: string };

export interface Coverage {
	total: number;
	satisfied: number;
	verified: number;
}

/** Files the engine analyses. */
export function isModelFile(path: string): boolean {
	return path.endsWith('.sysml') || path.endsWith('.kerml');
}

export class Workspace {
	source = $state.raw<ProjectSource | null>(null);
	analyses = $state.raw<Record<string, Analysis>>({});
	state = $state.raw<LoadState>({ phase: 'idle' });
	engineVersion = $state<string | null>(null);

	requirements: RequirementRow[] = $derived(collectRequirements(Object.values(this.analyses)));

	coverage: Coverage = $derived({
		total: this.requirements.length,
		satisfied: this.requirements.filter((r) => r.satisfiedBy.length > 0).length,
		verified: this.requirements.filter((r) => r.verifiedBy.length > 0).length
	});

	/** Syntax errors and checks, errors first. */
	problems: Diagnostic[] = $derived(
		Object.values(this.analyses)
			.flatMap((a) => [
				...a.model.syntax_errors.map((e): Diagnostic => ({
					file: a.model.file,
					span: e.span,
					severity: 'error',
					code: 'syntax',
					message: e.message
				})),
				...a.diagnostics
			])
			.sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
	);

	modelFiles: ProjectFile[] = $derived(
		(this.source?.files ?? []).filter((f) => isModelFile(f.path))
	);

	file(path: string): ProjectFile | undefined {
		return this.source?.files.find((f) => f.path === path);
	}

	async open(source: ProjectSource, engine: Engine) {
		this.source = source;
		this.analyses = {};
		const files = source.files.filter((f) => isModelFile(f.path));
		this.state = { phase: 'loading', done: 0, total: files.length };
		const started = performance.now();
		try {
			this.engineVersion = await engine.version();
			const analyses: Record<string, Analysis> = {};
			for (const [index, file] of files.entries()) {
				analyses[file.path] = await engine.analyze(file.path, file.text);
				this.state = { phase: 'loading', done: index + 1, total: files.length };
			}
			if (this.source !== source) return; // another project was opened meanwhile
			this.analyses = analyses;
			this.state = { phase: 'ready', millis: performance.now() - started };
		} catch (error) {
			this.state = { phase: 'error', message: String(error) };
		}
	}
}

function severityRank(severity: Diagnostic['severity']): number {
	return severity === 'error' ? 0 : severity === 'warning' ? 1 : 2;
}
