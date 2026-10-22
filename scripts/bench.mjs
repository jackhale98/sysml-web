#!/usr/bin/env node
/**
 * The performance benchmark (docs/performance.md): the engine in Node and the
 * app in headless Chromium, on generated projects of several sizes. Prints
 * one table per environment, medians of several runs.
 *
 *   npm run bench                                  all sizes, Node and browser
 *   npm run bench -- --engine                      Node only
 *   npm run bench -- --browser [--throttle 4]      browser only (CPU throttled 4×)
 *   npm run bench -- --lines 10000,50000 --runs 3 --corpus <dir of .sysml files>
 *
 * Each size runs in its own process, so a toolkit that runs out of memory on
 * one size doesn't take the others with it. The browser part builds the app
 * and serves it (PW_PORT, default 4205) like the e2e suite.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
	const at = args.indexOf(`--${name}`);
	return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const lines = option('lines', '10000,50000,100000').split(',');
const runs = option('runs', '3');
const corpus = option('corpus', '');
const throttle = option('throttle', '');
const engine = flag('engine') || !flag('browser');
const browser = flag('browser') || !flag('engine');
const out = mkdtempSync(join(tmpdir(), 'sysml-bench-'));

const results = { engine: {}, browser: {} };

function run(command, commandArgs, env) {
	const result = spawnSync(command, commandArgs, {
		stdio: ['ignore', 'inherit', 'inherit'],
		env: { ...process.env, ...env },
		shell: process.platform === 'win32'
	});
	return result.status ?? 1;
}

function read(file, into) {
	if (existsSync(file)) Object.assign(into, JSON.parse(readFileSync(file, 'utf8')));
}

if (engine) {
	const sizes = corpus ? [...lines, 'corpus'] : lines;
	for (const size of sizes) {
		const file = join(out, `engine-${size}.json`);
		run('npx', ['vitest', 'run', '--config', 'tests/perf/vitest.config.ts'], {
			BENCH_LINES: size === 'corpus' ? '' : size,
			BENCH_CORPUS: size === 'corpus' ? corpus : '',
			BENCH_RUNS: runs,
			BENCH_OUT: file
		});
		read(file, results.engine);
	}
}

if (browser) {
	for (const size of lines) {
		const file = join(out, `browser-${size}.json`);
		run('npx', ['playwright', 'test', '--config', 'tests/perf/playwright.config.ts'], {
			BENCH_LINES: size,
			BENCH_RUNS: runs,
			BENCH_THROTTLE: throttle,
			BENCH_OUT: file
		});
		read(file, results.browser);
	}
}

function table(title, data) {
	const labels = Object.keys(data);
	if (!labels.length) return;
	const keys = [...new Set(labels.flatMap((l) => Object.keys(data[l])))];
	const cell = (v) => (v === undefined || v === null ? '' : Number.isNaN(v) ? '—' : Math.round(v));
	console.log(`\n${title}`);
	console.log(`| measure | ${labels.join(' | ')} |`);
	console.log(`| --- | ${labels.map(() => '---:').join(' | ')} |`);
	for (const key of keys)
		console.log(`| ${key} | ${labels.map((l) => cell(data[l][key])).join(' | ')} |`);
}

table(`Engine in Node, medians of ${runs} runs (ms unless noted)`, results.engine);
table(
	`App in Chromium${throttle ? `, CPU throttled ${throttle}×` : ''}, medians of ${runs} runs (ms unless noted)`,
	results.browser
);
