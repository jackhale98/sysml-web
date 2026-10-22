import { describe, expect, it } from 'vitest';
import type { SimStep, StateSession } from '#lib/engine/types.ts';
import { flightModes, nestedMachine } from './fixtures.ts';
import {
	activeSet,
	announcement,
	autoMove,
	coerce,
	eventOptions,
	explain,
	explainText,
	findMachine,
	inputKind,
	isChangeTrigger,
	mentions,
	parseLiteral,
	record,
	sessionAt,
	sliderRange,
	stepOption,
	stepsSince,
	structureKey,
	timeText,
	transitionOf,
	variableUses,
	type Enabled,
	type History
} from './model.ts';

const flyingEnabled: Enabled[] = [
	{
		transition: 'commandedReturn',
		index: 4,
		from: 'flying',
		to: 'returningHome',
		trigger: 'ReturnHomeCommand',
		ready: true
	},
	{
		transition: 'lowBattery',
		index: 6,
		from: 'flying',
		to: 'returningHome',
		trigger: 'when stateOfCharge < returnThreshold',
		ready: false,
		reason: 'condition `stateOfCharge < returnThreshold` is false'
	},
	{
		transition: 'faultInFlight',
		index: 9,
		from: 'flying',
		to: 'failsafe',
		trigger: 'FaultDetected',
		ready: true
	}
];

function step(partial: Partial<SimStep> & Pick<SimStep, 'step' | 'from_state' | 'to_state'>) {
	return {
		transition_name: null,
		trigger: null,
		guard_result: null,
		effect: null,
		exit_action: null,
		entry_action: null,
		...partial
	} satisfies SimStep;
}

function session(stepNo: number, current: string[], trace: SimStep[], vars = {}): StateSession {
	return {
		machine: 'FlightModes',
		current,
		step: stepNo,
		variables: vars,
		trace,
		status: 'running',
		enabled: []
	};
}

describe('controls', () => {
	it('tells change triggers from events', () => {
		expect(isChangeTrigger('when stateOfCharge < returnThreshold')).toBe(true);
		expect(isChangeTrigger('after 5 [s]')).toBe(true);
		expect(isChangeTrigger('ArmCommand')).toBe(false);
		expect(isChangeTrigger('whenever')).toBe(false);
		expect(isChangeTrigger(undefined)).toBe(false);
	});

	it('offers one button per event and leaves change triggers to Step', () => {
		const options = eventOptions(flyingEnabled);
		expect(options.map((o) => o.trigger)).toEqual(['ReturnHomeCommand', 'FaultDetected']);
		expect(options.every((o) => o.ready)).toBe(true);
		const step = stepOption(flyingEnabled);
		expect(step.ready).toBe(false);
		expect(step.transitions.map((t) => t.transition)).toEqual(['lowBattery']);
		expect(step.reasons).toHaveLength(1);
	});

	it('groups transitions sharing a trigger and keeps the blocked reasons', () => {
		const options = eventOptions([
			{ transition: 'a', index: 0, from: 'x', to: 'y', trigger: 'Go', ready: false, reason: 'r1' },
			{ transition: 'b', index: 1, from: 'z', to: 'y', trigger: 'Go', ready: true }
		]);
		expect(options).toHaveLength(1);
		expect(options[0]!.ready).toBe(true);
		expect(options[0]!.reasons).toEqual(['r1']);
	});

	it('explains blocked transitions kindly', () => {
		expect(explainText('guard `stateOfCharge < returnThreshold` is false')).toBe(
			'guard stateOfCharge < returnThreshold is false'
		);
		const parts = explain(
			'guard `preflightChecksPassed`: undefined variable `preflightChecksPassed`'
		);
		expect(parts[0]).toMatchObject({ code: true, variable: 'preflightChecksPassed' });
		expect(explainText('guard `p`: undefined variable `p`')).toBe('p has no value yet');
		expect(explain('cannot apply `<` to "abc"')[1]).toEqual({ text: '<', code: true });
	});

	it('auto-run prefers a ready Step, then a ready event, then stops', () => {
		const ready = flyingEnabled.map((e) => ({ ...e, ready: true }));
		expect(autoMove(ready)).toEqual({ event: null });
		expect(autoMove(flyingEnabled, [], () => 0.99)).toEqual({ event: 'FaultDetected' });
		// Prefers the event leading somewhere new.
		const visited = [step({ step: 1, from_state: 'flying', to_state: 'returningHome' })];
		expect(autoMove(flyingEnabled, visited, () => 0)).toEqual({ event: 'FaultDetected' });
		expect(autoMove(flyingEnabled.map((e) => ({ ...e, ready: false })))).toBeNull();
	});

	it('a Step with nothing ready lets time pass to the next timer, which auto-run takes too', () => {
		const timer = (index: number, due: number): Enabled => ({
			transition: `t${index}`,
			index,
			from: 'cruising',
			to: 'cruising',
			trigger: `after ${due} [s]`,
			due,
			ready: false,
			reason: `\`after ${due} [s]\` is due at ${due} s`
		});
		const enabled = [...flyingEnabled, timer(7, 300), timer(8, 60), timer(9, 60)];
		const step = stepOption(enabled);
		expect(step.ready).toBe(false);
		expect(step.next).toEqual({ due: 60, transitions: [timer(8, 60), timer(9, 60)] });
		// Time passing comes before the events.
		expect(autoMove(enabled)).toEqual({ event: null });
		expect(stepOption(flyingEnabled).next).toBeUndefined();
	});

	it('explains a time it cannot work out, linking to its variable', () => {
		expect(explain('time `after delay`: undefined variable `delay`')[0]).toMatchObject({
			code: true,
			variable: 'delay'
		});
	});

	it('says simulated times plainly', () => {
		expect([0, 0.25, 45, 60, 90, 1500, 3600, 3900, 90061].map(timeText)).toEqual([
			'0 s',
			'0.25 s',
			'45 s',
			'1 min',
			'1 min 30 s',
			'25 min',
			'1 h',
			'1 h 5 min',
			'1 d 1 h 1 min 1 s'
		]);
	});
});

