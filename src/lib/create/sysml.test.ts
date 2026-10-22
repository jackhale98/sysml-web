import { describe, expect, it } from 'vitest';
import {
	References,
	camelName,
	docComment,
	imports,
	numberText,
	pascalName,
	quantityText,
	uniqueName,
	withImports,
	words
} from './sysml';

describe('names and words', () => {
	it('reads a name as words', () => {
		expect(words('takeOffMass')).toBe('take off mass');
		expect(words("'Maximum take-off mass'")).toBe('maximum take-off mass');
		expect(words('powerDraw')).toBe('power draw');
		expect(words('GNSSReceiver')).toBe('GNSS receiver');
	});

	it('makes identifiers from titles', () => {
		expect(camelName('Mass budget')).toBe('massBudget');
		expect(camelName('  Drone — ICD v2 ')).toBe('droneICDV2');
		expect(camelName('')).toBe('item');
		expect(camelName('2nd study')).toBe('_2ndStudy');
		expect(pascalName('motor choice')).toBe('MotorChoice');
		expect(camelName('Café crème')).toBe('cafeCreme');
	});

	it('finds a free name', () => {
		expect(uniqueName('a', ['b'])).toBe('a');
		expect(uniqueName('a', ['a', 'a2'])).toBe('a3');
	});

	it('writes numbers and quantities as SysML', () => {
		expect(numberText(4)).toBe('4');
		expect(numberText(4, true)).toBe('4.0');
		expect(numberText(0.1 + 0.2)).toBe('0.3');
		expect(numberText(1e-7)).not.toMatch(/e/);
		expect(quantityText(4, 'kg')).toBe('4 [kg]');
		expect(quantityText(260, null)).toBe('260.0');
		expect(quantityText(222, 'W*h')).toBe('222 [W*h]');
	});

	it('keeps a doc comment closed', () => {
		expect(docComment('a */ b\n c')).toBe('doc /* a * / b c */');
	});
});

describe('imports', () => {
	const pkg = (text: string) => ({
		qualifiedName: 'P',
		from: text.indexOf('package'),
		to: text.length
	});

	it('knows what a package imports already', () => {
		const text = 'package P {\n    private import SI::*;\n    private import A::b;\n}';
		expect(imports(text, 'SI::kg')).toBe(true);
		expect(imports(text, 'A::b')).toBe(true);
		expect(imports(text, 'A::c')).toBe(false);
	});

	it('adds them after the last import', () => {
		const text = 'package P {\n    doc /* d */\n\n    private import SI::*;\n\n    part a;\n}\n';
		expect(withImports(text, pkg(text), ['SI::kg', 'ISQ::*', 'ISQ::*'])).toBe(
			'package P {\n    doc /* d */\n\n    private import SI::*;\n    private import ISQ::*;\n\n    part a;\n}\n'
		);
	});

	it('adds them after the doc, or at the top of the body', () => {
		const doc = 'package P {\n    doc /* d */\n\n    part a;\n}\n';
		expect(withImports(doc, pkg(doc), ['X::y'])).toBe(
			'package P {\n    doc /* d */\n\n    private import X::y;\n\n    part a;\n}\n'
		);
		const tight = 'package P {\n    doc /* d */\n    part a;\n}\n';
		expect(withImports(tight, pkg(tight), ['X::y'])).toBe(
			'package P {\n    doc /* d */\n\n    private import X::y;\n\n    part a;\n}\n'
		);
		const bare = 'package P {\n    part a { part b; }\n}\n';
		expect(withImports(bare, pkg(bare), ['X::y'])).toBe(
			'package P {\n    private import X::y;\n\n    part a { part b; }\n}\n'
		);
		const empty = 'package P {\n}\n';
		expect(withImports(empty, pkg(empty), ['X::y'])).toBe(
			'package P {\n    private import X::y;\n}\n'
		);
	});

	it('only touches the package it is given', () => {
		const text = 'package A {\n    private import SI::*;\n}\npackage P {\n    part p;\n}\n';
		const at = { qualifiedName: 'P', from: text.indexOf('package P'), to: text.length };
		expect(withImports(text, at, ['SI::*'])).toBe(
			'package A {\n    private import SI::*;\n}\npackage P {\n    private import SI::*;\n\n    part p;\n}\n'
		);
	});

	it('spells references the way the demo does', () => {
		const refs = new References('Study', ['options']);
		expect(refs.name('Rover::Motor')).toBe('Motor');
		expect(refs.name('Study::options')).toBe('options');
		expect(refs.reference({ imports: 'Rover::system', text: 'system.motor' })).toBe('system.motor');
		expect(refs.name('Other::Motor')).toBe('Other::Motor');
		refs.library('SI::*');
		expect(refs.imports).toEqual(['Rover::Motor', 'Rover::system', 'SI::*']);
	});
});
