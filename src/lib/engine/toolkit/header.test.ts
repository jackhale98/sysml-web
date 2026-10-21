/**
 * The declaration header editor on its own (no toolkit): each field set,
 * changed and cleared on each kind of declaration, ported from the earlier
 * engine's `declaration.rs` table. Where the outputs differ from that engine's,
 * the reason is noted (prefix order and `constant` follow the SysML v2
 * notation the toolkit parses).
 */
import { describe, expect, it } from 'vitest';
import type { DeclarationSet } from '../types';
import {
	applyTextChanges,
	blockComment,
	commentText,
	formatReference,
	planHeader,
	readHeader,
	tokenize
} from './header';

/** Where the declaration naming `element` starts: after the `{`, `;` or `}` before it. */
function startOf(src: string, element: string): number {
	const tokens = tokenize(src);
	const at = tokens.findIndex((t) => t.text === element || t.text === `'${element}'`);
	if (at < 0) throw new Error(`no ${element}`);
	let i = at;
	while (i > 0 && !['{', ';', '}'].includes(tokens[i - 1]!.text)) i--;
	return tokens[i]!.start;
}

function edit(src: string, element: string, set: DeclarationSet): string {
	const header = readHeader(src, startOf(src, element));
	if (!header) throw new Error('not a declaration');
	const out = applyTextChanges(src, planHeader(src, header, set));
	// Setting it again changes nothing.
	const again = readHeader(out, startOf(out, element))!;
	expect(planHeader(out, again, set), `${element} ${JSON.stringify(set)} on ${out}`).toEqual([]);
	return out;
}

function fails(src: string, element: string, set: DeclarationSet): string {
	const header = readHeader(src, startOf(src, element))!;
	try {
		planHeader(src, header, set);
	} catch (error) {
		return (error as Error).message;
	}
	throw new Error('should fail');
}

