/**
 * The forms' SysML generators on their own: what each writes for the
 * choices a person makes, and what each says is wrong before anything is
 * written. (`create.test.ts` runs their output through the toolkit.)
 */
import { describe, expect, it } from 'vitest';
import type { TreeNode } from '#lib/project/elements.ts';
import type { ModelElement } from '#lib/project/elements.ts';
import {
	comparisons,
	limitProblem,
	limitStatement,
	limitTitle,
	limitWords,
	nextRequirementId,
	parseNumber,
	requirementText,
	satisfyText
} from './limit';
import { enclosingPackage, flatten, kindChain, ownerOf, qualifiedName } from './model';
import { fixedCount, rollupExpression, rollupPlan, rollupProblem, type RollupPart } from './rollup';
import {
	guessBetter,
	normaliseWeights,
	rangeOf,
	tradeProblem,
	tradeStudyText,
	tradeViewText,
	type TradeSpec
} from './trade';
import { isQuantity, unitChoices } from './units';
import {
	VIEW_KINDS,
	budgetDefinition,
	canCover,
	coverPrompt,
	exposeFor,
	viewKind,
	viewProblem,
	viewText,
	type Target
} from './view';

const pkg: Target = { qualifiedName: 'Rover', kind: 'package', isDefinition: false };
const part: Target = { qualifiedName: 'Rover::system', kind: 'part', isDefinition: false };
const machine: Target = { qualifiedName: 'Control::Modes', kind: 'state', isDefinition: true };

describe('view kinds', () => {
	it('each has a plain description and a definition', () => {
		for (const k of VIEW_KINDS) {
			expect(k.description.length, k.id).toBeGreaterThan(20);
			expect(k.description, k.id).not.toMatch(/usage|redefin|expose|feature chain/i);
			expect(k.definition).toMatch(/^[A-Z]\w+$/);
		}
		expect(new Set(VIEW_KINDS.map((k) => k.id)).size).toBe(VIEW_KINDS.length);
	});

	it('offer only what a view of the kind can show', () => {
		const k = (id: string) => viewKind(id)!;
		expect(canCover(k('requirements'), pkg)).toBe(true);
		expect(canCover(k('requirements'), part)).toBe(false);
		expect(canCover(k('bom'), part)).toBe(true);
		expect(canCover(k('bom'), pkg)).toBe(false);
		expect(canCover(k('states'), machine)).toBe(true);
		expect(canCover(k('general'), part)).toBe(true);
		expect(canCover(k('checks'), pkg)).toBe(false);
	});

	it('expose a package’s members, a part’s tree, or an element itself', () => {
		expect(exposeFor(viewKind('requirements')!, pkg)).toBe('Rover::*');
		expect(exposeFor(viewKind('bom')!, part)).toBe('Rover::system::**');
		expect(exposeFor(viewKind('interconnection')!, part)).toBe('Rover::system::*');
		expect(exposeFor(viewKind('interfaces')!, pkg)).toBe('Rover::**');
		expect(exposeFor(viewKind('states')!, machine)).toBe('Control::Modes');
		expect(
			exposeFor(viewKind('requirements')!, {
				qualifiedName: "Rover::'First requirement'",
				kind: 'requirement',
				isDefinition: false
			})
		).toBe("Rover::'First requirement'");
	});
});

