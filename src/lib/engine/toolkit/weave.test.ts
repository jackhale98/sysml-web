/**
 * A merge with a server's changes, brought into the project's text: the
 * project exported, the base and the head as a server holds them (its own ids,
 * kept from version to version), the planner (`#lib/exchange/merge.ts`) and
 * the weave (`weave.ts`), through the code the worker runs.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readElements, rebaseIds, withIds, type ElementJson } from '#lib/exchange/elements.ts';
import { planMerge, resolveMerge, type Side } from '#lib/exchange/merge.ts';
import type { SourceFile } from '../protocol';
import type { ToolkitHost } from './host';
import { demoFiles, loadHost } from './testing';
import { countNotes } from './weave';

let host: ToolkitHost;
beforeAll(async () => {
	host = await loadHost();
}, 60_000);

const BASE = `package Garage {
    // How the garage is laid out.
    part def Vehicle {
        attribute mass : ScalarValues::Real; // in kg
    }
    part def Engine;

    part car : Vehicle {
        part engine : Engine;
    }
}
`;

let serial = 0;
/** A model as the server holds it: its own ids, kept for what stays in place. */
function onServer(text: string | SourceFile[], previous?: ElementJson[]): ElementJson[] {
	const files = typeof text === 'string' ? [{ path: 'Garage.sysml', text }] : text;
	const exported = readElements(host.exportInterchange(files, {}).json);
	const prefix = `5e${String(++serial).padStart(6, '0')}`;
	let n = 0;
	const fresh = () => `${prefix}-0000-4000-8000-${String(++n).padStart(12, '0')}`;
	if (previous) return rebaseIds(renumber(exported, fresh), previous, fresh).elements;
	return renumber(exported, fresh);
}

function renumber(elements: ElementJson[], fresh: () => string): ElementJson[] {
	const ids = new Map(elements.map((e) => [e['@id'], fresh()]));
	return elements.map((e) => withIds(e, ids));
}

/** Merge `theirs` (a text saved on the server after `base`) into `mine`; gives the files after. */
function merge(
	base: string,
	mine: string,
	theirs: string,
	choices: Record<string, Side> | Side = {}
) {
	const serverBase = onServer(base);
	const serverHead = onServer(theirs, serverBase);
	const files: SourceFile[] = [{ path: 'Garage.sysml', text: mine }];
	const inputs = host.mergeInputs(files, serverBase, serverHead);
	const plan = planMerge(inputs.base, inputs.ours, inputs.theirs, {
		nameOf: (id) => inputs.names[id]
	});
	const decided =
		typeof choices === 'string'
			? Object.fromEntries(plan.conflicts.map((c) => [c.id, choices]))
			: choices;
	const merged = resolveMerge(plan, decided);
	const woven = host.weaveInterchange(files, merged);
	const text = woven.files.find((f) => f.path === 'Garage.sysml')?.text ?? mine;
	return { plan, woven, text };
}