const cases: [string, string, DeclarationSet, string][] = [
	// type
	['part a;', 'a', { type: 'A' }, 'part a : A;'],
	['part a : A;', 'a', { type: 'B' }, 'part a : B;'],
	['part a : A;', 'a', { type: null }, 'part a;'],
	['part a : A[4];', 'a', { type: null }, 'part a[4];'],
	['attribute x;', 'x', { type: 'ISQ::mass' }, 'attribute x : ISQ::mass;'],
	['item i :> j;', 'i', { type: 'I' }, 'item i : I :> j;'],
	['action a;', 'a', { type: 'Fly' }, 'action a : Fly;'],
	['requirement r;', 'r', { type: 'R' }, 'requirement r : R;'],
	['part p defined by Q;', 'p', { type: 'R' }, 'part p defined by R;'],
	// conjugated ports
	['port p;', 'p', { type: 'P', conjugated: true }, 'port p : ~P;'],
	['port p : P;', 'p', { conjugated: true }, 'port p : ~P;'],
	['port p : ~P;', 'p', { conjugated: false }, 'port p : P;'],
	['port p : ~P;', 'p', { type: 'Q' }, 'port p : ~Q;'],
	['port p : ~P;', 'p', { type: null }, 'port p;'],
	// specializes
	['part def A;', 'A', { specializes: ['B'] }, 'part def A :> B;'],
	['part def A :> B;', 'A', { specializes: ['B', 'C'] }, 'part def A :> B, C;'],
	['part def A :> B, C {}', 'A', { specializes: ['C'] }, 'part def A :> C {}'],
	['part def A :> B { }', 'A', { specializes: [] }, 'part def A { }'],
	[
		"requirement def <'R'> D specializes X;",
		'D',
		{ specializes: ['Y'] },
		"requirement def <'R'> D specializes Y;"
	],
	['enum def E :> F { enum a; }', 'E', { specializes: [] }, 'enum def E { enum a; }'],
	['part a : A;', 'a', { specializes: ['b'] }, 'part a : A :> b;'],
	['part a : A[4] = x;', 'a', { specializes: ['b'] }, 'part a : A[4] :> b = x;'],
	['part q : A subsets x;', 'q', { specializes: ['y'] }, 'part q : A subsets y;'],
	['part a :> b :> c;', 'a', { specializes: ['d'] }, 'part a :> d;'],
	// redefines
	['part a : A;', 'a', { redefines: 'x' }, 'part a : A :>> x;'],
	['part a :> b :>> x;', 'a', { redefines: 'y' }, 'part a :> b :>> y;'],
	['part a : A :>> x = 1;', 'a', { redefines: null }, 'part a : A = 1;'],
	['attribute m redefines mass;', 'm', { redefines: 'weight' }, 'attribute m redefines weight;'],
	['part a :>> b.c;', 'a', { redefines: 'b.d' }, 'part a :>> b.d;'],
	// multiplicity
	['part a : A;', 'a', { multiplicity: '[4]' }, 'part a[4] : A;'],
	['part a : A[4];', 'a', { multiplicity: '6' }, 'part a : A[6];'],
	['part a : A[4];', 'a', { multiplicity: '[0..1]' }, 'part a : A[0..1];'],
	['item i : I [0..1];', 'i', { multiplicity: null }, 'item i : I;'],
	[
		'attribute b[0..*] ordered : Real;',
		'b',
		{ multiplicity: '1..*' },
		'attribute b[1..*] ordered : Real;'
	],
	['action a : A;', 'a', { multiplicity: '[2]' }, 'action a[2] : A;'],
	['requirement r : R;', 'r', { multiplicity: '[0..1]' }, 'requirement r[0..1] : R;'],
	['part def P { in m : Real; }', 'm', { multiplicity: '[2]' }, 'part def P { in m : Real[2]; }'],
	// value
	['attribute x : Real;', 'x', { value: '0.3' }, 'attribute x : Real = 0.3;'],
	['attribute x : Real = 0.3;', 'x', { value: '0.5' }, 'attribute x : Real = 0.5;'],
	['attribute x : Real = 0.3;', 'x', { value: null }, 'attribute x : Real;'],
	['attribute x : Real = 0.3;', 'x', { valueKind: 'default' }, 'attribute x : Real default = 0.3;'],
	[
		'attribute x : Real default = 2;',
		'x',
		{ value: '3', valueKind: 'bind' },
		'attribute x : Real = 3;'
	],
	['attribute x : Real default 2;', 'x', { value: '4' }, 'attribute x : Real default 4;'],
	['attribute x;', 'x', { value: '1', valueKind: 'initial' }, 'attribute x := 1;'],
	[
		'attribute x : Real = 1 { doc /* d */ }',
		'x',
		{ value: '2' },
		'attribute x : Real = 2 { doc /* d */ }'
	],
	['attribute x : Real = 1 { }', 'x', { value: null }, 'attribute x : Real { }'],
	['part def P { in m : Real; }', 'm', { value: '1' }, 'part def P { in m : Real = 1; }'],
	// direction
	['part def P { item x; }', 'x', { direction: 'in' }, 'part def P { in item x; }'],
	['port def P { out item x : X; }', 'x', { direction: 'in' }, 'port def P { in item x : X; }'],
	['port def P { out item x : X; }', 'x', { direction: null }, 'port def P { item x : X; }'],
	['part d { port p : ~P; }', 'p', { direction: 'out' }, 'part d { out port p : ~P; }'],
	[
		'part def P { private item x; }',
		'x',
		{ direction: 'out' },
		'part def P { private out item x; }'
	],
	['part def P { in m : Real; }', 'm', { direction: 'out' }, 'part def P { out m : Real; }'],
	['action def A { in action a; }', 'a', { direction: null }, 'action def A { action a; }'],
	// abstract, constant, derived, end
	['part def A;', 'A', { abstract: true }, 'abstract part def A;'],
	['abstract part def A;', 'A', { abstract: false }, 'part def A;'],
	['private part def A;', 'A', { abstract: true }, 'private abstract part def A;'],
	['private abstract part def A;', 'A', { abstract: false }, 'private part def A;'],
	['in part a;', 'a', { abstract: true }, 'in abstract part a;'],
	// The earlier engine wrote `readonly`, which the SysML v2 notation (and the toolkit) does not accept.
	['attribute x : Real;', 'x', { readonly: true }, 'constant attribute x : Real;'],
	['readonly attribute x : Real;', 'x', { readonly: false }, 'attribute x : Real;'],
	['attribute x : Real;', 'x', { derived: true }, 'derived attribute x : Real;'],
	// The earlier engine: `in readonly derived`; the notation orders direction, derived, abstract, constant.
	[
		'in attribute x : Real;',
		'x',
		{ derived: true, readonly: true },
		'in derived constant attribute x : Real;'
	],
	['derived ref attribute d : Real;', 'd', { derived: false }, 'ref attribute d : Real;'],
	['part def C { part a : A; }', 'a', { end: true }, 'part def C { end part a : A; }'],
	['part def C { end part a : A; }', 'a', { end: false }, 'part def C { part a : A; }'],
	['part def C { end e : E; }', 'e', { end: false }, 'part def C { e : E; }'],
	['#Tag part def A;', 'A', { abstract: true }, 'abstract #Tag part def A;'],
	['part def P { in m : Real; }', 'm', { end: true }, 'part def P { in end m : Real; }'],
	// layout
	['part a\n    : A\n    :> b;', 'a', { type: null }, 'part a\n    :> b;'],
	[
		'part a\n    : A\n    :> b;',
		'a',
		{ type: 'B', redefines: 'c' },
		'part a\n    : B\n    :> b :>> c;'
	],
	// short name
	['part def A;', 'A', { shortName: 'A1' }, "part def <'A1'> A;"],
	["part def <'A1'> A;", 'A', { shortName: 'A2' }, "part def <'A2'> A;"],
	["part def <'A1'> A;", 'A', { shortName: null }, 'part def A;'],
	['part a : A;', 'a', { shortName: 'x' }, "part <'x'> a : A;"],
	["requirement <'R1'> r : R;", 'r', { shortName: 'R-2' }, "requirement <'R-2'> r : R;"],
	['package P;', 'P', { shortName: 'p' }, "package <'p'> P;"],
	["package <'p'> P { }", 'P', { shortName: '' }, 'package P { }'],
	// quoting
	['part a;', 'a', { type: 'My Type' }, "part a : 'My Type';"],
	['part a;', 'a', { type: "Lib::'Odd name'::T" }, "part a : Lib::'Odd name'::T;"],
	['part a;', 'a', { specializes: ['part', 'b'] }, "part a :> 'part', b;"],
	[
		"attribute 'max speed' : Real;",
		'max speed',
		{ value: '10' },
		"attribute 'max speed' : Real = 10;"
	],
	[
		"part def 'Big Part';",
		'Big Part',
		{ specializes: ['Small Part'] },
		"part def 'Big Part' :> 'Small Part';"
	]
];

