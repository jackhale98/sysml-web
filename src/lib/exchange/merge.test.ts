/**
 * The three-way merge of element models (`merge.ts`): the base, this
 * project ("mine", with other ids, as the engine exports it) and the server's
 * head ("theirs", the server's ids).
 */
import { describe, expect, it } from 'vitest';
import { isRef, nameOf, ownerOf, type ElementJson } from './elements';
import { isQuiet, kindWord, mergeOrder, planMerge, resolveMerge, type Side } from './merge';

/** A small model as element JSON: memberships, elements and typings, with lists both ways. */
class Model {
	readonly elements: ElementJson[] = [];
	private n = 0;
	constructor(private readonly prefix: string) {
		this.root = this.make({
			'@type': 'Namespace',
			ownedRelationship: [],
			owningRelationship: null
		});
	}
	readonly root: string;

	private make(e: Omit<ElementJson, '@id'>): string {
		const id = `${this.prefix}-${String(++this.n).padStart(4, '0')}`;
		this.elements.push({ '@id': id, ...e } as ElementJson);
		return id;
	}
	get(id: string): ElementJson {
		return this.elements.find((e) => e['@id'] === id)!;
	}
	/** A member of `owner`: a membership and the element it owns. */
	add(
		owner: string,
		type: string,
		name: string | null,
		extra: Record<string, unknown> = {}
	): string {
		const usage = type.endsWith('Usage');
		const membership = this.make({
			'@type': usage ? 'FeatureMembership' : 'OwningMembership',
			owningRelatedElement: { '@id': owner },
			ownedRelatedElement: [],
			visibility: 'public'
		});
		const id = this.make({
			'@type': type,
			declaredName: name,
			owningRelationship: { '@id': membership },
			ownedRelationship: [],
			...extra
		});
		(this.get(membership).ownedRelatedElement as unknown[]).push({ '@id': id });
		(this.get(owner).ownedRelationship as unknown[]).push({ '@id': membership });
		return id;
	}
	/** `feature : type`. */
	type(feature: string, type: string): string {
		const id = this.make({
			'@type': 'FeatureTyping',
			owningRelatedElement: { '@id': feature },
			typedFeature: { '@id': feature },
			type: { '@id': type }
		});
		(this.get(feature).ownedRelationship as unknown[]).push({ '@id': id });
		return id;
	}
}

/** The garage: package Garage { part def Vehicle; part def Engine; part car : Vehicle { part engine : Engine; } }. */
function garage(prefix: string) {
	const m = new Model(prefix);
	const pkg = m.add(m.root, 'Package', 'Garage');
	const vehicle = m.add(pkg, 'PartDefinition', 'Vehicle');
	const engine = m.add(pkg, 'PartDefinition', 'Engine');
	const car = m.add(pkg, 'PartUsage', 'car');
	m.type(car, vehicle);
	const carEngine = m.add(car, 'PartUsage', 'engine');
	m.type(carEngine, engine);
	return { m, pkg, vehicle, engine, car, carEngine };
}

const clone = (es: ElementJson[]): ElementJson[] => structuredClone(es);
const byName = (es: ElementJson[], name: string) => es.find((e) => e.declaredName === name)!;
/** Remove an element, what it owns and its membership. */
function remove(es: ElementJson[], name: string): ElementJson[] {
	const target = byName(es, name);
	const membership = ownerOf(target)!;
	const owner = ownerOf(es.find((e) => e['@id'] === membership)!)!;
	const gone = new Set([membership]);
	for (let grew = true; grew;) {
		grew = false;
		for (const e of es) {
			const up = ownerOf(e);
			if (!gone.has(e['@id']) && up && gone.has(up)) {
				gone.add(e['@id']);
				grew = true;
			}
		}
	}
	const parent = es.find((e) => e['@id'] === owner)!;
	parent.ownedRelationship = (parent.ownedRelationship as { '@id': string }[]).filter(
		(r) => r['@id'] !== membership
	);
	return es.filter((e) => !gone.has(e['@id']));
}
/** Add a member to the element named `owner` (ids from `prefix`). */
function addTo(es: ElementJson[], owner: string, type: string, name: string, prefix: string) {
	const parent = byName(es, owner);
	const membership: ElementJson = {
		'@id': `${prefix}-m`,
		'@type': 'OwningMembership',
		owningRelatedElement: { '@id': parent['@id'] },
		ownedRelatedElement: [{ '@id': `${prefix}-e` }],
		visibility: 'public'
	};
	const element: ElementJson = {
		'@id': `${prefix}-e`,
		'@type': type,
		declaredName: name,
		owningRelationship: { '@id': membership['@id'] },
		ownedRelationship: []
	};
	(parent.ownedRelationship as unknown[]).push({ '@id': membership['@id'] });
	es.push(membership, element);
	return element;
}
/** The typing of the feature named `name`. */
const typingOf = (es: ElementJson[], name: string) =>
	es.find(
		(e) =>
			e['@type'] === 'FeatureTyping' &&
			isRef(e.typedFeature) &&
			e.typedFeature['@id'] === byName(es, name)['@id']
	)!;

