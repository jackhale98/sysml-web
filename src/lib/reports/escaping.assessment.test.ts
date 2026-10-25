/**
 * Assessment (§9, unsafe content): model text that looks like markup must
 * never become markup in a report. The interconnection diagram is the one
 * place a report puts raw markup on the page (`{@html b.svg}` in
 * ReportView.svelte), so it is built here from a model whose names are
 * HTML, on the real toolkit, and checked to hold them only as text.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import { demoFiles, loadHost } from '#lib/engine/toolkit/testing.ts';
import { hostEngine } from '#lib/create/testing.ts';
import { buildTree, collectElements } from '#lib/project/elements.ts';
import { collectRequirements } from '#lib/project/requirements.ts';
import { isLibraryFile } from '#lib/project/workspace.svelte.ts';
import { prepareReport, renderParts } from './gather.ts';
import { toMarkdown } from './markdown.ts';
import { buildReport } from './build.ts';

const PART = `<img src=x onerror="alert(1)">`;
const PORT = `<script>alert(2)</script>`;

let host: ToolkitHost;
beforeAll(async () => {
	host = await loadHost();
}, 120_000);

/** The demo, with a part and a port inside the drone whose names are HTML. */
function hostileDemo() {
	return demoFiles().map((f) =>
		f.path.endsWith('DroneArchitecture.sysml')
			? {
					...f,
					text: f.text.replace(
						'        part camera : Camera;',
						`        part camera : Camera;\n        part '${PART}' : Camera { port '${PORT}' : ImagePort; }\n        connect camera.imageOut to '${PART}'.'${PORT}';`
					)
				}
			: f
	);
}

describe('report markup from model text', () => {
	it('the interconnection diagram holds HTML-like names only as escaped text', async () => {
		const files = hostileDemo();
		expect(files.some((f) => f.text.includes(PART))).toBe(true);
		const analyses = host.analyzeProject(files);
		const texts = Object.fromEntries(files.map((f) => [f.path, f.text]));
		const ctx = prepareReport(
			'droneInterfaceControl',
			{
				views: host.listViews(files),
				analyses,
				texts,
				tree: buildTree(collectElements(analyses)),
				requirements: collectRequirements(analyses),
				project: { name: 'Drone' },
				isLibrary: isLibraryFile
			},
			new Date('2026-10-21T12:00:00Z')
		);
		const rendered = await renderParts(ctx, hostEngine(host), files);
		const svg = rendered.diagram?.svg ?? '';
		// The hostile part is on the diagram (so the check below is not vacuous)…
		expect(svg).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
		expect(svg).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
		// …and nothing it holds became an element or an attribute.
		expect(svg).not.toMatch(/<(img|script)\b/i);
		expect(svg).not.toMatch(/\sonerror\s*=\s*["']/i);
		// The document's text (rendered by Svelte, which escapes) carries the name as written.
		const markdown = toMarkdown(buildReport(rendered));
		expect(markdown).toContain(PART);
	}, 120_000);
});
