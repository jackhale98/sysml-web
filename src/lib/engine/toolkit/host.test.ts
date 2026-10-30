/**
 * The toolkit engine on the demo project, through the same code the worker
 * runs (`ToolkitHost`): the model adapter's output, the diagnostics, broken
 * text, and where the earlier engine and the toolkit disagreed (the
 * toolkit's answer is asserted, with the reason).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { buildTree, collectElements, type ModelElement } from '#lib/project/elements.ts';
import { collectRequirements } from '#lib/project/requirements.ts';
import type { Analysis } from '../types';
import type { ToolkitHost } from './host';
import { TextIndex } from './offsets';
import { demoFiles, loadHost } from './testing';

let host: ToolkitHost;
let analyses: Analysis[];
let elements: ModelElement[];
const files = demoFiles();
const text = (path: string) => files.find((f) => f.path === path)!.text;

beforeAll(async () => {
	host = await loadHost();
	analyses = host.analyzeProject(files);
	elements = collectElements(analyses);
}, 60_000);

const element = (path: string, name: string, parent?: string) =>
	elements.find((e) => e.file === path && e.name === name && (!parent || e.parent === parent));

describe('the demo, analysed by the toolkit', () => {
	it('has one analysis per file, in order', () => {
		expect(analyses.map((a) => a.model.file)).toEqual(files.map((f) => f.path));
	});

	it('finds no problems', () => {
		// The demo had two genuine ones, `estimate.takeOffMass` and `estimate.endurance` in
		// `DronePerformance`: the analyses' `subject estimate = drone;` had no type, so its
		// features didn't resolve. The subject is typed (`: DeliveryDrone`) now, which the
		// budgets need anyway; problems on broken text are tested below.
		const problems = analyses.flatMap((a) => [...a.model.syntax_errors, ...a.diagnostics]);
		expect(problems).toEqual([]);
	});

	it('reports an unresolved reference at its UTF-16 and byte range', () => {
		const path = 'analysis/Performance.sysml';
		const source = text(path).replaceAll(
			'subject estimate : DeliveryDrone = drone;',
			'subject estimate = drone;'
		);
		const result = host.analyzeProject(
			files.map((f) => (f.path === path ? { ...f, text: source } : f))
		);
		const [first, second] = result.find((a) => a.model.file === path)!.diagnostics;
		expect(first).toMatchObject({
			// A name that doesn't resolve is an error (KerML 8.2.3.5.1), though the toolkit says warning.
			severity: 'error',
			code: 'referential',
			message: 'unresolved reference `takeOffMass`',
			span: { start_row: 30 }
		});
		expect(second?.message).toBe('unresolved reference `endurance`');
		expect(source.slice(first!.span.from, first!.span.to)).toBe('takeOffMass');
		expect(new TextIndex(source).sliceBytes(first!.span.start_byte, first!.span.end_byte)).toBe(
			'takeOffMass'
		);
		host.analyzeProject(files);
	});

	it('does not report connected ports as unconnected (the earlier engine: 19 false W016)', () => {
		const all = analyses.flatMap((a) => a.diagnostics);
		expect(all.filter((d) => /never connected|not connected/.test(d.message))).toEqual([]);
	});

	it('resolves feature chains through performed actions (the earlier engine: 8 false W005)', () => {
		expect(
			analyses.find((a) => a.model.file === 'behaviour/Allocation.sysml')!.diagnostics
		).toEqual([]);
	});

	it('lists named definitions and usages with kinds, types and owners', () => {
		expect(elements.length).toBeGreaterThan(450);
		expect(element('system/Components.sysml', 'Component')).toMatchObject({
			kind: 'part',
			isDefinition: true,
			parent: 'DroneComponents'
		});
		expect(element('system/Components.sysml', 'Airframe')?.typeRef).toBe('Component');
		expect(element('system/DroneArchitecture.sysml', 'rotors')).toMatchObject({
			kind: 'part',
			isDefinition: false,
			typeRef: 'Rotor',
			multiplicity: '4',
			parent: 'drone'
		});
		// `:>> mass = 650 [g]` is named by what it redefines.
		expect(element('system/Components.sysml', 'mass', 'Airframe')).toMatchObject({
			kind: 'attribute',
			value: '650 [g]'
		});
		// Quoted names stay as written; short names and docs come along.
		expect(element('requirements/SystemRequirements.sysml', "'Flight endurance'")).toMatchObject({
			kind: 'requirement',
			label: 'Flight endurance',
			shortName: 'SYS-001',
			typeRef: 'DroneRequirement'
		});
		expect(element('system/Components.sysml', 'Battery')?.doc).toMatch(/^Six-cell lithium-ion/);
	});

	it('nests elements under their real owner (the earlier engine put `plan` under DeliveryFlight)', () => {
		expect(element('behaviour/DeliveryMission.sysml', 'plan')?.parent).toBe('flyToDropPoint');
		const tree = buildTree(elements);
		const components = tree.find((n) => n.element.name === 'DroneComponents')!;
		const battery = components.children.find((n) => n.element.name === 'Battery')!;
		expect(battery.children.map((n) => n.element.name)).toEqual([
			'mass',
			'nominalVoltage',
			'capacity',
			'usableFraction',
			'usableEnergy',
			'price',
			'failureRate',
			'powerOut'
		]);
	});

	it('gives spans as bytes, UTF-16 offsets and lines of the whole declaration', () => {
		const rotors = element('system/DroneArchitecture.sysml', 'rotors')!;
		const source = text('system/DroneArchitecture.sysml');
		expect(source.slice(rotors.span.from, rotors.span.to)).toBe(
			'ref part rotors : Rotor[4] = (frontLeft, frontRight, rearLeft, rearRight);'
		);
		expect(rotors.span.start_row).toBe(source.slice(0, rotors.span.from).split('\n').length);
	});

	it('types ports by their conjugate as `~P`, written `P` with a flag', () => {
		const usage = analyses
			.find((a) => a.model.file === 'system/Components.sysml')!
			.model.usages.find((u) => u.name === 'powerIn' && u.parent_def === 'PowerDistributionBoard');
		expect(usage).toMatchObject({ type_ref: 'PowerPort', is_conjugated: true });
	});

	it('reads satisfy, verify and metadata from the resolved model', () => {
		const requirements = collectRequirements(analyses);
		// 6 stakeholder needs, 11 system requirements, 7 risk controls, a reliability requirement.
		expect(requirements).toHaveLength(25);
		const endurance = requirements.find((r) => r.id === 'SYS-001')!;
		expect(endurance).toMatchObject({
			title: 'Flight endurance',
			kind: 'performance',
			priority: 'high',
			verificationMethods: ['analysis', 'test'],
			status: 'done',
			owner: 'J. Hale',
			satisfiedBy: ['drone'],
			verifiedBy: ['enduranceFlightTest']
		});
		expect(endurance.rationale).toMatch(/^A 3 km delivery/);
		expect(requirements.find((r) => r.id === 'SYS-002')?.satisfiedBy).toEqual(['drone']);
		expect(requirements.find((r) => r.id === 'SYS-011')?.satisfiedBy).toEqual([
			'drone.payloadRelease'
		]);
		// The two open gaps the demo describes.
		const unsatisfied = requirements.filter((r) => r.satisfiedBy.length === 0).map((r) => r.id);
		expect(unsatisfied).toEqual(expect.arrayContaining(['SYS-005', 'SYS-006']));
		const fmea = analyses.find((a) => a.model.file === 'risk/DesignFmea.sysml')!.model;
		expect(fmea.annotations?.[0]).toMatchObject({
			metadata_type: 'Fmea',
			target: 'drone::battery'
		});
		expect(fmea.satisfactions.map((s) => s.by)).toContain('batteryManagementSystem');
	});

	it('lists `connect` statements with their ends as written', () => {
		const architecture = analyses.find((a) => a.model.file === 'system/DroneArchitecture.sysml')!;
		expect(architecture.model.connections?.[0]).toMatchObject({
			name: 'batteryPower',
			type_ref: 'PowerSupply',
			source: 'battery.powerOut',
			target: 'powerDistribution.powerIn'
		});
	});

	it('answers elementDetails for the inspector', () => {
		const component = element('system/Components.sysml', 'Component')!;
		expect(
			host.elementDetails(files, component.file, component.span.start_row, 'Component')
		).toMatchObject({
			name: 'Component',
			kind: 'part',
			isDefinition: true,
			abstract: true,
			qualifiedName: 'DroneComponents::Component',
			doc: expect.stringMatching(/^Anything built into the drone/)
		});
		const mass = element('system/Components.sysml', 'mass', 'Airframe')!;
		expect(host.elementDetails(files, mass.file, mass.span.start_row, 'mass')).toMatchObject({
			kind: 'attribute',
			redefines: 'mass',
			value: '650 [g]',
			valueKind: 'bind'
		});
		const endurance = element('requirements/SystemRequirements.sysml', "'Flight endurance'")!;
		expect(
			host.elementDetails(files, endurance.file, endurance.span.start_row, "'Flight endurance'")
		).toMatchObject({ shortName: 'SYS-001', type: 'DroneRequirement', kind: 'requirement' });
		const takeOff = element('system/DroneArchitecture.sysml', 'takeOffMass')!;
		expect(
			host.elementDetails(files, takeOff.file, takeOff.span.start_row, 'takeOffMass')
		).toMatchObject({
			specializes: ['mass'],
			value: 'emptyMass + payloadCapacity'
		});
		expect(() => host.elementDetails(files, 'system/Components.sysml', 1, 'Nope')).toThrow(
			/not found/
		);
	});

	it('re-analyses an edit', () => {
		const path = 'system/Components.sysml';
		const edited = files.map((f) =>
			f.path === path ? { ...f, text: f.text.replace('650 [g]', '700 [g]') } : f
		);
		const again = collectElements(host.analyzeProject(edited));
		expect(
			again.find((e) => e.file === path && e.name === 'mass' && e.parent === 'Airframe')?.value
		).toBe('700 [g]');
		host.analyzeProject(files);
	});

	it('reports a parse error at the right UTF-16 offset after multi-byte text', () => {
		const unit = 'package Wärme {}';
		const [analysis] = host.analyzeProject([{ path: 'w.sysml', text: unit }]);
		const [error] = analysis!.model.syntax_errors;
		expect(error?.message).toBe('unexpected character `ä`');
		expect(unit.slice(error!.span.from, error!.span.to)).toBe('ä');
		host.analyzeProject(files);
	});
});

describe('broken text', () => {
	const path = 'system/Components.sysml';
	const original = text(path);
	const batteryEnd = original.indexOf('\n    }', original.indexOf('part def Battery'));
	const analyse = (edited: string) =>
		host.analyzeProject(files.map((f) => (f.path === path ? { ...f, text: edited } : f)));
	const problemsOf = (result: Analysis[]) => ({
		syntax: result.flatMap((a) => a.model.syntax_errors),
		diagnostics: result.flatMap((a) => a.diagnostics)
	});

	it('keeps the real error and hides the follow-on noise of an unclosed brace', () => {
		// Opened broken (no text of it parsed before): the toolkit's repair re-nests every later
		// definition and, without the policy, 40 references break.
		const moved = 'system/Components-opened-broken.sysml';
		const { syntax, diagnostics } = problemsOf(
			host.analyzeProject([
				...files.filter((f) => f.path !== path),
				{ path: moved, text: original.slice(0, batteryEnd) + original.slice(batteryEnd + 6) }
			])
		);
		expect(syntax).toHaveLength(1);
		expect(syntax[0]!.message).toMatch(/expected `}`.*\(\d+ follow-on problems are hidden/);
		expect(diagnostics).toEqual([]);
	});

	it('while a file doesn’t parse, keeps its model as it last parsed', () => {
		const before = collectElements(analyse(original)).filter((e) => e.file === path);
		// An unclosed brace typed in the middle: the toolkit's repair would cut out what it is in.
		const at = original.indexOf('\n', original.indexOf('part def Battery')) + 1;
		const typed = '        part spare : Battery {\n';
		const result = analyse(original.slice(0, at) + typed + original.slice(at));
		const { syntax, diagnostics } = problemsOf(result);
		expect(syntax).toHaveLength(1);
		expect(diagnostics).toEqual([]);
		const after = collectElements(result).filter((e) => e.file === path);
		expect(after.map((e) => e.id)).toEqual(before.map((e) => e.id));
		// In the text as it is now: past the typing, everything moved by what was typed.
		const shift = (e: ModelElement) => (e.span.from! >= at ? typed.length : 0);
		expect(after.map((e) => e.span.from)).toEqual(before.map((e) => e.span.from! + shift(e)));
		host.analyzeProject(files);
	});

	it('reads a file that starts with a byte-order mark, and keeps the mark through an edit', () => {
		const unit = '\uFEFFpackage B {\n    part def A;\n    part a : A;\n    part n : Nope;\n}\n';
		const result = host.analyzeProject([{ path: 'b.sysml', text: unit }]);
		expect(result[0]!.model.syntax_errors).toEqual([]);
		const [finding] = result[0]!.diagnostics;
		expect(finding?.message).toBe('unresolved reference `Nope`');
		expect(unit.slice(finding!.span.from, finding!.span.to)).toBe('Nope');
		expect(new TextIndex(unit).sliceBytes(finding!.span.start_byte, finding!.span.end_byte)).toBe(
			'Nope'
		);
		const a = collectElements(result).find((e) => e.name === 'a')!;
		expect(unit.slice(a.span.from, a.span.to)).toBe('part a : A;');
		// An edit of the model: the mark stays, nothing else moves.
		const edited = host.edit({
			op: 'rename',
			path: 'b.sysml',
			source: unit,
			id: collectElements(result).find((e) => e.name === 'A')!.id,
			from: 'A',
			to: 'Axle',
			line: 2,
			files: [{ path: 'b.sysml', text: unit }]
		});
		let text = unit;
		for (const c of [...edited.changes].sort((x, y) => y.from - x.from))
			text = text.slice(0, c.from) + c.insert + text.slice(c.to);
		expect(text).toBe(unit.replace('part def A;', 'part def Axle;').replace(': A;', ': Axle;'));
		host.analyzeProject(files);
	});

	it('shows only the first of a burst of parse errors, at the right place', () => {
		const edited =
			original.slice(0, batteryEnd) + '\n        part x : ' + original.slice(batteryEnd);
		const result = analyse(edited);
		const { syntax } = problemsOf(result);
		expect(syntax).toHaveLength(1);
		expect(syntax[0]!.message).toMatch(/^missing `;`/);
		expect(syntax[0]!.span.start_row).toBe(
			edited.slice(0, edited.indexOf('part x')).split('\n').length
		);
		// The model of the broken file is still there, in the person's text's positions.
		const els = collectElements(result);
		const pdb = els.find((e) => e.file === path && e.name === 'PowerDistributionBoard')!;
		expect(
			edited.slice(pdb.span.from, pdb.span.from! + 'part def PowerDistributionBoard'.length)
		).toBe('part def PowerDistributionBoard');
	});

	it('keeps a missing `;` to one error', () => {
		const { syntax, diagnostics } = problemsOf(
			analyse(original.replace('port powerOut : PowerPort;', 'port powerOut : PowerPort'))
		);
		expect(syntax).toHaveLength(1);
		expect(syntax[0]!.span.start_row).toBe(47);
		// `powerOut` (dropped by the repair) no longer resolving elsewhere is hidden too.
		expect(diagnostics).toEqual([]);
	});

	it('reports positions in UTF-16 for text with multi-byte characters', () => {
		const unit = "package 'Wärme' {\n    part def 'Ölpumpe😀';\n    part p : Nope;\n}\n";
		const result = host.analyzeProject([{ path: 'w.sysml', text: unit }]);
		const [finding] = result[0]!.diagnostics;
		expect(finding?.message).toBe('unresolved reference `Nope`');
		expect(unit.slice(finding!.span.from, finding!.span.to)).toBe('Nope');
		const pump = collectElements(result).find((e) => e.label === 'Ölpumpe😀')!;
		expect(pump.name).toBe("'Ölpumpe😀'");
		expect(unit.slice(pump.span.from, pump.span.to)).toBe("part def 'Ölpumpe😀';");
		host.analyzeProject(files);
	});

	it('reports a parse error at the right UTF-16 offset after multi-byte text', () => {
		const unit = 'package Wärme {}';
		const [analysis] = host.analyzeProject([{ path: 'w.sysml', text: unit }]);
		const [error] = analysis!.model.syntax_errors;
		expect(error?.message).toBe('unexpected character `ä`');
		expect(unit.slice(error!.span.from, error!.span.to)).toBe('ä');
		host.analyzeProject(files);
	});
});
