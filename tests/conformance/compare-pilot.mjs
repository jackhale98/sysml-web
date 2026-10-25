#!/usr/bin/env node
/**
 * Compare the conformance runner's results (`results.json`, the toolkit
 * engine as Fairtide runs it) with the OMG pilot implementation's verdicts
 * on the same files (`tools/interop/pilot-check.sh --json`, branch
 * claude/interop-tools), file by file: errors or not, and on which lines.
 *
 *   node tests/conformance/compare-pilot.mjs <results.json> <out.json> <pilot.json>...
 *
 * Pilot files are matched to corpus files by their path from `sysml/src/`,
 * `kerml/src/` or `src/demo/drone/` on. Writes the comparison to <out.json>
 * and prints a summary table.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [resultsPath, outPath, ...pilotPaths] = process.argv.slice(2);
if (!resultsPath || !outPath || !pilotPaths.length) {
	console.error('usage: compare-pilot.mjs <results.json> <out.json> <pilot.json>...');
	process.exit(2);
}
/**
 * @typedef {{ unit: string, line: number, message: string }} Finding
 * @typedef {{ severity: string, line: number, code: string, message: string }} Issue
 * @typedef {{ file: string, issues: Issue[] }} PilotFile
 */
const results = JSON.parse(readFileSync(resultsPath, 'utf8'));

/** Corpus-relative key of a path. */
/** @param {string} path */
const keyOf = (path) => {
	const m = /((?:sysml|kerml)\/src\/.*|src\/demo\/drone\/.*)$/.exec(path);
	return m?.[1] ? m[1].replace(/^src\/demo\/drone\//, 'demo/') : path;
};

// The toolkit's errors per file, in the mode the pilot was run in: examples and
// KerML examples per folder, training and validation per suite, the demo whole.
/** @type {Map<string, Finding[]>} */
const toolkit = new Map();
/** @param {string} unit @param {Finding[]} errors */
const add = (unit, errors) => {
	const key = keyOf(unit);
	toolkit.set(key, [...(toolkit.get(key) ?? []), ...errors]);
};
for (const p of results.release.perProject) {
	const perSuite = /training|validation/.test(p.suite);
	if (perSuite) continue;
	for (const e of p.errors) add(p.suite === 'demo' ? `src/demo/drone/${e.unit}` : e.unit, [e]);
	for (const e of p.parseErrors) add(p.suite === 'demo' ? `src/demo/drone/${e.unit}` : e.unit, [e]);
}
for (const s of results.release.perSuite)
	if (/training|validation/.test(s.suite)) for (const e of s.errors) add(e.unit, [e]);
const allFiles = new Set(
	results.release.perFile.map((/** @type {{ path: string }} */ f) => keyOf(f.path))
);
for (const p of results.release.perProject)
	if (p.suite === 'demo') for (const f of p.paths ?? []) allFiles.add(`demo/${f}`);

const rows = [];
for (const path of pilotPaths) {
	/** @type {{ files: PilotFile[] }} */
	const pilot = JSON.parse(readFileSync(path, 'utf8'));
	for (const f of pilot.files) {
		const key = keyOf(f.file);
		const pilotErrors = f.issues.filter((i) => i.severity === 'ERROR');
		const toolkitErrors = toolkit.get(key) ?? [];
		const pilotLines = new Set(pilotErrors.map((i) => i.line));
		const toolkitLines = new Set(toolkitErrors.map((e) => e.line));
		rows.push({
			file: key,
			pilotRun: path,
			known: allFiles.has(key),
			pilotErrors: pilotErrors.map((i) => ({ line: i.line, code: i.code, message: i.message })),
			toolkitErrors: toolkitErrors.map((e) => ({ line: e.line, message: e.message })),
			verdict:
				pilotErrors.length && toolkitErrors.length
					? 'both reject'
					: pilotErrors.length
						? 'only the pilot rejects'
						: toolkitErrors.length
							? 'only the toolkit rejects'
							: 'both accept',
			sharedLines: [...pilotLines].filter((l) => toolkitLines.has(l)).length
		});
	}
}
writeFileSync(outPath, JSON.stringify(rows, null, 1));

const groups = new Map();
for (const r of rows) {
	const group = r.file
		.split('/')
		.slice(0, r.file.startsWith('demo/') ? 1 : 3)
		.join('/');
	const g = groups.get(group) ?? {
		files: 0,
		'both accept': 0,
		'both reject': 0,
		'only the pilot rejects': 0,
		'only the toolkit rejects': 0,
		pilotErrors: 0,
		toolkitErrors: 0
	};
	g.files++;
	g[r.verdict]++;
	g.pilotErrors += r.pilotErrors.length;
	g.toolkitErrors += r.toolkitErrors.length;
	groups.set(group, g);
}
console.log(
	'| Files | Count | Both accept | Both reject | Only pilot rejects | Only toolkit rejects | Pilot errors | Toolkit errors |'
);
console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const [group, g] of groups)
	console.log(
		`| ${group} | ${g.files} | ${g['both accept']} | ${g['both reject']} | ${g['only the pilot rejects']} | ${g['only the toolkit rejects']} | ${g.pilotErrors} | ${g.toolkitErrors} |`
	);
for (const r of rows.filter((r) => r.verdict !== 'both accept'))
	console.log(
		`- ${r.file}: ${r.verdict} (pilot ${r.pilotErrors.length}, toolkit ${r.toolkitErrors.length}; first: ${r.pilotErrors[0]?.message ?? r.toolkitErrors[0]?.message})`
	);