describe('variables', () => {
	it('picks an input for each type', () => {
		expect(inputKind({ type: 'Boolean' })).toBe('boolean');
		expect(inputKind({ type: 'Real' })).toBe('real');
		expect(inputKind({ type: 'ScalarValues::Integer' })).toBe('integer');
		expect(inputKind({ type: 'String' })).toBe('text');
		expect(inputKind({ value: '3' })).toBe('integer');
		expect(inputKind({ value: 'true' })).toBe('boolean');
	});

	it('parses defaults as written', () => {
		expect(parseLiteral('0.3')).toBe(0.3);
		expect(parseLiteral('"a"')).toBe('a');
		expect(parseLiteral('false')).toBe(false);
		expect(parseLiteral(undefined)).toBeNull();
		expect(parseLiteral(2)).toBe(2);
	});

	it('coerces input text to values', () => {
		expect(coerce('real', '0.15')).toBe(0.15);
		expect(coerce('integer', '2.6')).toBe(3);
		expect(coerce('real', '')).toBeNull();
		expect(coerce('real', 'abc')).toBeNull();
		expect(coerce('boolean', true)).toBe(true);
		expect(coerce('text', ' hi ')).toBe('hi');
	});

	it('finds the guards and change triggers each variable affects', () => {
		const uses = variableUses(flightModes);
		expect(uses.get('preflightChecksPassed')).toEqual([
			{ index: 3, name: 'arm', kind: 'guard', expression: 'preflightChecksPassed' }
		]);
		expect(uses.get('stateOfCharge')!.map((u) => [u.name, u.kind])).toEqual([
			['lowBattery', 'when'],
			['charged', 'when']
		]);
		expect(uses.get('returnThreshold')!.map((u) => u.name)).toEqual(['lowBattery']);
		expect(mentions('a.count > 2', 'count')).toBe(false);
		expect(mentions('count > 2', 'count')).toBe(true);
	});

	it('infers slider ranges from defaults and comparisons', () => {
		expect(sliderRange(flightModes, 'returnThreshold', 'real')).toEqual({
			min: 0,
			max: 1,
			step: 0.01
		});
		expect(sliderRange(flightModes, 'stateOfCharge', 'real')).toEqual({
			min: 0,
			max: 1,
			step: 0.01
		});
		expect(sliderRange(nestedMachine, 'count', 'integer')).toEqual({ min: 0, max: 10, step: 1 });
		expect(sliderRange(flightModes, 'preflightChecksPassed', 'boolean')).toBeNull();
	});
});