describe('the view text', () => {
	it('is a view usage typed by the kind’s view def, with a doc and exposes', () => {
		expect(
			viewText({
				kind: viewKind('requirements')!,
				name: 'safety',
				doc: 'Safety requirements.',
				targets: [pkg, pkg]
			})
		).toBe(
			'view safety : ModelViews::RequirementsTable {\n    doc /* Safety requirements. */\n    expose Rover::*;\n}'
		);
	});

	it('spells the definition as the place it goes says', () => {
		expect(
			viewText({
				kind: viewKind('general')!,
				name: 'structure',
				targets: [part],
				spell: (q) => q.split('::').pop()!
			})
		).toBe('view structure : GeneralView {\n    expose Rover::system::**;\n}');
	});

	it('keeps chosen columns in its own TableRendering', () => {
		expect(
			viewText({
				kind: viewKind('requirements')!,
				name: 'short',
				targets: [],
				columns: ['id', 'title']
			})
		).toBe(
			'view short : ModelViews::RequirementsTable {\n    @Reporting::TableRendering { columns = "id; title"; }\n}'
		);
	});

	it('makes a budget of mass and power from the bundled tables, of anything else with its own', () => {
		expect(budgetDefinition('mass')).toBe('MassBudget');
		expect(budgetDefinition('powerDraw')).toBe('PowerBudget');
		expect(budgetDefinition('cost')).toBeNull();
		const budget = (budgetOf: string) =>
			viewText({ kind: viewKind('budget')!, name: 'b', targets: [part], budgetOf });
		expect(budget('mass')).toBe(
			'view b : ModelViews::MassBudget {\n    expose Rover::system::**;\n}'
		);
		expect(budget('cost')).toBe(
			'view b {\n    @Reporting::TableRendering { rows = "budget:cost"; columns = "path; type; quantity; each; total; share; limit; margin; check"; }\n    expose Rover::system::**;\n}'
		);
	});

	it('says what is missing in plain words', () => {
		const base = { title: 'Mass', name: 'mass', targets: [], taken: new Set<string>() };
		expect(viewProblem({ ...base, kind: undefined })).toBe('Choose what kind of view to make.');
		expect(viewProblem({ ...base, kind: viewKind('bom'), title: ' ' })).toBe(
			'Give the view a name.'
		);
		expect(viewProblem({ ...base, kind: viewKind('bom') })).toBe(
			'Choose which part of the design it shows.'
		);
		expect(viewProblem({ ...base, kind: viewKind('requirements') })).toBeNull();
		expect(viewProblem({ ...base, kind: viewKind('checks'), taken: new Set(['mass']) })).toBe(
			'There is already a view called “Mass”. Choose another name.'
		);
		expect(
			viewProblem({ ...base, kind: viewKind('interconnection'), targets: [part, part] })
		).toMatch(/shows one element/);
		for (const k of VIEW_KINDS) expect(coverPrompt(k)).toMatch(/\.$/);
	});
});

const p = (name: string, extra: Partial<RollupPart> = {}): RollupPart => ({
	name,
	multiplicity: null,
	ref: false,
	variation: false,
	value: null,
	type: 'Wheel',
	has: true,
	...extra
});

describe('adding up', () => {
	it('reads fixed numbers of parts', () => {
		expect(fixedCount(null)).toBe(1);
		expect(fixedCount('4')).toBe(4);
		expect(fixedCount('4..4')).toBe(4);
		expect(fixedCount('0..1')).toBeNull();
		expect(fixedCount('1..*')).toBeNull();
		expect(fixedCount('*')).toBeNull();
		expect(fixedCount('0')).toBe(0);
	});

	it('adds single parts, sums collections and leaves out what it can’t add', () => {
		const plan = rollupPlan(
			[
				p('body'),
				p('wheels', { multiplicity: '4' }),
				p('options', { variation: true }),
				p('camera', { has: false }),
				p('spare', { multiplicity: '0..1' }),
				p('front'),
				p('rear'),
				p('pair', { multiplicity: '2', value: '(front, rear)' }),
				p('link', { ref: true }),
				p('arms', { multiplicity: '2', value: '(left.arm, right.arm)', type: 'Arm' }),
				p('none', { multiplicity: '0' })
			],
			'mass'
		);
		expect(plan.terms).toEqual([
			{ part: 'body', text: 'body.mass', count: 1 },
			{ part: 'wheels', text: 'sum(wheels.mass)', count: 4 },
			{ part: 'front', text: 'front.mass', count: 1 },
			{ part: 'rear', text: 'rear.mass', count: 1 },
			{ part: 'arms', text: 'sum(arms->collect { in p : Arm; p.mass })', count: 2 }
		]);
		expect(plan.left.map((l) => l.part)).toEqual([
			'options',
			'camera',
			'spare',
			'pair',
			'link',
			'none'
		]);
		expect(plan.imports).toEqual(['NumericalFunctions::sum', 'ControlFunctions::collect']);
		expect(rollupProblem(plan, 'mass')).toBeNull();
	});

	it('breaks a long sum into lines, as the demo does', () => {
		const plan = rollupPlan(
			[
				'airframe',
				'battery',
				'powerDistribution',
				'flightController',
				'gnss',
				'radio',
				'camera'
			].map((n) => p(n)),
			'mass'
		);
		expect(rollupExpression(plan, 60)).toBe(
			'airframe.mass + battery.mass + powerDistribution.mass\n    + flightController.mass + gnss.mass + radio.mass\n    + camera.mass'
		);
		expect(rollupExpression(plan, Infinity)).not.toContain('\n');
	});

	it('quotes names that need it', () => {
		expect(rollupPlan([p("'left wheel'")], 'total mass').terms[0]?.text).toBe(
			"'left wheel'.'total mass'"
		);
	});

	it('says why nothing can be added up', () => {
		expect(rollupProblem(rollupPlan([], 'mass'), 'mass')).toBe(
			'It has no parts to add up. Add parts with a mass first.'
		);
		expect(rollupProblem(rollupPlan([p('camera', { has: false })], 'mass'), 'mass')).toBe(
			'None of its parts can be added up for mass: camera (it has no mass).'
		);
	});
});

