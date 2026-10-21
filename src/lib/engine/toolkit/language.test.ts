/**
 * The editor's language services from the toolkit's language server, through
 * `ToolkitHost` on the demo, in the shapes `src/lib/editor/language.ts` uses.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ToolkitHost } from './host';
import { demoFiles, loadHost } from './testing';

let host: ToolkitHost;
const files = demoFiles();
const path = 'system/DroneArchitecture.sysml';
const text = files.find((f) => f.path === path)!.text;
const components = files.find((f) => f.path === 'system/Components.sysml')!.text;
const battery = text.indexOf(': Battery') + 3;

beforeAll(async () => {
	host = await loadHost();
}, 60_000);

describe('language services', () => {
	it('hovers with the qualified name, metaclass and doc', () => {
		const hover = host.hover(files, path, battery);
		expect(text.slice(hover!.from, hover!.to)).toBe('Battery');
		expect(hover!.markdown).toMatch(/DroneComponents::Battery/);
		expect(hover!.markdown).toMatch(/Six-cell lithium-ion pack/);
		expect(host.hover(files, path, text.indexOf('\n\n'))).toBeNull();
	});

	it('goes to definitions in the project and in the standard library', () => {
		const target = host.definition(files, path, battery);
		expect(target).toMatchObject({ path: 'system/Components.sysml' });
		const { from, to } = target as { from: number; to: number };
		expect(components.slice(from, to)).toBe('Battery');
		expect(host.definition(files, path, text.indexOf('ISQ') + 1)).toEqual({
			library: { path: 'Domain Libraries/Quantities and Units/ISQ.sysml', line: 1 }
		});
	});

	it('finds references across files', () => {
		const refs = host.references(files, path, battery);
		expect(refs.map((r) => r.path).sort()).toEqual([
			'system/Components.sysml',
			'system/DroneArchitecture.sysml'
		]);
	});

	it('renames with minimal changes in every file', () => {
		const result = host.renameSymbol(files, path, battery, 'Pack');
		const declared = components.indexOf('Battery :>');
		const used = text.indexOf(': Battery') + 2;
		expect(result).toEqual({
			changes: [
				{ path: 'system/Components.sysml', from: declared, to: declared + 7, insert: 'Pack' },
				{ path, from: used, to: used + 7, insert: 'Pack' }
			]
		});
	});

	it('completes types after `:`', () => {
		const edited = text.replace(
			'part battery : Battery;',
			'part battery : Battery;\n        part x : Bat'
		);
		const at = edited.indexOf('part x : Bat') + 'part x : Bat'.length;
		const project = files.map((f) => (f.path === path ? { ...f, text: edited } : f));
		const result = host.complete(project, path, at);
		expect(result.from).toBe(at - 3);
		expect(result.to).toBe(at);
		expect(result.items.find((i) => i.label === 'Battery')).toMatchObject({
			kind: 'definition',
			detail: 'DroneComponents::Battery'
		});
	});

	it('outlines a file', () => {
		const [root] = host.outline(files, path);
		expect(root).toMatchObject({ name: 'DroneArchitecture', kind: 'package', from: 0 });
		expect(text.slice(root!.selectionFrom, root!.selectionTo)).toBe('DroneArchitecture');
	});

	it('formats with four spaces, as minimal changes, and leaves broken text alone', () => {
		const source = 'package P {\n  part def A {\n  part x;\n  }\n}\n';
		const { changes } = host.format(source);
		let out = source;
		for (const c of [...changes].sort((a, b) => b.from - a.from))
			out = out.slice(0, c.from) + c.insert + out.slice(c.to);
		expect(out).toBe('package P {\n    part def A {\n        part x;\n    }\n}\n');
		expect(host.format(out).changes).toEqual([]);
		expect(host.format('package P { part x : }').changes).toEqual([]);
	});

	it('highlights keywords, names, comments and docs', () => {
		const source =
			"package P {\n    doc /* About P. */\n    // note\n    part def 'A b' { attribute n = 1; }\n}\n";
		const { names, spans } = host.highlight(source);
		const tokens: [string, string][] = [];
		for (let i = 0; i < spans.length; i += 3)
			tokens.push([source.slice(spans[i], spans[i + 1]), names[spans[i + 2]!]!]);
		expect(tokens).toEqual(
			expect.arrayContaining([
				['package', 'keyword'],
				['part', 'keyword'],
				['/* About P. */', 'comment.documentation'],
				['// note', 'comment'],
				["'A b'", 'type.definition'],
				['1', 'number']
			])
		);
	});

	it('answers code action requests (none needed on the demo)', () => {
		expect(host.codeActions(files, path, 0, 10)).toEqual([]);
	});
});
