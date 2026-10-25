/**
 * Assessment (docs/assessment/01-language.md, checklist 1.2 "Are semantic
 * results consistent across sessions, reloads, and supported
 * environments?"): the same text gives the same analysis — problems,
 * elements, kinds, element ids and links — whether it is analysed fresh,
 * after other projects, after an edit and its undo (the incremental path),
 * or by a second engine host (a reload).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Analysis } from '../types';
import { ToolkitHost } from './host';
import { demoFiles, loadHost } from './testing';

const files = demoFiles();
let host: ToolkitHost;

beforeAll(async () => {
	host = await loadHost();
}, 60_000);

/** What the analysis says about the model, without timings. */
const essence = (analyses: Analysis[]) => JSON.stringify(analyses);

describe('the same text, the same analysis', () => {
	it('after other projects, an edit and its undo, and in a second host', () => {
		const first = essence(host.analyzeProject(files));

		// Another project in between (the session is replaced).
		host.analyzeProject([{ path: 'x.sysml', text: 'package X { part def A; part a : A; }' }]);
		expect(essence(host.analyzeProject(files))).toBe(first);

		// An edit, then the original text again (rebuilt from the edited session's outcomes).
		const edited = files.map((f, i) => (i === 0 ? { ...f, text: f.text + '\n// edited\n' } : f));
		host.analyzeProject(edited);
		expect(essence(host.analyzeProject(files))).toBe(first);

		// A second host on the same module (as after a reload).
		const second = new ToolkitHost(host.tk, host.library);
		expect(essence(second.analyzeProject(files))).toBe(first);
	});

	it('element ids do not depend on the order files are given in', () => {
		const ids = (analyses: Analysis[]) =>
			analyses
				.flatMap((a) => [...a.model.definitions, ...a.model.usages])
				.map((e) => `${e.qualified_name} ${e.id}`)
				.sort();
		const forward = ids(host.analyzeProject(files));
		const reversed = ids(host.analyzeProject([...files].reverse()));
		expect(reversed).toEqual(forward);
	});
});