describe('trace and history', () => {
	it('maps trace steps to transitions, named or not', () => {
		expect(
			transitionOf(
				flightModes,
				step({
					step: 3,
					from_state: 'flying',
					to_state: 'returningHome',
					transition_name: 'lowBattery'
				})
			)
		).toBe(8);
		expect(
			transitionOf(flightModes, step({ step: 0, from_state: 'entry', to_state: 'idle' }))
		).toBe(0);
		expect(
			transitionOf(
				nestedMachine,
				step({ step: 1, from_state: 'off', to_state: 'on', trigger: 'Power' })
			)
		).toBe(8);
		expect(transitionOf(flightModes, step({ step: 1, from_state: 'x', to_state: 'y' }))).toBe(-1);
	});

	it('finds the steps a session took since the previous one', () => {
		const t0 = step({ step: 0, from_state: 'entry', to_state: 'idle' });
		const t1 = step({ step: 1, from_state: 'idle', to_state: 'armed', transition_name: 'arm' });
		const s0 = session(0, ['idle'], [t0]);
		const s1 = session(1, ['armed'], [t0, t1]);
		expect(stepsSince(null, s0)).toEqual([t0]);
		expect(stepsSince(s0, s1)).toEqual([t1]);
		expect(stepsSince(s1, s1)).toEqual([]);
		expect(announcement(s0, [t0])).toBe('Started in idle');
		expect(announcement(s1, [t1])).toBe('Now in armed after arm');
		expect(announcement({ ...s1, time: 300 }, [t1])).toBe('Now in armed after arm, at 5 min');
	});

	it('marks composite states active with their active children', () => {
		const active = activeSet(nestedMachine, ['par.motors.idle', 'par.lights.dark']);
		expect([...active].sort()).toEqual([
			'par',
			'par.lights',
			'par.lights.dark',
			'par.motors',
			'par.motors.idle'
		]);
	});

	it('records steps, replaces ignored events and drops the future when branching', () => {
		const t0 = step({ step: 0, from_state: 'entry', to_state: 'idle' });
		const s0 = session(0, ['idle'], [t0]);
		let h: History = { sessions: [s0], cursor: 0 };
		const ignored = { ...s0, messages: ['`X` fires no transition from idle'] };
		h = record(h, ignored);
		expect(h.sessions).toEqual([ignored]);
		const s1 = session(
			1,
			['armed'],
			[t0, step({ step: 1, from_state: 'idle', to_state: 'armed' })]
		);
		h = record(h, s1);
		expect(h.cursor).toBe(1);
		const withVars = session(1, ['armed'], s1.trace, { stateOfCharge: 0.5 });
		h = record(h, withVars);
		expect(h.sessions).toHaveLength(3);
		expect(sessionAt(h, 1)).toBe(2);
		expect(sessionAt(h, 0)).toBe(0);
		// Time passing with nothing else changing is a step back too.
		h = record(h, { ...withVars, time: 60 });
		expect(h.sessions).toHaveLength(4);
		h = record({ ...h, cursor: 0 }, s1);
		expect(h.sessions).toEqual([ignored, s1]);
	});

	it('notices structural changes but not edits to docs', () => {
		const key = structureKey(flightModes);
		expect(structureKey({ ...flightModes, doc: 'changed' })).toBe(key);
		const renamed = {
			...flightModes,
			transitions: flightModes.transitions.map((t, i) => (i === 1 ? { ...t, guard: 'x' } : t))
		};
		expect(structureKey(renamed)).not.toBe(key);
	});

	it('finds machines by qualified or simple name', () => {
		expect(findMachine([flightModes], 'FlightControl::FlightModes')).toBe(flightModes);
		expect(findMachine([flightModes], 'FlightModes')).toBe(flightModes);
		expect(findMachine([flightModes], 'Other::FlightModes')).toBe(flightModes);
		expect(findMachine([flightModes], 'Nope')).toBeUndefined();
	});
});