describe('declaration headers', () => {
	it.each(cases)('%s + %j', (src, element, set, want) => {
		expect(edit(src, element, set)).toBe(want);
	});

	it('sets several fields at once', () => {
		expect(
			edit('part def D { part a; }', 'a', {
				type: 'A',
				multiplicity: '[4]',
				specializes: ['b'],
				redefines: 'c',
				value: 'x',
				direction: 'in',
				abstract: true,
				shortName: 'a1'
			})
		).toBe("part def D { in abstract part <'a1'> a[4] : A :> b :>> c = x; }");
		expect(
			edit('port def P { attribute x : Real = 1; }', 'x', {
				type: 'Integer',
				multiplicity: '2',
				value: '3',
				valueKind: 'default',
				direction: 'out',
				readonly: true
			})
		).toBe('port def P { out constant attribute x[2] : Integer default = 3; }');
	});

	it('changes only what changes, and keeps comments', () => {
		const src =
			'part def D {\n    // four of them\n    part rotors : Rotor[4]; // each a motor\n}\n';
		const header = readHeader(src, src.indexOf('part rotors'))!;
		expect(planHeader(src, header, { multiplicity: '6' })).toEqual([
			{ from: src.indexOf('4]'), to: src.indexOf('4]') + 1, insert: '6' }
		]);
		expect(planHeader(src, header, { type: 'Rotor2' })).toEqual([
			{ from: src.indexOf('[4]'), to: src.indexOf('[4]'), insert: '2' }
		]);
		expect(
			edit('part def\n    A /* a */ :> B ;', 'A', { specializes: ['C'], abstract: true })
		).toBe('abstract part def\n    A /* a */ :> C ;');
	});

	it('says what a declaration cannot say', () => {
		expect(fails('part def A;', 'A', { type: 'T' })).toContain(
			'`type` cannot be set on a `part def`'
		);
		expect(fails('part def A;', 'A', { multiplicity: '2' })).toContain('multiplicity');
		expect(fails('part def A;', 'A', { value: '2' })).toContain('value');
		expect(fails('part def A;', 'A', { direction: 'in' })).toContain('direction');
		expect(fails('package P;', 'P', { specializes: ['Q'] })).toContain('specializes');
		expect(fails('package P;', 'P', { abstract: true })).toContain('abstract');
		expect(fails('state s;', 's', { value: '1' })).toContain('value');
		expect(fails('action a;', 'a', { shortName: 'A1' })).toContain('shortName');
		expect(fails('state s;', 's', { end: true })).toContain('end');
		expect(fails('part a;', 'a', { conjugated: true })).toContain('needs a type');
		expect(fails('part p defined by Q;', 'p', { conjugated: true })).toContain('defined by');
		expect(fails('part a;', 'a', { valueKind: 'default' })).toContain('needs a value');
		// Clearing what a declaration cannot have is fine.
		const src = 'part def A;';
		const header = readHeader(src, 0)!;
		expect(
			planHeader(src, header, {
				type: null,
				multiplicity: null,
				value: null,
				direction: null,
				readonly: false
			})
		).toEqual([]);
	});

	it('reads what is not a declaration as nothing', () => {
		expect(readHeader('satisfy A by b;', 0)).toBeNull();
		expect(readHeader('private import A::*;', 0)).toBeNull();
	});

	it('formats references', () => {
		expect(formatReference("Lib::'Odd name'::T")).toBe("Lib::'Odd name'::T");
		expect(formatReference('My Type')).toBe("'My Type'");
		expect(formatReference('a.b')).toBe('a.b');
		expect(() => formatReference('A::')).toThrow('not a valid reference');
	});
});

describe('doc comments', () => {
	it('writes one line as one line', () => {
		expect(blockComment('', null, 'An A.')).toBe('/* An A. */');
		expect(blockComment('', null, 'No */ here')).toBe('/* No * / here */');
	});

	it('lays new text out like the comment it replaces', () => {
		const src = '    doc /* One propulsion unit.\n         * Second line. */';
		const old = { start: src.indexOf('/*'), end: src.length };
		expect(blockComment(src, old, 'One unit.\nTwo.')).toBe('/* One unit.\n         * Two. */');
		const block = '    doc\n    /*\n     * The catalogue.\n     */';
		const b = { start: block.indexOf('/*'), end: block.length };
		expect(blockComment(block, b, 'New text.')).toBe('/*\n     * New text.\n     */');
	});

	it('reads the text of a comment back', () => {
		expect(commentText('/* A drone.\n         * Two lines. */')).toBe('A drone.\nTwo lines.');
		expect(commentText('/*\n     * The catalogue.\n     */')).toBe('The catalogue.');
	});
});
