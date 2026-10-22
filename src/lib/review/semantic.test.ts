import { describe, expect, it } from 'vitest';
import { compareSnapshots, matchElements, substituteNames } from './semantic';
import { commitMessage, markdownSummary, summarize } from './summary';
import type { ModelSnapshot, SnapCheck, SnapElement, SnapRelation } from './types';

let line = 1;
function el(id: string, fields: Partial<SnapElement> = {}): SnapElement {
	const name = fields.name ?? id;
	return {
		id,
		name,
		qualifiedName: fields.qualifiedName ?? name,
		title: name,
		label: name,
		kind: 'part',
		isDefinition: false,
		ownerId: null,
		category: 'design',
		props: {},
		body: `part : T;`,
		path: 'a.sysml',
		line: line++,
		from: 0,
		to: 10,
		...fields
	};
}

function rel(
	kind: SnapRelation['kind'],
	key: string,
	fields: Partial<SnapRelation> = {}
): SnapRelation {
	return {
		kind,
		key,
		text: key,
		ownerId: null,
		refs: [],
		category: 'design',
		path: 'a.sysml',
		line: 1,
		from: 0,
		to: 1,
		...fields
	};
}

function snap(fields: Partial<ModelSnapshot> = {}): ModelSnapshot {
	return {
		elements: [],
		relations: [],
		checks: [],
		budgets: [],
		values: {},
		brokenFiles: [],
		...fields
	};
}

const pkg = el('P', {
	kind: 'package',
	isDefinition: true,
	category: 'other',
	body: 'package { … }'
});
const rotor = el('Rotor', {
	ownerId: 'P',
	isDefinition: true,
	label: 'Rotor',
	body: 'part def :> Component { part motor : Motor; part esc : Esc; }'
});
const motor = el('Rotor::motor', {
	name: 'motor',
	ownerId: 'Rotor',
	label: 'Rotor.motor',
	props: { type: 'Motor' },
	body: 'part : Motor;'
});
const mass = el('Motor::mass', {
	name: 'mass',
	kind: 'attribute',
	ownerId: 'Motor',
	label: 'Motor.mass',
	props: { value: '120 g' },
	body: 'attribute :>> = 120 [g];'
});

