/**
 * The demo's tour and every template's: each code span that names part of
 * the model links to the element the text is about. A name several elements
 * share must say which (`Battery::mass`, `drone.battery`), or the link would
 * open whichever comes first; a qualified name must still exist.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { analysed, openWorkspace } from '#lib/create/testing.ts';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import { demoFiles, loadHost } from '#lib/engine/toolkit/testing.ts';
import { loadTemplate, TEMPLATES } from '#lib/project/templates/catalog.ts';
import type { ProjectFile } from '#lib/project/workspace.svelte.ts';
import { resolveReference, segmentsOf } from './references';

let host: ToolkitHost;
beforeAll(async () => {
	host = await loadHost();
}, 60_000);

/** Code spans meant as examples of the notation, not as references. */
const EXAMPLES = new Set(['Package::element']);

async function problemsOfTour(files: ProjectFile[], tour: string): Promise<string[]> {
	const ws = await openWorkspace(host, files);
	await analysed(ws, () => {});
	const spans = new Set([...tour.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!.trim()));
	const problems: string[] = [];
	for (const span of spans) {
		if (EXAMPLES.has(span)) continue;
		const { reference, candidates, byOwner } = resolveReference(span, ws);
		const qualified = /::|\./.test(span) && /^[A-Za-z_']/.test(span) && !/[\s;{}=*~\[]/.test(span);
		if (!reference) {
			if (qualified && segmentsOf(span).length > 1 && !/^\d/.test(span))
				problems.push(`\`${span}\` names nothing in the model`);
			continue;
		}
		if (reference.kind !== 'element' || candidates.length < 2 || byOwner) continue;
		const where = candidates.map((c) => `${c.parent}::${c.label}`).join(', ');
		problems.push(`\`${span}\` could be any of ${candidates.length} (${where})`);
	}
	return problems;
}

describe('tour references', { timeout: 240_000 }, () => {
	it('the demo tour links each reference to the element it is about', async () => {
		const tour = readFileSync('src/demo/drone/TOUR.md', 'utf8');
		expect(await problemsOfTour(demoFiles(), tour)).toEqual([]);
	});

	it.each(TEMPLATES.map((t) => t.id))('the %s template tour does too', async (id) => {
		const template = await loadTemplate(id);
		const files = template.make('Test rig', '', host.viewLibraries()).files;
		expect(await problemsOfTour(files, files.find((f) => f.path === 'TOUR.md')!.text)).toEqual([]);
	});
});
