/**
 * The engine benchmark in Node (`npm run bench:engine`; `docs/performance.md`).
 *
 *   BENCH_LINES=10000,50000,100000  project sizes (generated, `generate.ts`)
 *   BENCH_RUNS=3                    runs per size (medians are printed)
 *   BENCH_CORPUS=<dir>              also measure every .sysml file under <dir> as one project
 *   BENCH_OUT=<file.json>           also write the medians as JSON
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';
import type { SourceFile } from '#lib/engine/protocol.ts';
import { loadHost, toolkitMemoryMiB } from '#lib/engine/toolkit/testing.ts';
import { generateLines, lineCount } from './generate';
import { measureOnce, medians, type Scenario, type Timings } from './measure';

const sizes = (process.env.BENCH_LINES ?? '10000,50000,100000')
	.split(',')
	.filter(Boolean)
	.map(Number);
const runs = Number(process.env.BENCH_RUNS ?? 3);

function corpus(dir: string): SourceFile[] {
	const out: SourceFile[] = [];
	const walk = (at: string) => {
		for (const name of readdirSync(at).sort()) {
			const path = join(at, name);
			if (statSync(path).isDirectory()) walk(path);
			else if (name.endsWith('.sysml'))
				out.push({ path: relative(dir, path), text: readFileSync(path, 'utf8') });
		}
	};
	walk(dir);
	return out.sort((a, b) => a.path.localeCompare(b.path));
}

const largest = (files: SourceFile[]) =>
	files.reduce((a, b) => (b.text.length > a.text.length ? b : a)).path;

it('measures the engine on large projects', async () => {
	const host = await loadHost();
	const projects: { label: string; files: SourceFile[]; scenario: Scenario }[] = sizes.map(
		(lines) => {
			const files = generateLines(lines);
			return {
				label: `${Math.round(lineCount(files) / 1000)}k`,
				files,
				scenario: {
					largest: largest(files),
					tables: ['allRequirements', 's000Requirements', 'productBillOfMaterials'],
					diagrams: [
						['general', 'S000Components'],
						['interconnection', 's000'],
						['states', 'S000Modes'],
						['general', 'Product'],
						['interconnection', 'product'],
						['general', null]
					]
				}
			};
		}
	);
	if (process.env.BENCH_CORPUS) {
		const files = corpus(process.env.BENCH_CORPUS);
		projects.push({
			label: `corpus ${Math.round(lineCount(files) / 1000)}k`,
			files,
			scenario: { largest: largest(files), tables: [], diagrams: [['general', null]] }
		});
	}

	const results: Record<string, Timings> = {};
	for (const { label, files, scenario } of projects) {
		const all: Timings[] = [];
		let failed: string | null = null;
		for (let round = 0; round < runs && !failed; round++) {
			const timings: Timings = {};
			try {
				measureOnce(host, files, scenario, round, timings);
			} catch (error) {
				// A trap (out of memory) leaves the toolkit unusable: report what was measured.
				failed = `${Object.keys(timings).at(-1) ?? 'start'}: ${String(error)}`;
				console.log(`${label}: failed after ${failed}`);
			}
			all.push(timings);
		}
		const timings = medians(all);
		if (failed) timings[`FAILED (${failed})`] = NaN;
		timings['memory MiB'] = toolkitMemoryMiB();
		timings.files = files.length;
		timings.lines = lineCount(files);
		results[label] = timings;
		console.log(`${label}: done`);
	}

	const labels = Object.keys(results);
	const keys = [...new Set(labels.flatMap((l) => Object.keys(results[l]!)))];
	const rows = keys.map(
		(key) =>
			`| ${key} | ${labels.map((l) => (results[l]![key] === undefined ? '' : Math.round(results[l]![key]!))).join(' | ')} |`
	);
	console.log(
		[
			`Engine in Node, medians of ${runs} runs (ms unless noted)`,
			`| measure | ${labels.join(' | ')} |`,
			`| --- | ${labels.map(() => '---:').join(' | ')} |`,
			...rows
		].join('\n')
	);
	if (process.env.BENCH_OUT) writeFileSync(process.env.BENCH_OUT, JSON.stringify(results, null, 2));
	expect(labels.length).toBeGreaterThan(0);
});