describe('limits', () => {
	const atMost = { kind: 'atMost' as const, value: 4, unit: 'kg' };

	it('writes comparisons with units, a Real without', () => {
		expect(comparisons('drone.takeOffMass', atMost)).toEqual(['drone.takeOffMass <= 4 [kg]']);
		expect(comparisons('x.price', { kind: 'atLeast', value: 10, unit: null })).toEqual([
			'x.price >= 10.0'
		]);
		expect(comparisons('x.v', { kind: 'between', low: 1, value: 2.5, unit: 'V' })).toEqual([
			'x.v >= 1 [V]',
			'x.v <= 2.5 [V]'
		]);
	});

	it('words the requirement like an engineer would', () => {
		expect(limitStatement('drone', 'takeOffMass', atMost)).toBe(
			"The drone's take off mass shall be at most 4 kg."
		);
		expect(limitTitle('takeOffMass', atMost)).toBe('Maximum take off mass');
		expect(limitTitle('endurance', { kind: 'atLeast', value: 25, unit: 'min' })).toBe(
			'Minimum endurance'
		);
		expect(limitTitle('voltage', { kind: 'between', low: 20, value: 26, unit: 'V' })).toBe(
			'Voltage range'
		);
		expect(limitWords({ kind: 'atMost', value: 216, unit: 'W*h' })).toBe('at most 216 W·h');
	});

	it('numbers a new requirement after the others', () => {
		expect(nextRequirementId([])).toBe('REQ-001');
		expect(nextRequirementId(['SYS-001', 'SYS-011', 'STK-1', null])).toBe('SYS-012');
		expect(nextRequirementId(['R9', 'R10'])).toBe('R11');
	});

	it('writes a requirement with subject, constraint and statement', () => {
		expect(
			requirementText({
				id: 'SYS-012',
				title: 'Maximum take-off mass',
				statement: 'The drone shall weigh at most 4 kg.',
				subject: { name: 'drone', type: 'DeliveryDrone' },
				feature: 'drone.takeOffMass',
				limit: atMost
			})
		).toBe(
			"requirement <'SYS-012'> 'Maximum take-off mass' {\n    doc /* The drone shall weigh at most 4 kg. */\n    subject drone : DeliveryDrone;\n    require constraint { drone.takeOffMass <= 4 [kg] }\n}"
		);
		expect(satisfyText('Maximum take-off mass', 'drone')).toBe(
			"satisfy 'Maximum take-off mass' by drone;"
		);
	});

	it('reads numbers as people type them and says what is wrong', () => {
		expect(parseNumber('1,5')).toBe(1.5);
		expect(parseNumber(' 1 250 ')).toBe(1250);
		expect(parseNumber('')).toBeNaN();
		expect(limitProblem({ kind: 'atMost', value: 'four', low: '' })).toBe(
			'Enter the limit as a number.'
		);
		expect(limitProblem({ kind: 'between', value: '1', low: '3' })).toBe(
			'The first number of the range must be the smaller one.'
		);
		expect(limitProblem({ kind: 'between', value: '3', low: '' })).toBe(
			'Enter both numbers of the range.'
		);
		expect(limitProblem({ kind: 'atLeast', value: '25', low: '' })).toBeNull();
	});
});

