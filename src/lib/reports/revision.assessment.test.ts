/**
 * Assessment evidence (§7, reports at a revision): a report is a pure
 * function of the model files (and the date it is stamped with), so the same
 * files give the same document byte for byte, and the files of an older
 * revision give that revision's figures. The report names the commit it
 * was built from (from the GitHub connection), or says it is not committed.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import { demoFiles, loadHost } from '#lib/engine/toolkit/testing.ts';
import { buildTree, collectElements } from '#lib/project/elements.ts';
import { collectRequirements } from '#lib/project/requirements.ts';
import { revisionStamp, type RevisionStamp } from '#lib/project/revision.svelte.ts';
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

function report(texts: Record<string, string>, revision: RevisionStamp | null = null) {
	const list = Object.entries(texts).map(([path, text]) => ({ path, text }));
	const analyses = host.analyzeProject(list);
	const source: ReportSource = {
		views: host.listViews(list),
		analyses,
		texts,
		tree: buildTree(collectElements(analyses)),
		requirements: collectRequirements(analyses),
		project: { name: 'Drone UAV', version: '0.2.0' },
		isLibrary: isLibraryFile,
		revision: revision ? { stamp: revisionStamp(revision), info: null } : null
	};
	return buildReport(prepareReport('droneSpecification', source, DATE));
}
const markdown = (texts: Record<string, string>, revision: RevisionStamp | null = null) =>
	toMarkdown(report(texts, revision));
const satisfied = (texts: Record<string, string>) =>
	report(texts).summary.find((f) => f.label === 'Satisfied')!.value;

describe('a report regenerated from a revision', { timeout: 60_000 }, () => {
	it('is the same document from the same files, every time', () => {
		const first = markdown(demo);
		expect(markdown({ ...demo })).toBe(first);
		expect(first).toContain('SYS-001 Flight endurance');
	});

	it('shows the figures of the revision it is built from', () => {
		// A later revision gives SYS-005 a design element; with it the need SYS-005 derives from
		// (STK-003, with SYS-004) is satisfied through its derived requirements too: 13 → 15 of 17.
		const later = {
			...demo,
			'system/Satisfaction.sysml': demo['system/Satisfaction.sysml']!.replace(
				'    // Open gaps',
				"    satisfy 'Ingress protection' by drone;\n    // Open gaps"
			)
		};
		expect(satisfied(demo)).toBe('76 %');
		expect(satisfied(later)).toBe('88 %');
		expect(markdown(later)).not.toBe(markdown(demo));
	});

	it('names the commit it was built from on its title page and in its introduction', () => {
		const at = {
			commit: '3f2a9c1d0b4e5f60718293a4b5c6d7e8f9012345',
			repository: 'acme/drone',
			branch: 'main',
			changed: false
		};
		const md = markdown(demo, at);
		expect(md).toContain('0.2.0');
		expect(md).toContain('21 October 2026 · Commit 3f2a9c1 of acme/drone (main)');
		expect(md).toContain(
			'Generated from the SysML model of Drone UAV on 21 October 2026 (commit 3f2a9c1 of acme/drone (main)).'
		);
		expect(report(demo, at).revision).toBe('Commit 3f2a9c1 of acme/drone (main)');
		// Changed since: it says so, rather than naming a commit the model isn't at.
		expect(report(demo, { ...at, changed: true }).revision).toBe(
			'Commit 3f2a9c1 of acme/drone (main), with changes not committed'
		);
	});

	it('says it is not committed when the project has no commit', () => {
		const md = markdown(demo);
		expect(md).toContain('21 October 2026 · Not committed');
		expect(md).not.toMatch(/\b[0-9a-f]{7,40}\b/);
	});
});
