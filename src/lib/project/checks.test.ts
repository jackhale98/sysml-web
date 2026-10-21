import { describe, expect, it } from 'vitest';
import type { Check, Span } from '#lib/engine/types.ts';
import { checkProblems, checkTitle, computedText, valueText } from './checks';

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

	it('leaves satisfied and undecided checks out', () => {
		expect(checkProblems([check({}), check({ status: 'undecided' })])).toEqual([]);
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
