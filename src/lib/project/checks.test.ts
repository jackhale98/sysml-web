import { describe, expect, it } from 'vitest';
import type { Check, Span } from '#lib/engine/types.ts';
import { checkProblems, checkTitle, computedText, inputsText, valueText } from './checks';

const span: Span = {
	start_row: 12,
	start_col: 5,
	end_row: 12,
	end_col: 40,
	start_byte: 388,
	end_byte: 423,
	from: 388,
	to: 423
};

const check = (over: Partial<Check>): Check => ({
	kind: 'satisfy',
	status: 'satisfied',
	checkable: true,
	detail: 'satisfied',
	explanation: '',
	requirement: {
		name: 'Flight endurance',
		qualifiedName: "SystemRequirements::'Flight endurance'",
		id: 'SYS-001',
		elementId: 'x'
	},
	by: 'drone',
	constraint: 'drone.endurance >= 25 [min]',
	name: null,
	values: [{ feature: 'drone.endurance', value: { kind: 'number', value: 1468.8, unit: 's' } }],
	limit: { feature: 'drone.endurance', operator: '>=', value: 25, unit: 'min' },
	file: 'system/Satisfaction.sysml',
	span,
	...over
});

describe('checks as problems', () => {
	it('makes a violated claim a warning at the claim, with its values and limit', () => {
		expect(checkProblems([check({ status: 'violated' })])).toEqual([
			{
				file: 'system/Satisfaction.sysml',
				span,
				severity: 'warning',
				code: 'check',
				message:
					'SYS-001 Flight endurance is not met by drone: drone.endurance = 24.48 min (needs ≥ 25 min)'
			}
		]);
	});

	it('leaves satisfied checks out, and undecided ones nobody can act on', () => {
		expect(checkProblems([check({}), check({ status: 'undecided' })])).toEqual([]);
		// In words only: nothing to decide.
		expect(
			checkProblems([check({ status: 'undecided', checkable: false, undecided: 'open' })])
		).toEqual([]);
	});

	it('lists an undecided check with why: a fault of the values as a warning, else a note', () => {
		const zero = check({
			status: 'undecided',
			undecided: 'fault',
			explanation: 'drone.endurance cannot be worked out: division by zero.',
			values: [{ feature: 'drone.endurance', value: { kind: 'undecided', reason: 'x' } }]
		});
		const missing = check({
			status: 'undecided',
			undecided: 'open',
			explanation: 'drone.endurance cannot be worked out: `hoverPower` has no value in `drone`.'
		});
		const unclaimed = check({
			kind: 'require',
			status: 'undecided',
			undecided: 'open',
			by: null,
			explanation: 'Nothing in the design claims to satisfy this requirement yet.'
		});
		expect(checkProblems([zero, missing, unclaimed]).map((p) => [p.severity, p.message])).toEqual([
			[
				'warning',
				"SYS-001 Flight endurance can't be decided for drone: drone.endurance cannot be worked out: division by zero"
			],
			[
				'note',
				"SYS-001 Flight endurance can't be decided yet for drone: drone.endurance cannot be worked out: `hoverPower` has no value in `drone`"
			],
			[
				'note',
				"SYS-001 Flight endurance can't be decided yet: nothing in the design claims to satisfy it"
			]
		]);
	});

	it('says which part breaks a definition’s assertion', () => {
		const assertion = check({
			kind: 'assert',
			status: 'violated',
			requirement: null,
			name: 'light',
			by: 'HeavyArm',
			assertedIn: 'Arm',
			constraint: 'mass <= 60 [g]',
			values: [{ feature: 'mass', value: { kind: 'number', value: 80, unit: 'g' } }],
			limit: { feature: 'mass', operator: '<=', value: 60, unit: 'g' }
		});
		expect(checkProblems([assertion])[0]!.message).toBe(
			'light (asserted in Arm) does not hold for HeavyArm: mass = 80 g (needs ≤ 60 g)'
		);
	});

	it('says what a check’s values come from', () => {
		const given = (expression: string, writtenIn: string | null = null, isDefault = false) => ({
			expression,
			writtenIn,
			isDefault,
			inputs: []
		});
		const worked = check({
			values: [
				{
					feature: 'drone.takeOffMass',
					value: { kind: 'number', value: 3770, unit: 'g' },
					from: {
						expression: 'emptyMass + payloadCapacity',
						writtenIn: 'DeliveryDrone',
						isDefault: false,
						inputs: [
							{
								feature: 'emptyMass',
								value: { kind: 'number', value: 2770, unit: 'g' },
								from: {
									expression: 'airframe.mass + battery.mass',
									writtenIn: 'DeliveryDrone',
									isDefault: false,
									inputs: [
										{
											feature: 'airframe.mass',
											value: { kind: 'number', value: 650, unit: 'g' },
											from: given('650 [g]', 'Airframe', true)
										}
									]
								}
							},
							{
								feature: 'payloadCapacity',
								value: { kind: 'number', value: 1, unit: 'kg' },
								from: given('1 [kg]')
							}
						]
					}
				},
				{ feature: 'drone.other', value: { kind: 'number', value: 1, unit: null } }
			]
		});
		expect(inputsText(worked)).toBe(
			'drone.takeOffMass = emptyMass + payloadCapacity in DeliveryDrone, with emptyMass = 2.77 kg (airframe.mass + battery.mass in DeliveryDrone, with airframe.mass = 650 g (default in Airframe)) and payloadCapacity = 1 kg'
		);
		expect(inputsText(check({}))).toBe('');
	});

	it('names an assertion by its name or its constraint', () => {
		const assertion = check({
			kind: 'assert',
			status: 'violated',
			requirement: null,
			name: 'light',
			by: 'Box',
			constraint: 'x <= 0.5 [kg]',
			values: [{ feature: 'x', value: { kind: 'number', value: 1, unit: 'kg' } }],
			limit: { feature: 'x', operator: '<=', value: 0.5, unit: 'kg' }
		});
		expect(checkProblems([assertion])[0]!.message).toBe(
			'light does not hold: x = 1 kg (needs ≤ 0.5 kg)'
		);
		expect(checkTitle({ ...assertion, name: null })).toBe('the assertion `x <= 0.5 [kg]`');
	});

	it('writes values as people read them', () => {
		expect(valueText({ kind: 'number', value: 2770, unit: 'g' })).toBe('2.77 kg');
		expect(valueText({ kind: 'text', text: 'performance' })).toBe('performance');
		expect(valueText({ kind: 'none' })).toBe('no value');
		expect(valueText({ kind: 'undecided', reason: 'x' })).toBe('unknown');
	});
});

describe('computed values next to their expressions', () => {
	it('shows what an expression comes to, and nothing a literal already says', () => {
		const n = (value: number, unit: string | null) => ({ kind: 'number' as const, value, unit });
		expect(computedText(n(1652.4, 's'), 'HoverEndurance(battery.usableEnergy, hoverPower)')).toBe(
			'27.54 min'
		);
		expect(computedText(n(650, 'g'), '650 [g]')).toBeNull();
		expect(computedText(n(2770, 'g'), '2770 [g]')).toBe('2.77 kg');
		expect(computedText(n(0.85, null), '0.85')).toBeNull();
		expect(
			computedText({ kind: 'text', text: 'performance' }, 'RequirementKind::performance')
		).toBeNull();
		expect(computedText({ kind: 'text', text: 'true' }, 'a and b')).toBe('true');
		expect(computedText({ kind: 'none' }, null)).toBeNull();
		expect(computedText({ kind: 'undecided', reason: 'x' }, 'emptyMass + payloadCapacity')).toBe(
			'?'
		);
	});
});