/** Base on the server, mine (other ids) and theirs (the server's ids) from one model. */
function three() {
	const base = garage('srv');
	const mine = garage('own');
	return { base: base.m.elements, mine: clone(mine.m.elements), theirs: clone(base.m.elements) };
}

/** Names of the named elements of a model with their owners' names: `Garage::car`. */
function names(es: ElementJson[]): string[] {
	const byId = new Map(es.map((e) => [e['@id'], e]));
	const path = (e: ElementJson): string => {
		const owner = ownerOf(e);
		const up = owner ? byId.get(owner) : undefined;
		const before = up ? path(up) : '';
		const name = e['@type'].endsWith('Membership') ? null : nameOf(e);
		return name ? (before ? `${before}::${name}` : name) : before;
	};
	return [...new Set(es.filter((e) => nameOf(e)).map(path))].sort();
}

const resolve = (
	base: ElementJson[],
	mine: ElementJson[],
	theirs: ElementJson[],
	choices: Record<string, Side> = {}
) => {
	const plan = planMerge(base, mine, theirs);
	return { plan, merged: resolveMerge(plan, choices) };
};

describe('planning a merge', () => {
	it('finds nothing to do when neither side changed', () => {
		const { base, mine, theirs } = three();
		const { plan, merged } = resolve(base, mine, theirs);
		expect(isQuiet(plan)).toBe(true);
		// The merged model is mine, in mine's ids.
		expect(merged.map((e) => e['@id']).sort()).toEqual(mine.map((e) => e['@id']).sort());
	});

	it('brings in what only they changed', () => {
		const { base, mine } = three();
		let theirs = clone(base);
		byName(theirs, 'Engine').declaredName = 'Motor';
		addTo(theirs, 'Garage', 'PartDefinition', 'Trailer', 'their');
		theirs = remove(theirs, 'Vehicle');
		const { plan, merged } = resolve(base, mine, theirs);
		expect(plan.conflicts).toEqual([]);
		expect(plan.outgoing).toEqual([]);
		expect(plan.incoming).toEqual(
			expect.arrayContaining([
				{ kind: 'changed', what: 'part def Motor', where: 'Garage::Motor', details: ['name'] },
				{ kind: 'added', what: 'part def Trailer', where: 'Garage', details: [] },
				{ kind: 'removed', what: 'part def Vehicle', where: 'Garage', details: [] }
			])
		);
		expect(plan.incoming).toHaveLength(3);
		expect(names(merged)).toEqual([
			'Garage',
			'Garage::Motor',
			'Garage::Trailer',
			'Garage::car',
			'Garage::car::engine'
		]);
		// Mine's ids stay where mine has the element; theirs keeps its own.
		expect(byName(merged, 'Motor')['@id']).toBe(byName(mine, 'Engine')['@id']);
		expect(byName(merged, 'Trailer')['@id']).toBe('their-e');
		// The package lists the new member after the others, and no longer the removed one.
		const pkg = byName(merged, 'Garage');
		expect((pkg.ownedRelationship as unknown[]).length).toBe(3);
		expect((pkg.ownedRelationship as { '@id': string }[]).at(-1)!['@id']).toBe('their-m');
	});

	it('sends what only I changed', () => {
		const { base, theirs } = three();
		let mine = clone(garage('own').m.elements);
		byName(mine, 'car').declaredName = 'auto';
		addTo(mine, 'Garage', 'PartDefinition', 'Bike', 'mine');
		mine = remove(mine, 'engine');
		const { plan, merged } = resolve(base, mine, theirs);
		expect(plan.conflicts).toEqual([]);
		expect(plan.incoming).toEqual([]);
		expect(plan.outgoing).toEqual(
			expect.arrayContaining([
				{ kind: 'changed', what: 'part auto', where: 'Garage::auto', details: ['name'] },
				{ kind: 'added', what: 'part def Bike', where: 'Garage', details: [] },
				{ kind: 'removed', what: 'part engine', where: 'Garage::car', details: [] }
			])
		);
		expect(names(merged)).toEqual(names(mine));
	});

	it('merges changes to different elements, and additions to the same package', () => {
		const { base, mine } = three();
		const theirs = clone(base);
		byName(mine, 'car').declaredName = 'auto';
		addTo(mine, 'Garage', 'PartDefinition', 'Bike', 'mine');
		byName(theirs, 'Engine').declaredName = 'Motor';
		addTo(theirs, 'Garage', 'PartDefinition', 'Trailer', 'their');
		const { plan, merged } = resolve(base, mine, theirs);
		expect(plan.conflicts).toEqual([]);
		expect(plan.incoming.map((c) => `${c.kind} ${c.what}`).sort()).toEqual([
			'added part def Trailer',
			'changed part def Motor'
		]);
		expect(plan.outgoing.map((c) => `${c.kind} ${c.what}`).sort()).toEqual([
			'added part def Bike',
			'changed part auto'
		]);
		expect(names(merged)).toEqual([
			'Garage',
			'Garage::Bike',
			'Garage::Motor',
			'Garage::Trailer',
			'Garage::Vehicle',
			'Garage::auto',
			'Garage::auto::engine'
		]);
		// Both additions are in the package's list: theirs after what it follows there, then mine.
		const list = (byName(merged, 'Garage').ownedRelationship as { '@id': string }[]).map(
			(r) => r['@id']
		);
		expect(list.slice(-2)).toEqual(['their-m', 'mine-m']);
	});

	it('merges two changes to the same element when they touch different properties', () => {
		const { base, mine } = three();
		const theirs = clone(base);
		byName(mine, 'Vehicle').declaredName = 'Car';
		byName(theirs, 'Vehicle').isAbstract = true;
		const { plan, merged } = resolve(base, mine, theirs);
		expect(plan.conflicts).toEqual([]);
		expect(byName(merged, 'Car').isAbstract).toBe(true);
	});

	it('takes the same change on both sides once', () => {
		const { base, mine } = three();
		const theirs = clone(base);
		byName(mine, 'Engine').declaredName = 'Motor';
		byName(theirs, 'Engine').declaredName = 'Motor';
		addTo(mine, 'Garage', 'PartDefinition', 'Trailer', 'mine');
		addTo(theirs, 'Garage', 'PartDefinition', 'Trailer', 'their');
		const { plan, merged } = resolve(base, mine, theirs);
		expect(isQuiet(plan)).toBe(true);
		expect(merged.filter((e) => e.declaredName === 'Trailer')).toHaveLength(1);
	});

	it('asks when both changed the same property differently', () => {
		const { base, mine } = three();
		const theirs = clone(base);
		byName(mine, 'Engine').declaredName = 'Motor';
		byName(theirs, 'Engine').declaredName = 'PowerUnit';
		const plan = planMerge(base, mine, theirs);
		expect(plan.conflicts).toEqual([
			{
				id: expect.stringMatching(/^changed:/),
				kind: 'both-changed',
				what: 'part def Motor',
				where: 'Garage::Motor',
				mine: ['name: “Motor”'],
				theirs: ['name: “PowerUnit”']
			}
		]);
		const id = plan.conflicts[0]!.id;
		expect(names(resolveMerge(plan, { [id]: 'mine' }))).toContain('Garage::Motor');
		expect(names(resolveMerge(plan, { [id]: 'theirs' }))).toContain('Garage::PowerUnit');
	});

	it('names a conflict in a typing by the element it types', () => {
		const { base, mine } = three();
		const theirs = clone(base);
		typingOf(mine, 'car').type = { '@id': byName(mine, 'Engine')['@id'] };
		typingOf(theirs, 'car').type = { '@id': byName(theirs, 'Garage')['@id'] };
		const plan = planMerge(base, mine, theirs);
		expect(plan.conflicts).toHaveLength(1);
		expect(plan.conflicts[0]).toMatchObject({
			what: 'part car',
			where: 'Garage::car',
			mine: ['type: Garage::Engine'],
			theirs: ['type: Garage']
		});
		const merged = resolveMerge(plan, { [plan.conflicts[0]!.id]: 'theirs' });
		expect(typingOf(merged, 'car').type).toEqual({ '@id': byName(merged, 'Garage')['@id'] });
	});

	it('asks when both added an element in the same place, differently', () => {
		const { base, mine } = three();
		const theirs = clone(base);
		addTo(mine, 'Garage', 'PartDefinition', 'Trailer', 'mine').isAbstract = true;
		addTo(theirs, 'Garage', 'PartDefinition', 'Trailer', 'their').isAbstract = false;
		const plan = planMerge(base, mine, theirs);
		expect(plan.conflicts).toMatchObject([
			{
				kind: 'both-added',
				what: 'part def Trailer',
				mine: ['abstract: yes'],
				theirs: ['abstract: no']
			}
		]);
		const merged = resolveMerge(plan, { [plan.conflicts[0]!.id]: 'theirs' });
		expect(merged.filter((e) => e.declaredName === 'Trailer')).toEqual([
			expect.objectContaining({ '@id': 'mine-e', isAbstract: false })
		]);
	});

	it('asks when they removed what I changed', () => {
		const { base, mine } = three();
		const theirs = remove(clone(base), 'car');
		byName(mine, 'engine').declaredName = 'motor';
		const plan = planMerge(base, mine, theirs);
		expect(plan.conflicts).toEqual([
			{
				id: expect.stringMatching(/^removed:/),
				kind: 'removed-by-them',
				what: 'part car',
				where: 'Garage::car',
				mine: ['changed Garage::car::motor: name'],
				theirs: ['removed it']
			}
		]);
		expect(plan.incoming).toEqual([]);
		expect(plan.outgoing).toEqual([]);
		const id = plan.conflicts[0]!.id;
		expect(names(resolveMerge(plan, { [id]: 'mine' }))).toContain('Garage::car::motor');
		const theirsWin = resolveMerge(plan, { [id]: 'theirs' });
		expect(names(theirsWin)).toEqual(['Garage', 'Garage::Engine', 'Garage::Vehicle']);
		// Nothing left refers to what went.
		const ids = new Set(theirsWin.map((e) => e['@id']));
		for (const e of theirsWin)
			for (const r of (e.ownedRelationship as { '@id': string }[] | undefined) ?? [])
				expect(ids.has(r['@id'])).toBe(true);
	});

	it('asks when I removed what they changed, or added to', () => {
		const { base, mine: before } = three();
		const mine = remove(before, 'car');
		const theirs = clone(base);
		addTo(theirs, 'car', 'PartUsage', 'wheel', 'their');
		const plan = planMerge(base, mine, theirs);
		expect(plan.conflicts).toMatchObject([
			{
				kind: 'removed-by-you',
				what: 'part car',
				mine: ['removed it'],
				theirs: ['added part wheel in it']
			}
		]);
		const id = plan.conflicts[0]!.id;
		expect(names(resolveMerge(plan, { [id]: 'mine' }))).not.toContain('Garage::car');
		const kept = resolveMerge(plan, { [id]: 'theirs' });
		expect(names(kept)).toEqual(
			expect.arrayContaining(['Garage::car', 'Garage::car::wheel', 'Garage::car::engine'])
		);
		expect((byName(kept, 'Garage').ownedRelationship as unknown[]).length).toBe(3);
	});

	it('asks when they removed what I started using', () => {
		const { base, mine } = three();
		const theirs = remove(clone(base), 'Vehicle');
		// Mine types the engine as a Vehicle now.
		typingOf(mine, 'engine').type = { '@id': byName(mine, 'Vehicle')['@id'] };
		const plan = planMerge(base, mine, theirs);
		expect(plan.conflicts).toMatchObject([
			{
				kind: 'removed-by-them',
				what: 'part def Vehicle',
				mine: ['uses it in Garage::car::engine']
			}
		]);
	});

	it('removes without asking what the other side left alone', () => {
		const { base, mine: before } = three();
		const mine = remove(before, 'Vehicle');
		// car is typed by Vehicle, but neither side changed that: removing Vehicle is mine to make.
		const theirs = clone(base);
		byName(theirs, 'Engine').declaredName = 'Motor';
		const { plan, merged } = resolve(base, mine, theirs);
		expect(plan.conflicts).toEqual([]);
		expect(names(merged)).not.toContain('Garage::Vehicle');
		expect(names(merged)).toContain('Garage::Motor');
	});

	it('matches the server’s elements by place when another tool renumbered them', () => {
		const { base, mine } = three();
		const theirs = garage('xyz').m.elements;
		byName(theirs, 'Engine').declaredName = 'Motor';
		const plan = planMerge(base, mine, theirs);
		expect(plan.incoming).toEqual([
			{ kind: 'changed', what: 'part def Motor', where: 'Garage::Motor', details: ['name'] }
		]);
	});
});

describe('words', () => {
	it('says kinds as SysML writes them', () => {
		expect(kindWord('PartDefinition')).toBe('part def');
		expect(kindWord('AttributeUsage')).toBe('attribute');
		expect(kindWord('Package')).toBe('package');
		expect(kindWord('Documentation')).toBe('doc');
	});
});

describe('merging orders', () => {
	it('keeps both sides’ insertions and removals', () => {
		expect(mergeOrder(['a', 'b', 'c'], ['a', 'x', 'b', 'c'], ['a', 'b', 'c', 'y'])).toEqual([
			'a',
			'x',
			'b',
			'c',
			'y'
		]);
		// A removal on one side keeps its place in the union; presence decides later.
		expect(mergeOrder(['a', 'b'], ['b'], ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
	});
	it('follows the side that reordered', () => {
		expect(mergeOrder(['a', 'b', 'c'], ['a', 'b', 'c', 'x'], ['c', 'b', 'a'])).toEqual([
			'c',
			'x',
			'b',
			'a'
		]);
	});
});
