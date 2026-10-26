/**
 * Assessment (docs/assessment/01-language.md, checklist 1.2 "Can the editor
 * handle temporarily invalid or incomplete models while users type?"): the
 * demo re-analysed after every keystroke of a new declaration typed into the
 * middle of a file, and with a file cut off at many points, through the
 * host the editor's worker runs. Nothing may throw; other files must keep
 * all their elements; the problems shown must be few and where the typing
 * is; and the finished text must analyse clean.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Analysis } from '../types';
import type { ToolkitHost } from './host';
import { demoFiles, loadHost } from './testing';

const files = demoFiles();
const PATH = 'system/DroneArchitecture.sysml';
const original = files.find((f) => f.path === PATH)!.text;
/** Typed on a new line just inside `part drone : DeliveryDrone {`. */
const TYPED =
	'        part spareCamera : DroneComponents::Camera[0..1] {\n' +
	'            attribute serial : ScalarValues::String;\n' +
	'        }\n';
const AT = original.indexOf('\n', original.indexOf('part drone : DeliveryDrone {')) + 1;
const lineOfAt = original.slice(0, AT).split('\n').length;

let host: ToolkitHost;
let baseline: Analysis[];
const names = (a: Analysis) =>
	new Set([...a.model.definitions, ...a.model.usages].map((e) => e.qualified_name));

beforeAll(async () => {
	host = await loadHost();
	baseline = host.analyzeProject(files);
}, 60_000);

const withText = (text: string) => files.map((f) => (f.path === PATH ? { ...f, text } : f));

/** The demo with the declaration typed up to its `k`th character, analysed. */
const typedTo = (k: number) =>
	host.analyzeProject(withText(original.slice(0, AT) + TYPED.slice(0, k) + original.slice(AT)));

describe('typing a declaration into the demo', () => {
	it('every keystroke analyses, keeps the other files whole and shows at most three problems', () => {
		let worstProblems = 0;
		for (let k = 1; k <= TYPED.length; k++) {
			const analyses = typedTo(k);
			// Other files: all their elements, no problems.
			analyses.forEach((a, i) => {
				if (a.model.file === PATH) return;
				expect(names(a)).toEqual(names(baseline[i]!));
				expect(a.diagnostics).toEqual([]);
			});
			const own = analyses.find((a) => a.model.file === PATH)!;
			worstProblems = Math.max(
				worstProblems,
				own.model.syntax_errors.length + own.diagnostics.length
			);
		}
		expect(worstProblems).toBeLessThanOrEqual(3);
		const done = typedTo(TYPED.length);
		expect(done.flatMap((a) => [...a.model.syntax_errors, ...a.diagnostics])).toEqual([]);
		expect(names(done.find((a) => a.model.file === PATH)!)).toContain(
			'DroneArchitecture::drone::spareCamera'
		);
	}, 120_000);

	// While `part spareCamera … {` is unclosed, the toolkit's repair moved the rest of `part
	// drone`, and a model check reported "connector end references `commandLink`, which is
	// featured in `DeliveryDrone` …" on an untouched line (62). The file is now repaired from its
	// text as it last parsed (host.ts, `fromLastParsed`). The syntax error itself is reported at
	// the end of the file, where the parser runs out of text, which is right for an open brace.
	it('while typing, no model problem appears away from the typing', () => {
		const typedLines = TYPED.split('\n').length;
		const far: string[] = [];
		for (let k = 1; k <= TYPED.length; k++) {
			const own = typedTo(k).find((a) => a.model.file === PATH)!;
			for (const p of own.diagnostics)
				if (p.span.start_row < lineOfAt - 1 || p.span.start_row > lineOfAt + typedLines + 1)
					far.push(`${k}: line ${p.span.start_row} ${p.message}`);
		}
		expect(far).toEqual([]);
	}, 120_000);

	// The toolkit's repair cut out the whole enclosing `part drone { … }`, so up to 28 of the
	// file's elements left the explorer and diagrams until the text parsed again; repaired from
	// its text as it last parsed, the file keeps them.
	it('every keystroke keeps the edited file’s other elements in the model', () => {
		const before = names(baseline.find((a) => a.model.file === PATH)!);
		const lost = new Set<string>();
		for (let k = 1; k <= TYPED.length; k++) {
			const now = names(typedTo(k).find((a) => a.model.file === PATH)!);
			for (const n of before) if (!now.has(n)) lost.add(n!);
		}
		expect([...lost]).toEqual([]);
	}, 120_000);

	it('a file cut off anywhere analyses, with a syntax error inside the text', () => {
		const step = Math.ceil(original.length / 40);
		for (let cut = step; cut < original.length; cut += step) {
			const text = original.slice(0, cut);
			const own = host.analyzeProject(withText(text)).find((a) => a.model.file === PATH)!;
			for (const e of own.model.syntax_errors) {
				expect(e.span.from).toBeGreaterThanOrEqual(0);
				expect(e.span.to).toBeLessThanOrEqual(text.length);
			}
			// The package is still open: the cut must be reported.
			expect(own.model.syntax_errors.length, `cut at ${cut}`).toBeGreaterThan(0);
		}
	}, 120_000);
});
