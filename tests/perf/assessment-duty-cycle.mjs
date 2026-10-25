#!/usr/bin/env node
/**
 * Slow a browser's renderer processes down, workers included, by running
 * them one slice of every 20 ms and pausing them (SIGSTOP / SIGCONT) for the
 * rest. Chrome's DevTools CPU throttling slows a page's main thread but not
 * its workers ("Operation is only supported for pages, not workers"), so
 * the engine's worker would run at desktop speed; this slows both, roughly
 * as a slower phone CPU would. Linux only. Used by assessment-perf-ux.bench.ts
 * (ASSESS_DUTY).
 *
 *   node tests/perf/assessment-duty-cycle.mjs <root pid> <slowdown, e.g. 4>
 *
 * Renderers are the processes under <root pid> whose command line has
 * `--type=renderer`, looked up again every half second. SIGTERM lets them
 * all run again and exits.
 */
import { readFileSync, readdirSync } from 'node:fs';

const root = Number(process.argv[2]);
const slowdown = Math.max(1, Number(process.argv[3] ?? 4));
const WINDOW = 20;
const run = Math.max(1, Math.round(WINDOW / slowdown));
const pause = WINDOW - run;

function renderers() {
	const parent = new Map();
	const isRenderer = new Set();
	for (const name of readdirSync('/proc')) {
		if (!/^\d+$/.test(name)) continue;
		try {
			const stat = readFileSync(`/proc/${name}/stat`, 'utf8');
			const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
			parent.set(Number(name), ppid);
			if (readFileSync(`/proc/${name}/cmdline`, 'utf8').includes('--type=renderer'))
				isRenderer.add(Number(name));
		} catch {
			// gone
		}
	}
	const under = (pid) => {
		for (let p = pid, depth = 0; p > 1 && depth < 20; p = parent.get(p) ?? 1, depth++)
			if (p === root) return true;
		return false;
	};
	return [...isRenderer].filter(under);
}

let pids = renderers();
setInterval(() => (pids = renderers()), 500).unref();
const signal = (sig) => {
	for (const pid of pids)
		try {
			process.kill(pid, sig);
		} catch {
			// gone
		}
};
let stopping = false;
process.on('SIGTERM', () => {
	stopping = true;
	signal('SIGCONT');
	process.exit(0);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
while (!stopping) {
	signal('SIGCONT');
	await sleep(run);
	if (stopping) break;
	signal('SIGSTOP');
	await sleep(pause);
}
signal('SIGCONT');
