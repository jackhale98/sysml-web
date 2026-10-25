/**
 * Summarise an assessment benchmark's JSON (every run) as median / p90 / max
 * per measure, as a Markdown table.
 *
 *   node --experimental-strip-types tests/perf/assessment-stats.ts <file.json> [<measure regexp>]
 */
import { readFileSync } from 'node:fs';

type Runs = Record<string, { lines: number; files: number; runs: Record<string, number>[] }>;

/** Nearest-rank percentile of the finite values. */
export function percentile(values: number[], p: number): number {
	const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
	if (!sorted.length) return NaN;
	const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
	return sorted[rank - 1]!;
}

export function summarise(data: Runs, filter?: RegExp): string {
	const lines: string[] = [];
	for (const [label, { lines: count, files, runs }] of Object.entries(data)) {
		lines.push(`\n**${label}** — ${count} lines, ${files} files, ${runs.length} runs`);
		lines.push('', '| measure | median | p90 | max | n |', '| --- | ---: | ---: | ---: | ---: |');
		const keys = [...new Set(runs.flatMap((r) => Object.keys(r)))].filter(
			(k) => !filter || filter.test(k)
		);
		for (const key of keys) {
			const values = runs.map((r) => r[key]).filter((v): v is number => typeof v === 'number');
			const finite = values.filter(Number.isFinite);
			const fmt = (v: number) =>
				Number.isNaN(v) ? '—' : Math.abs(v) < 10 ? v.toFixed(2) : String(Math.round(v));
			lines.push(
				`| ${key} | ${fmt(percentile(finite, 50))} | ${fmt(percentile(finite, 90))} | ${fmt(percentile(finite, 100))} | ${finite.length} |`
			);
		}
	}
	return lines.join('\n');
}

if (process.argv[1]?.endsWith('assessment-stats.ts')) {
	const [file, filter] = process.argv.slice(2);
	console.log(
		summarise(
			JSON.parse(readFileSync(file!, 'utf8')) as Runs,
			filter ? new RegExp(filter) : undefined
		)
	);
}
