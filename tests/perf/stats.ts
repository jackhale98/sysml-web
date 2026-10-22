/** Medians of benchmark runs. */
export type Timings = Record<string, number>;

/** The median of the finite values (NaN marks a step that didn't finish). */
export function median(values: number[]): number {
	const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
	if (!sorted.length) return NaN;
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Medians of several runs, key by key. */
export function medians(runs: Timings[]): Timings {
	const out: Timings = {};
	for (const key of new Set(runs.flatMap((r) => Object.keys(r))))
		out[key] = median(runs.map((r) => r[key] ?? NaN));
	return out;
}
