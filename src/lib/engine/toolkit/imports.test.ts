/**
 * The engine resolves names by SysML v2's import and visibility rules: a
 * name from another package needs an import or a qualified name, `::*`
 * imports one level and `::**` all of them, private imports are not passed
 * on while public ones are, private members stay hidden, and aliases and
 * imports work across files.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { SourceFile } from '../protocol';
import type { ToolkitHost } from './host';
import { loadHost } from './testing';

let host: ToolkitHost;
beforeAll(async () => {
	host = await loadHost();
});

function problems(files: SourceFile[]): string[] {
	return host
		.analyzeProject(files)
		.flatMap((a) => [
			...a.model.syntax_errors.map((e) => e.message),
			...a.diagnostics.map((d) => d.message)
		]);
}
const one = (text: string) => problems([{ path: 'm.sysml', text }]);

describe('import and visibility rules', () => {
	it.each([
		['a qualified name', 'package A { part def X; } package B { part y : A::X; }'],
		[
			'a namespace import',
			'package A { part def X; } package B { private import A::*; part y : X; }'
		],
		[
			'a membership import',
			'package A { part def X; } package B { private import A::X; part y : X; }'
		],
		[
			'a recursive import',
			'package A { package Inner { part def X; } } package B { private import A::**; part y : X; }'
		],
		[
			'a public import, passed on',
			'package A { part def X; } package B { public import A::*; } package C { private import B::*; part y : X; }'
		],
		['an alias', 'package A { part def X; } package B { alias Z for A::X; part y : Z; }'],
		['an enclosing namespace', 'package A { part def X; package Inner { part y : X; } }']
	])('resolves through %s', (_, text) => {
		expect(one(text)).toEqual([]);
	});

	it.each([
		['no import', 'package A { part def X; } package B { part y : X; }'],
		[
			'a namespace import one level up',
			'package A { package Inner { part def X; } } package B { private import A::*; part y : X; }'
		],
		[
			'a private import, not passed on',
			'package A { part def X; } package B { private import A::*; } package C { private import B::*; part y : X; }'
		],
		[
			'a private member',
			'package A { private part def X; } package B { private import A::*; part y : X; }'
		]
	])('does not resolve through %s', (_, text) => {
		expect(one(text).join(' ')).toMatch(/unresolved reference `X`/);
	});

	it('imports across files', () => {
		expect(
			problems([
				{ path: 'a.sysml', text: 'package A { part def X; }' },
				{ path: 'b.sysml', text: 'package B { private import A::*; part y : X; }' }
			])
		).toEqual([]);
	});
});