describe('trade studies', () => {
	it('normalise weights to fractions that add up to 1', () => {
		expect(normaliseWeights([50, 20, 30])).toEqual([0.5, 0.2, 0.3]);
		expect(normaliseWeights([1, 1, 1])).toEqual([0.34, 0.33, 0.33]);
		expect(normaliseWeights([0, 0])).toEqual([0.5, 0.5]);
		expect(normaliseWeights([10, -5, NaN])).toEqual([1, 0, 0]);
		const sum = normaliseWeights([7, 13, 29, 51]).reduce((a, b) => a + b, 0);
		expect(sum).toBeCloseTo(1, 10);
	});

	it('guess which way is better and the range to score over', () => {
		expect(guessBetter('mass')).toBe('lower');
		expect(guessBetter('price')).toBe('lower');
		expect(guessBetter('endurance')).toBe('higher');
		expect(guessBetter('massMargin')).toBe('higher');
		expect(rangeOf([1.5, 1.4, null, 2], 'lower')).toEqual({ worst: 2, best: 1.4 });
		expect(rangeOf([1.5, 1.4, 2], 'higher')).toEqual({ worst: 1.4, best: 2 });
		expect(rangeOf([2, 2], 'higher')).toBeNull();
		expect(rangeOf([2], 'higher')).toBeNull();
	});

	const spec: TradeSpec = {
		packageName: 'PackChoice',
		study: 'packChoiceStudy',
		question: 'Which pack?',
		kind: 'Battery',
		alternatives: ['drone.battery', 'packOptions::big'],
		variation: { name: 'packOptions', variants: [{ name: 'big', type: 'BigPack' }] },
		parameter: 'battery',
		criteria: [
			{
				attribute: 'capacity',
				valueType: 'EnergyValue',
				better: 'higher',
				weight: 60,
				worst: 200,
				best: 300,
				unit: 'W*h',
				cutoff: { kind: 'atLeast', value: 210, unit: 'W*h' }
			},
			{
				attribute: 'price',
				valueType: 'Real',
				better: 'lower',
				weight: 40,
				worst: 1000,
				best: 400,
				unit: null,
				cutoff: null
			}
		],
		imports: ['Parts::Battery']
	};

	it('write the study in the demo’s form', () => {
		const text = tradeStudyText(spec);
		expect(text).toContain(
			'    variation part packOptions : Battery {\n        variant part big : BigPack;\n    }'
		);
		expect(text).toContain(
			'        attribute capacityScore : Real = (capacity - 200 [W*h]) / 100 [W*h];  // 200 W·h: 0, 300 W·h: 1'
		);
		expect(text).toContain(
			'        attribute priceScore : Real = (1000.0 - price) / 600.0;  // 1000: 0, 400: 1'
		);
		expect(text).toContain(
			'        return score : Real = if capacity < 210 [W*h] ? 0.0 else 0.6 * capacityScore + 0.4 * priceScore;'
		);
		expect(text).toContain('        subject : Battery[2] = (drone.battery, packOptions::big);');
		expect(text).toContain('            in part battery :>> alternative : Battery;');
		expect(text).toContain('            attribute capacity : EnergyValue = battery.capacity;');
		expect(text).toContain(
			'            return :>> result : Real = PackChoiceScore(capacity, price);'
		);
		expect(text).toContain('    private import Parts::Battery;');
		expect(text).toContain(
			'weighted: capacity 60 %, price 40 %. An alternative with a capacity under 210 W·h scores 0.'
		);
		expect(
			tradeViewText('packChoice', 'TradeStudyTable', 'PackChoice::packChoiceStudy', 'Which pack?')
		).toBe(
			'view packChoice : TradeStudyTable {\n    doc /* Which pack? */\n    expose PackChoice::packChoiceStudy;\n}'
		);
	});

	it('say what is wrong before anything is written', () => {
		const ok = {
			alternatives: 3,
			criteria: [{ attribute: 'mass', weight: 1, worst: 2, best: 1 }],
			name: 'x',
			taken: false
		};
		expect(tradeProblem(ok)).toBeNull();
		expect(tradeProblem({ ...ok, alternatives: 1 })).toBe(
			'Choose at least two alternatives to compare.'
		);
		expect(tradeProblem({ ...ok, criteria: [] })).toBe(
			'Choose at least one criterion to compare them on.'
		);
		expect(
			tradeProblem({ ...ok, criteria: [{ attribute: 'mass', weight: 1, worst: 2, best: 2 }] })
		).toMatch(/all have the same mass/);
		expect(
			tradeProblem({ ...ok, criteria: [{ attribute: 'mass', weight: 0, worst: 2, best: 1 }] })
		).toBe('Give at least one criterion some weight.');
		expect(tradeProblem({ ...ok, name: ' ' })).toBe('Give the study a name.');
		expect(tradeProblem({ ...ok, taken: true })).toMatch(/already something called/);
	});
});

