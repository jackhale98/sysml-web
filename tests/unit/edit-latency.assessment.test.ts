/**
 * Assessment (§2, "responsive when editing large models"): how long the
 * app's model edits take on a generated project of about 10k lines
 * (`tests/perf/generate.ts`), through a `Workspace` on the real engine as
 * the app makes them: the engine's edit (`edit`), then the re-analysis of
 * the edited text until the model is settled again (`settled`, which also
 * includes the workspace's short typing delay). Each edit is undone after
 * and the text checked to be exactly as before.
 *
 * Budgets are generous guardrails (shared machines are slow and noisy);
 * the measured numbers are written to `$ASSESS_OUT` when it is set.
 */
import { writeFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { analysed, openWorkspace } from '#lib/create/testing.ts';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import { loadHost } from '#lib/engine/toolkit/testing.ts';
import type { ModelElement } from '#lib/project/elements.ts';
import type { Workspace } from '#lib/project/workspace.svelte.ts';
import {
	addElement,
	deleteElement,
	duplicateElement,
	renameElement
} from '#lib/workbench/actions.ts';
import { generateLines, lineCount } from '../perf/generate';

const BUDGET = { edit: 10_000, settled: 60_000 };

const files = generateLines(10_000);
let host: ToolkitHost;
let ws: Workspace;
let openMs: number;
const results: Record<string, { editMs: number[]; settledMs: number[]; filesChanged: number }> = {};
const RUNS = 3;

beforeAll(async () => {
	host = await loadHost();
	const started = performance.now();
	ws = await openWorkspace(host, files);
	openMs = performance.now() - started;
}, 180_000);

const find = (label: string, parent?: string): ModelElement => {
	const e = ws.elements.find(
		(x) => x.label === label && (parent === undefined || x.parent === parent)
	);
	if (!e) throw new Error(`no ${label}`);
	return e;
};

/**
 * Time one edit, `RUNS` times: until the engine's change is applied, then
 * until the analysis has caught up; each run is undone (and checked) before the next.
 */
async function measure(name: string, run: () => Promise<string | null>) {
	const entry = (results[name] = {
		editMs: [] as number[],
		settledMs: [] as number[],
		filesChanged: 0
	});
	for (let r = 0; r < RUNS; r++) {
		const before = { ...ws.files };
		const started = performance.now();
		let editMs = 0;
		const error = await analysed(ws, async () => {
			const result = await run();
			editMs = performance.now() - started;
			return result;
		});
		for (let i = 0; i < 2400 && !ws.settled; i++) await new Promise((r) => setTimeout(r, 25));
		const settledMs = performance.now() - started;
		expect(error, name).toBeNull();
		expect(ws.settled).toBe(true);
		entry.filesChanged = Object.keys(ws.files).filter((p) => ws.files[p] !== before[p]).length;
		entry.editMs.push(Math.round(editMs));
		entry.settledMs.push(Math.round(settledMs));
		expect(editMs, `${name}: edit`).toBeLessThan(BUDGET.edit);
		expect(settledMs, `${name}: settled`).toBeLessThan(BUDGET.settled);
		ws.undo();
		expect(ws.files).toEqual(before);
		await analysed(ws, async () => null);
		for (let i = 0; i < 2400 && !ws.settled; i++) await new Promise((r) => setTimeout(r, 25));
	}
}

describe('editing a generated project of about 10k lines', { timeout: 300_000 }, () => {
	it('opens it', () => {
		expect(lineCount(files)).toBeGreaterThan(9_000);
		expect(ws.elements.length).toBeGreaterThan(3_000);
	});

	it('adds a part', async () => {
		await measure('add a part', () =>
			addElement(ws, find('S000System'), 'part', 'spare', 'S000Component')
		);
	});

	it('renames a definition used across files', async () => {
		await measure('rename a definition used across files', () =>
			renameElement(ws, find('S000System'), 'S000Product')
		);
		expect(results['rename a definition used across files']!.filesChanged).toBeGreaterThan(1);
	});

	it('deletes a part', async () => {
		const part = ws.elements.find(
			(e) => !e.isDefinition && e.kind === 'part' && e.file.includes('Architecture')
		)!;
		await measure('delete a part', () => deleteElement(ws, part));
	});

	it('duplicates a definition', async () => {
		await measure(
			'duplicate a definition',
			async () => (await duplicateElement(ws, find('S000PowerSupply'))).error
		);
	});

	it('changes a value from the inspector', async () => {
		const value = ws.elements.find(
			(e) => e.kind === 'attribute' && e.value && /\[g\]/.test(e.value)
		)!;
		await measure('set a value', () =>
			ws.transact('Set', () =>
				ws.edit(value.file, {
					op: 'setDeclaration',
					path: value.file,
					source: ws.text(value.file)!,
					element: value.name,
					line: value.span.start_row,
					...(value.id ? { id: value.id } : {}),
					set: { value: '1 [g]' }
				})
			)
		);
	});

	it('reports the numbers', () => {
		const report = { lines: lineCount(files), openMs: Math.round(openMs), edits: results };
		if (process.env.ASSESS_OUT)
			writeFileSync(process.env.ASSESS_OUT, JSON.stringify(report, null, 2));
		expect(Object.keys(results)).toHaveLength(5);
	});
});