describe('matching elements', () => {
	it('matches by id and reports nothing when nothing changed', () => {
		const base = snap({ elements: [pkg, rotor, motor, mass] });
		const diff = compareSnapshots(base, structuredClone(base));
		expect(diff.elements).toEqual([]);
		expect(diff.relations).toEqual([]);
		expect(summarize(diff).empty).toBe(true);
	});

	it('reports a changed value in plain language', () => {
		const base = snap({ elements: [pkg, mass] });
		const current = snap({ elements: [pkg, { ...mass, props: { value: '190 g' } }] });
		const diff = compareSnapshots(base, current);
		expect(diff.elements).toMatchObject([
			{ change: 'changed', properties: [{ property: 'value', before: '120 g', after: '190 g' }] }
		]);
		const [group] = summarize(diff).groups;
		expect(group?.title).toBe('Design');
		expect(group?.items[0]?.text).toBe('`Motor.mass` changed 120 g → `190 g`');
	});

	it('reports added and removed elements, folding their members into them', () => {
		const req = el('R11', {
			name: "'Noise at night'",
			title: 'Noise at night',
			label: 'SYS-011',
			kind: 'requirement',
			category: 'requirements',
			ownerId: 'P',
			props: { shortName: 'SYS-011' }
		});
		const priority = el('R11::priority', {
			name: 'priority',
			kind: 'attribute',
			ownerId: 'R11',
			category: 'requirements'
		});
		const diff = compareSnapshots(
			snap({ elements: [pkg, rotor, motor] }),
			snap({ elements: [pkg, rotor, req, priority] })
		);
		expect(diff.elements.map((c) => [c.change, (c.after ?? c.before)!.label, c.members])).toEqual([
			['added', 'SYS-011', ['attribute priority']],
			['removed', 'Rotor.motor', []]
		]);
		const summary = summarize(diff);
		expect(summary.groups.map((g) => g.title)).toEqual(['Requirements', 'Design']);
		expect(summary.groups[0]!.items[0]!.text).toBe(
			'Added requirement `SYS-011` ‘Noise at night’ to `P`'
		);
		expect(summary.counts).toMatchObject({ added: 1, removed: 1 });
	});

	it('finds a rename in the same owner, and members that only follow it', () => {
		const renamed = {
			...motor,
			id: 'Rotor::engine',
			name: 'engine',
			title: 'engine',
			label: 'Rotor.engine'
		};
		const child = el('Rotor::motor::id', {
			name: 'serial',
			kind: 'attribute',
			ownerId: 'Rotor::motor'
		});
		const childAfter = {
			...child,
			id: 'Rotor::engine::id',
			ownerId: 'Rotor::engine',
			props: { value: '7' }
		};
		const diff = compareSnapshots(
			snap({ elements: [pkg, rotor, motor, child] }),
			snap({ elements: [pkg, rotor, renamed, childAfter] })
		);
		expect(diff.elements.map((c) => [c.change, c.before?.label, c.after?.label])).toEqual([
			['renamed', 'Rotor.motor', 'Rotor.engine'],
			['changed', 'serial', 'serial']
		]);
		expect(summarize(diff).groups[0]!.items[0]!.text).toBe(
			'Renamed part `Rotor.motor` to `engine`'
		);
	});

	it('does not take two different elements for a rename', () => {
		const a = el('P::a', {
			name: 'a',
			ownerId: 'P',
			kind: 'attribute',
			body: 'attribute : Real = 1;'
		});
		const b = el('P::b', {
			name: 'b',
			ownerId: 'P',
			kind: 'attribute',
			body: 'attribute :> ISQ::length = 650 [mm] { doc /* frame */ }'
		});
		const c = el('P::c', {
			name: 'c',
			ownerId: 'P',
			kind: 'attribute',
			body: 'attribute : Real = 1;'
		});
		const diff = compareSnapshots(
			snap({ elements: [pkg, a, b] }),
			snap({
				elements: [
					pkg,
					b,
					c,
					el('P::d', {
						name: 'd',
						ownerId: 'P',
						kind: 'attribute',
						body: 'attribute : Boolean = true; // a flag'
					})
				]
			})
		);
		expect(diff.elements.map((x) => [x.change, x.before?.label, x.after?.label])).toEqual([
			['renamed', 'a', 'c'],
			['added', undefined, 'd']
		]);
	});

	it('finds a move to another owner, also into another file', () => {
		const power = el('Power', {
			kind: 'package',
			isDefinition: true,
			category: 'other',
			path: 'power.sysml'
		});
		const battery = el('P::Battery', {
			name: 'Battery',
			ownerId: 'P',
			isDefinition: true,
			body: 'part def { attribute capacity; }'
		});
		const moved = { ...battery, id: 'Power::Battery', ownerId: 'Power', path: 'power.sysml' };
		const diff = compareSnapshots(
			snap({ elements: [pkg, battery] }),
			snap({ elements: [pkg, power, moved] })
		);
		expect(
			diff.elements.map((c) => [c.change, c.before?.owner ?? null, c.after?.owner ?? null])
		).toEqual([
			['moved', 'P', 'Power'],
			['added', null, null]
		]);
		expect(summarize(diff).groups.flatMap((g) => g.items.map((i) => i.text))).toContain(
			'Moved part definition `Battery` from `P` to `Power`'
		);
	});

	it('reports a package that moved to another file once, not each element in it', () => {
		const moved = (e: SnapElement) => ({ ...e, path: 'b.sysml' });
		const diff = compareSnapshots(
			snap({ elements: [pkg, rotor, motor] }),
			snap({ elements: [pkg, rotor, motor].map(moved) })
		);
		expect(diff.elements.map((c) => [c.change, c.after?.label])).toEqual([['moved', 'P']]);
	});

	it('matches by id even when the text moved', () => {
		const shifted = { ...mass, line: 99, from: 500, to: 520 };
		const match = matchElements(snap({ elements: [mass] }), snap({ elements: [shifted] }));
		expect(match.how.get(mass.id)).toBe('same');
	});
});

describe('relationships', () => {
	it('reports added and removed connections, and keeps one whose end was renamed', () => {
		const base = snap({
			elements: [pkg, rotor, motor],
			relations: [
				rel('connect', 'connect esc to motor', { ownerId: 'Rotor', text: 'esc to motor' }),
				rel('connect', 'connect motor to propeller', {
					ownerId: 'Rotor',
					text: 'motor to propeller'
				})
			]
		});
		const engine = { ...motor, id: 'Rotor::engine', name: 'engine', label: 'Rotor.engine' };
		const current = snap({
			elements: [pkg, rotor, engine],
			relations: [
				rel('connect', 'connect esc to engine', { ownerId: 'Rotor', text: 'esc to engine' })
			]
		});
		const diff = compareSnapshots(base, current);
		expect(diff.relations).toMatchObject([
			{
				change: 'removed',
				relation: 'connect',
				text: 'motor to propeller',
				owner: 'Rotor',
				ownerId: 'Rotor'
			}
		]);
		expect(summarize(diff).groups[0]!.items.map((i) => i.text)).toContain(
			'Removed the connection `motor to propeller` in `Rotor`'
		);
	});

	it('matches a satisfy claim through its renamed requirement', () => {
		const req = el('R1', {
			name: "'Flight endurance'",
			kind: 'requirement',
			category: 'requirements',
			body: 'requirement <SYS-001> : R;'
		});
		const renamed = { ...req, id: 'R1b', name: "'Endurance'" };
		const claim = (name: string, refs: string[]) =>
			rel('satisfy', `satisfy ${name} by drone`, { refs, category: 'requirements' });
		const diff = compareSnapshots(
			snap({ elements: [req], relations: [claim("'Flight endurance'", ['R1'])] }),
			snap({ elements: [renamed], relations: [claim("'Endurance'", ['R1b'])] })
		);
		expect(diff.relations).toEqual([]);
		expect(diff.elements.map((c) => c.change)).toEqual(['renamed']);
	});

	it('folds relationships into an added owner', () => {
		const diff = compareSnapshots(
			snap({ elements: [pkg] }),
			snap({
				elements: [pkg, rotor],
				relations: [rel('connect', 'connect a to b', { ownerId: 'Rotor', text: 'a to b' })]
			})
		);
		expect(diff.relations).toEqual([]);
		expect(diff.elements[0]!.members).toEqual(['connect a to b']);
	});

	it('substitutes whole names only', () => {
		expect(
			substituteNames("connect motor to 'motor x'.motorA", new Map([['motor', 'engine']]))
		).toBe("connect engine to 'motor x'.motorA");
	});
});