describe('units', () => {
	it('offer the units of the value’s dimension, its own first', () => {
		expect(unitChoices('MassValue', null)).toEqual(['kg', 'g']);
		expect(unitChoices('MassValue', 'g')).toEqual(['g', 'kg']);
		expect(unitChoices('DurationValue', 'min')).toEqual(['min', 's', 'h', 'd']);
		expect(unitChoices('EnergyValue', null)).toEqual(['J', 'kJ', 'W*h', 'kW*h']);
		expect(unitChoices('Real', null)).toEqual([]);
		expect(isQuantity('Real', null)).toBe(false);
		expect(isQuantity('MassValue', null)).toBe(true);
	});
});

describe('the model tree', () => {
	const el = (name: string, kind: string, extra: Partial<ModelElement> = {}): ModelElement => ({
		key: name,
		name,
		label: name,
		kind,
		isDefinition: false,
		parent: null,
		typeRef: null,
		shortName: null,
		doc: null,
		multiplicity: null,
		value: null,
		file: 'a.sysml',
		span: { start_row: 1, start_col: 0, end_row: 1, end_col: 0, start_byte: 0, end_byte: 0 },
		...extra
	});
	const motor = el('Motor', 'part', { isDefinition: true });
	const small = el('SmallMotor', 'part', { isDefinition: true, typeRef: 'Motor' });
	const used = el('m', 'part', { typeRef: 'SmallMotor' });
	const tree: TreeNode[] = [
		{
			element: el('P', 'package'),
			children: [
				{ element: motor, children: [] },
				{ element: small, children: [] },
				{ element: el('sys', 'part'), children: [{ element: used, children: [] }] }
			]
		}
	];

	it('names and places elements', () => {
		expect(qualifiedName(tree, 'm')).toBe('P::sys::m');
		expect(enclosingPackage(tree, 'm')?.name).toBe('P');
		expect(ownerOf(tree, 'm')?.name).toBe('sys');
		expect(flatten(tree, (e) => e.kind === 'part').map((x) => [x.qualifiedName, x.depth])).toEqual([
			['P::Motor', 1],
			['P::SmallMotor', 1],
			['P::sys', 1],
			['P::sys::m', 2]
		]);
	});

	it('reads what kind of thing a part is', () => {
		const all = [motor, small, used];
		expect(kindChain(all, used)).toEqual(['SmallMotor', 'Motor']);
		expect(kindChain(all, small)).toEqual(['SmallMotor', 'Motor']);
		expect(kindChain(all, el('x', 'part', { typeRef: 'Library::Thing' }))).toEqual(['Thing']);
	});
});