describe('bringing their changes into the text', () => {
	it('adds what they added where it goes, keeping notes and layout', () => {
		const theirs = BASE.replace(
			'    part def Engine;\n',
			'    part def Engine;\n    part def Trailer;\n'
		);
		const { plan, woven, text } = merge(BASE, BASE, theirs);
		expect(plan.incoming).toEqual([
			{ kind: 'added', what: 'part def Trailer', where: 'Garage', details: [] }
		]);
		expect(text).toBe(theirs);
		expect(woven.rewritten).toEqual([]);
		expect(woven.differences).toEqual([]);
	});

	it('takes out what they removed, with its lines', () => {
		const theirs = BASE.replace('        part engine : Engine;\n', '');
		const { text, woven } = merge(BASE, BASE, theirs);
		expect(text).toBe(theirs);
		expect(woven.differences).toEqual([]);
	});

	it('renames as the editor does: the name and its references', () => {
		const theirs = BASE.replace('part def Engine;', 'part def Motor;').replace(
			': Engine;',
			': Motor;'
		);
		const { text, woven } = merge(BASE, BASE, theirs);
		expect(text).toBe(theirs);
		expect(woven.rewritten).toEqual([]);
	});

	it('writes a changed declaration again, and says what it lost', () => {
		const theirs = BASE.replace(
			'        attribute mass : ScalarValues::Real; // in kg\n',
			'        attribute mass : ScalarValues::Real;\n        attribute length : ScalarValues::Real;\n'
		).replace('part def Vehicle {', 'abstract part def Vehicle {');
		const { text, woven } = merge(BASE, BASE, theirs);
		expect(text).toContain(
			'    abstract part def Vehicle {\n        attribute mass : ScalarValues::Real;\n        attribute length : ScalarValues::Real;\n    }'
		);
		// The rest of the file is as it was.
		expect(text).toContain('// How the garage is laid out.');
		expect(text).toContain('\n\n    part car : Vehicle {');
		expect(woven.rewritten).toEqual([
			{ path: 'Garage.sysml', element: 'Garage::Vehicle', notes: 1 }
		]);
		expect(woven.differences).toEqual([]);
	});

	it('adds next to a declaration it writes again', () => {
		const theirs = BASE.replace(
			'    part def Engine;\n',
			'    abstract part def Engine;\n    part def Trailer;\n'
		);
		const { text, woven } = merge(BASE, BASE, theirs);
		expect(text).toBe(theirs);
		expect(woven.rewritten).toEqual([
			{ path: 'Garage.sysml', element: 'Garage::Engine', notes: 0 }
		]);
	});

	it('merges their change with mine in the same file', () => {
		const mine = BASE.replace(
			'    part def Engine;\n',
			'    part def Engine;\n    part def Wheel;\n'
		);
		const theirs = BASE.replace(
			'part car : Vehicle {',
			'part car : Vehicle {\n        part trunk;'
		);
		const { plan, text } = merge(BASE, mine, theirs);
		expect(plan.outgoing).toEqual([
			{ kind: 'added', what: 'part def Wheel', where: 'Garage', details: [] }
		]);
		expect(plan.incoming).toEqual([
			{ kind: 'added', what: 'part trunk', where: 'Garage::car', details: [] }
		]);
		expect(text).toBe(
			mine.replace('part car : Vehicle {', 'part car : Vehicle {\n        part trunk;')
		);
	});

	it('keeps mine or takes theirs where both renamed the same definition', () => {
		const mine = BASE.replace('part def Engine;', 'part def Motor;').replace(
			': Engine;',
			': Motor;'
		);
		const theirs = BASE.replace('part def Engine;', 'part def PowerUnit;').replace(
			': Engine;',
			': PowerUnit;'
		);
		const kept = merge(BASE, mine, theirs, 'mine');
		expect(kept.plan.conflicts).toMatchObject([
			{
				kind: 'both-changed',
				what: 'part def Motor',
				mine: ['name: “Motor”'],
				theirs: ['name: “PowerUnit”']
			}
		]);
		expect(kept.text).toBe(mine);
		expect(kept.woven.files).toEqual([]);
		const taken = merge(BASE, mine, theirs, 'theirs');
		expect(taken.text).toBe(theirs);
	});

	it('removes what they removed, or keeps my change to it', () => {
		const mine = BASE.replace('part engine : Engine;', 'part engine : Engine[2];');
		const theirs = BASE.replace(/\n {4}part car : Vehicle \{\n.*\n {4}\}/, '');
		const kept = merge(BASE, mine, theirs, 'mine');
		expect(kept.plan.conflicts).toMatchObject([
			{ kind: 'removed-by-them', what: 'part car', theirs: ['removed it'] }
		]);
		expect(kept.text).toBe(mine);
		const taken = merge(BASE, mine, theirs, 'theirs');
		expect(taken.text).toBe(theirs);
	});

	it('writes a file they added', () => {
		const serverBase = onServer(BASE);
		const added = readElements(
			host.exportInterchange(
				[
					{ path: 'Garage.sysml', text: BASE },
					{ path: 'Shed.sysml', text: 'package Shed {\n    part def Mower;\n}\n' }
				],
				{}
			).json
		);
		const head = rebaseIds(added, serverBase).elements;
		const files: SourceFile[] = [{ path: 'Garage.sysml', text: BASE }];
		const inputs = host.mergeInputs(files, serverBase, head);
		const plan = planMerge(inputs.base, inputs.ours, inputs.theirs);
		expect(plan.incoming).toEqual([
			{ kind: 'added', what: 'package Shed', where: '', details: ['in a new file'] }
		]);
		const woven = host.weaveInterchange(files, resolveMerge(plan));
		expect(woven.files).toEqual([
			{ path: 'Shed.sysml', text: 'package Shed {\n    part def Mower;\n}\n', status: 'added' }
		]);
	});

	it('counts notes, not comments or strings', () => {
		expect(countNotes('part a; // one\n/* not // this */ doc /* nor */ "x // y" // two')).toBe(2);
	});
});

describe('on a large model', () => {
	it('brings their changes into the demo, touching only where they go', () => {
		const demo = demoFiles();
		const edit = (files: SourceFile[], path: string, from: string, to: string) =>
			files.map((f) => {
				if (f.path !== path) return f;
				expect(f.text).toContain(from);
				return { path, text: f.text.replace(from, to) };
			});
		const components = 'system/Components.sysml';
		let theirs = edit(
			demo,
			components,
			'attribute :>> mass = 650 [g];',
			'attribute :>> mass = 700 [g];'
		);
		const parachute =
			'    part def Parachute :> Component {\n        attribute :>> mass = 300 [g];\n    }\n\n';
		theirs = edit(
			theirs,
			components,
			'    part def PowerDistributionBoard',
			`${parachute}    part def PowerDistributionBoard`
		);
		const mine = edit(
			demo,
			'system/DroneArchitecture.sysml',
			'package DroneArchitecture {',
			'package DroneArchitecture {\n    // A note of mine.'
		);

		const started = performance.now();
		const serverBase = onServer(demo);
		const serverHead = onServer(theirs, serverBase);
		const inputs = host.mergeInputs(mine, serverBase, serverHead);
		const plan = planMerge(inputs.base, inputs.ours, inputs.theirs, {
			nameOf: (id) => inputs.names[id]
		});
		expect(plan.conflicts).toEqual([]);
		expect(plan.outgoing).toEqual([]);
		expect(plan.incoming).toEqual(
			expect.arrayContaining([
				{ kind: 'added', what: 'part def Parachute', where: 'DroneComponents', details: [] },
				expect.objectContaining({ kind: 'changed', where: 'DroneComponents::Airframe' })
			])
		);
		const woven = host.weaveInterchange(mine, resolveMerge(plan));
		const ms = performance.now() - started;
		expect(woven.differences).toEqual([]);
		expect(woven.files.map((f) => f.path)).toEqual([components]);
		// What is written again names units as the toolkit prints them (`gram`, not `g`).
		const want = theirs
			.find((f) => f.path === components)!
			.text.replace('mass = 700 [g]', 'mass = 700 [gram]')
			.replace('mass = 300 [g]', 'mass = 300 [gram]');
		expect(woven.files[0]!.text).toBe(want);
		// A few seconds at most, here as in the worker.
		expect(ms).toBeLessThan(20_000);
	}, 60_000);
});
