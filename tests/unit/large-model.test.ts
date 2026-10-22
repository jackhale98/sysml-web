/**
 * Performance guardrails on a generated project of about 10k lines
 * (`tests/perf/generate.ts`; docs/performance.md): the engine's analysis and
 * checks and the page's model building stay within generous budgets, and
 * nothing the page does per element is quadratic. The full benchmark is
 * `npm run bench`.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Analysis } from '#lib/engine/types.ts';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import { loadHost } from '#lib/engine/toolkit/testing.ts';
import { buildTree, collectElements, type ModelElement } from '#lib/project/elements.ts';
import { collectRequirements } from '#lib/project/requirements.ts';
import { generateLines, lineCount } from '../perf/generate';
import { typeOneCharacter } from '../perf/measure';

// Budgets are several times what a laptop takes (shared CI machines are slower and noisy).
const BUDGET = { analysis: 30_000, checks: 30_000, pageModel: 1_000, table: 5_000, tree: 3_000 };

const files = generateLines(10_000);
let host: ToolkitHost;
let analyses: Analysis[];
let analysisMs: number;

const timed = <T>(run: () => T): [T, number] => {
	const started = performance.now();
	const result = run();
	return [result, performance.now() - started];
};

beforeAll(async () => {
	host = await loadHost();
	[analyses, analysisMs] = timed(() => host.analyzeProject(files));
}, 120_000);

describe('a generated project of about 10k lines', () => {
	it('is valid SysML the toolkit finds no problems in', () => {
		expect(lineCount(files)).toBeGreaterThan(9_000);
		const problems = analyses.flatMap((a) => [...a.model.syntax_errors, ...a.diagnostics]);
		expect(problems).toEqual([]);
		expect(collectRequirements(analyses).length).toBeGreaterThan(250);
	});

	it('is analysed within budget, and again after a keystroke', () => {
		expect(analysisMs).toBeLessThan(BUDGET.analysis);
		const path = files.reduce((a, b) => (b.text.length > a.text.length ? b : a)).path;
		const [again, ms] = timed(() => host.analyzeProject(typeOneCharacter(files, path, 1)));
		expect(ms).toBeLessThan(BUDGET.analysis);
		expect(again).toHaveLength(files.length);
		host.analyzeProject(files);
	}, 120_000);

	it('checks its requirements within budget', () => {
		const [report, ms] = timed(() => host.checks(files));
		expect(ms).toBeLessThan(BUDGET.checks);
		expect(report.checks.length).toBeGreaterThan(100);
	}, 120_000);

	it('renders a table of every requirement within budget', () => {
		const [table, ms] = timed(() => host.renderView(files, 'allRequirements'));
		expect(ms).toBeLessThan(BUDGET.table);
		expect(table.rows.length).toBeGreaterThan(250);
	});

	it('builds the page’s elements, tree and requirements within budget', () => {
		const [elements, ms] = timed(() => {
			const elements = collectElements(analyses);
			buildTree(elements);
			collectRequirements(analyses);
			return elements;
		});
		expect(elements.length).toBeGreaterThan(4_000);
		expect(ms).toBeLessThan(BUDGET.pageModel);
	});

	it('nests a tree of 50k elements in linear time (no owner search per element)', () => {
		const elements = collectElements(analyses);
		const many: ModelElement[] = [];
		for (let copy = 0; many.length < 50_000; copy++)
			for (const e of elements)
				many.push({ ...e, file: `${copy}/${e.file}`, key: `${copy}/${e.key}` });
		const [tree, ms] = timed(() => buildTree(many));
		// Quadratic, this took about 20 s; linear, well under a second.
		expect(ms).toBeLessThan(BUDGET.tree);
		expect(tree.length).toBeGreaterThan(0);
	});
});
