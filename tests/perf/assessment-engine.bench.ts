/**
 * Assessment benchmark in Node (docs/assessment/10-performance-usability.md):
 * the engine's side of `measure.ts` on the demo and generated projects, with
 * every run kept so the distribution (median, p90, max) can be reported, and
 * the checks timed on their own several times per analysis (the docs report
 * a possible slowdown of the checks at 50k lines).
 *
 *   ASSESS_SIZES=demo,10000,50000,100000
 *   ASSESS_RUNS=5                     runs per size (or "demo:7,10000:5,50000:5,100000:3")
 *   ASSESS_OUT=<file.json>            every run's numbers
 *
 * Run: npx vitest run --config tests/perf/assessment-vitest.config.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import type { SourceFile } from '#lib/engine/protocol.ts';
import { demoFiles, loadHost, toolkitMemoryMiB } from '#lib/engine/toolkit/testing.ts';
import { annotationChecks } from '#lib/engine/toolkit/views/annotationChecks.ts';
import type { ViewContext } from '#lib/engine/toolkit/views/context.ts';
import { generateLines, lineCount } from './generate';
import { measureOnce, type Scenario, type Timings } from './measure';

const sizes = (process.env.ASSESS_SIZES ?? 'demo,10000').split(',').filter(Boolean);
const runSpec = process.env.ASSESS_RUNS ?? '3';
function runsFor(size: string): number {
	if (/^\d+$/.test(runSpec)) return Number(runSpec);
	const entry = runSpec.split(',').find((e) => e.startsWith(`${size}:`));
	return Number(entry?.split(':')[1] ?? 3);
}

const largest = (files: SourceFile[]) =>
	files
		.filter((f) => f.text.includes('doc /*') && !f.path.startsWith('libraries/'))
		.reduce((a, b) => (b.text.length > a.text.length ? b : a)).path;

it('measures the engine for the assessment', async () => {
	const host = await loadHost();
	const results: Record<string, { lines: number; files: number; runs: Timings[] }> = {};
	for (const size of sizes) {
		const files: SourceFile[] = size === 'demo' ? demoFiles() : generateLines(Number(size));
		const label = size === 'demo' ? 'demo' : `${Math.round(lineCount(files) / 1000)}k`;
		const scenario: Scenario =
			size === 'demo'
				? { largest: largest(files), tables: [], diagrams: [['general', null]] }
				: {
						largest: largest(files),
						tables: ['allRequirements', 'productBillOfMaterials'],
						diagrams: [['interconnection', 'product']]
					};
		const runs: Timings[] = [];
		for (let round = 0; round < runsFor(size); round++) {
			const t: Timings = {};
			try {
				measureOnce(host, files, scenario, round, t);
				// The checks on their own: a fresh analysis (untimed), the checks, the checks again.
				host.analyzeProject(files);
				let at = performance.now();
				host.checks(files);
				t['checks.fresh'] = performance.now() - at;
				at = performance.now();
				host.checks(files);
				t['checks.repeat'] = performance.now() - at;
				// The app's own metadata checks (`annotationChecks`, part of the checks since the
				// risk libraries), timed alone on the analysis' cached view context.
				const ctx = (host as unknown as { viewContext(f: SourceFile[]): ViewContext }).viewContext(
					files
				);
				at = performance.now();
				const extra = annotationChecks(ctx);
				t['checks.annotationChecksOnly'] = performance.now() - at;
				t['checks.annotationChecksCount'] = extra.length;
				t['annotations'] = ctx.annotations.length;
			} catch (error) {
				t[`FAILED ${String(error).slice(0, 80)}`] = NaN;
			}
			t.memoryMiB = toolkitMemoryMiB();
			runs.push(t);
			console.log(`${label} run ${round}: ${JSON.stringify(t)}`);
		}
		results[label] = { lines: lineCount(files), files: files.length, runs };
		const out = process.env.ASSESS_OUT;
		if (out) {
			let previous: Record<string, unknown> = {};
			try {
				previous = JSON.parse(readFileSync(out, 'utf8'));
			} catch {
				// first size
			}
			writeFileSync(out, JSON.stringify({ ...previous, [label]: results[label] }, null, 1));
		}
	}
	expect(Object.keys(results).length).toBe(sizes.length);
});