describe('impact', () => {
	const check = (fields: Partial<SnapCheck>): SnapCheck => ({
		kind: 'satisfy',
		requirementId: 'R3',
		label: 'SYS-003',
		title: 'Maximum take-off mass',
		by: 'drone',
		subject: 'drone.takeOffMass',
		status: 'satisfied',
		reason: '3.77 kg ≤ 4 kg',
		margin: '230 g',
		path: 's.sysml',
		line: 3,
		from: 0,
		to: 5,
		...fields
	});

	it('puts verdict changes first, worded with the value against its limit', () => {
		const diff = compareSnapshots(
			snap({ checks: [check({})] }),
			snap({ checks: [check({ status: 'violated', reason: '4.05 kg > 4 kg', margin: '-50 g' })] })
		);
		expect(diff.verdicts).toMatchObject([{ before: 'satisfied', after: 'violated' }]);
		const summary = summarize(diff);
		expect(summary.impact[0]).toMatchObject({
			tone: 'fails',
			badge: 'Now fails',
			text: '`drone.takeOffMass` now violates `SYS-003` ‘Maximum take-off mass’ (4.05 kg > 4 kg)',
			target: 'R3'
		});
		expect(summary.counts.failing).toBe(1);
	});

	it('reports a margin that moved, a new failing check, but not a new met one', () => {
		const diff = compareSnapshots(
			snap({ checks: [check({})] }),
			snap({
				checks: [
					check({ margin: '50 g', reason: '3.95 kg ≤ 4 kg' }),
					check({
						requirementId: 'R11',
						label: 'SYS-011',
						status: 'violated',
						reason: '60 dB > 55 dB',
						subject: 'drone.noise'
					}),
					check({ requirementId: 'R12', label: 'SYS-012' })
				]
			})
		);
		expect(diff.verdicts.map((v) => [v.label, v.before, v.after, v.marginAfter])).toEqual([
			['SYS-011', null, 'violated', null],
			['SYS-003', 'satisfied', 'satisfied', '50 g']
		]);
	});

	it('reports computed values and budget totals that changed', () => {
		const base = snap({
			elements: [
				mass,
				el('drone::emptyMass', { name: 'emptyMass', kind: 'attribute', label: 'drone.emptyMass' })
			],
			values: { 'Motor::mass': '120 g', 'drone::emptyMass': '2.77 kg' },
			budgets: [{ view: 'mb', title: 'Drone mass budget', root: 'drone', total: '2.77 kg' }]
		});
		const current = structuredClone(base);
		current.elements[0]!.props.value = '190 g';
		current.values = { 'Motor::mass': '190 g', 'drone::emptyMass': '3.05 kg' };
		current.budgets[0]!.total = '3.05 kg';
		const diff = compareSnapshots(base, current);
		// The mass itself changed (a property change), its total is the impact.
		expect(diff.values.map((v) => [v.label, v.before, v.after])).toEqual([
			['drone.emptyMass', '2.77 kg', '3.05 kg']
		]);
		expect(summarize(diff).impact.map((i) => i.text)).toEqual([
			'Drone mass budget: `drone` adds up to `3.05 kg` (was 2.77 kg)',
			'`drone.emptyMass` is now `3.05 kg` (was 2.77 kg)'
		]);
	});
});

describe('messages', () => {
	it('suggests a commit message and a pull request description', () => {
		const base = snap({ elements: [pkg, rotor, motor, mass] });
		const current = snap({
			elements: [pkg, rotor, { ...mass, props: { value: '190 g' } }],
			checks: []
		});
		const summary = summarize(compareSnapshots(base, current));
		expect(commitMessage(summary).split('\n')).toEqual([
			'Remove part Rotor.motor; set Motor.mass to 190 g',
			'',
			'- Removed part Rotor.motor',
			'- Motor.mass changed 120 g → 190 g'
		]);
		expect(markdownSummary(summary)).toBe(
			[
				'### Design',
				'',
				'- **Removed:** Removed part `Rotor.motor`',
				'- **Changed:** `Motor.mass` changed 120 g → `190 g`'
			].join('\n')
		);
	});
});
