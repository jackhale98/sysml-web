/**
 * Assessment evidence (§7, reports at a revision): a report is a pure
 * function of the model files (and the date it is stamped with), so the same
 * files give the same document byte for byte, and the files of an older
 * revision give that revision's figures. The report itself does not say
 * which revision it was built from.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import { demoFiles, loadHost } from '#lib/engine/toolkit/testing.ts';
import { buildTree, collectElements } from '#lib/project/elements.ts';
import { collectRequirements } from '#lib/project/requirements.ts';
import { isLibraryFile } from '#lib/project/workspace.svelte.ts';
import { buildReport } from './build.ts';
import { prepareReport, type ReportSource } from './gather.ts';
import { toMarkdown } from './markdown.ts';

let host: ToolkitHost;
beforeAll(async () => {
	host = await loadHost();
}, 60_000);

const DATE = new Date('2026-10-21T12:00:00Z');
const demo = Object.fromEntries(demoFiles().map((f) => [f.path, f.text]));

function report(texts: Record<string, string>) {
	const list = Object.entries(texts).map(([path, text]) => ({ path, text }));
	const analyses = host.analyzeProject(list);
	const source: ReportSource = {
		views: host.listViews(list),
		analyses,
		texts,
		tree: buildTree(collectElements(analyses)),
		requirements: collectRequirements(analyses),
		project: { name: 'Drone UAV', version: '0.2.0' },
		isLibrary: isLibraryFile
	};
	return buildReport(prepareReport('droneSpecification', source, DATE));
}
const markdown = (texts: Record<string, string>) => toMarkdown(report(texts));
const satisfied = (texts: Record<string, string>) =>
	report(texts).summary.find((f) => f.label === 'Satisfied')!.value;

describe('a report regenerated from a revision', { timeout: 60_000 }, () => {
	it('is the same document from the same files, every time', () => {
		const first = markdown(demo);
		expect(markdown({ ...demo })).toBe(first);
		expect(first).toContain('SYS-001 Flight endurance');
	});

	it('shows the figures of the revision it is built from', () => {
		// A later revision closes the SYS-005 gap; the earlier one still has it.
		const later = {
			...demo,
			'system/Satisfaction.sysml': demo['system/Satisfaction.sysml']!.replace(
				'    // Open gaps',
				"    satisfy 'Ingress protection' by drone;\n    // Open gaps"
			)
		};
		expect(satisfied(demo)).toBe('76 %');
		expect(satisfied(later)).toBe('82 %');
		expect(markdown(later)).not.toBe(markdown(demo));
	});

	it('names no revision (commit) on its title page: only the date and the project version', () => {
		const md = markdown(demo);
		expect(md).toContain('0.2.0');
		expect(md).not.toMatch(/\b[0-9a-f]{7,40}\b/);
		expect(md).not.toMatch(/commit|revision/i);
	});
});
