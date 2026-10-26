import { describe, expect, it } from 'vitest';
import type { StateMachine } from '#lib/engine/types.ts';
import { flightModes, nestedMachine } from './fixtures.ts';
import { reachability } from './reachability.ts';

type S = StateMachine['states'][number];
type T = StateMachine['transitions'][number];

function machine(
	states: Partial<S>[],
	transitions: Partial<T>[],
	extra: Partial<StateMachine> = {}
) {
	return {
		name: 'M',
		file: 'm.sysml',
		line: 1,
		states: states.map((s, i) => ({ label: s.name!, kind: 'state', line: i + 2, ...s }) as S),
		transitions: transitions.map((t, i) => ({ line: 20 + i, ...t }) as T),
		variables: [],
		...extra
	} satisfies StateMachine;
}

describe('reachability', () => {
	it('finds states no transition reaches and the transitions out of them', () => {
		const m = machine(
			[
				{ name: 'entry', kind: 'initial' },
				{ name: 'a' },
				{ name: 'b' },
				{ name: 'island' },
				{ name: 'c' }
			],
			[
				{ from: 'entry', to: 'a' },
				{ from: 'a', to: 'b', trigger: 'Go' },
				{ name: 'away', from: 'island', to: 'c', trigger: 'Go' }
			]
		);
		expect(reachability(m)).toEqual({
			unreachable: ['island', 'c'],
			dead: [{ index: 2, label: 'away', reason: 'its source `island` cannot be reached' }]
		});
	});

	it('a guard that is always false never fires, and what only it reaches is unreachable', () => {
		const m = machine(
			[{ name: 'entry', kind: 'initial' }, { name: 'a' }, { name: 'b' }, { name: 'c' }],
			[
				{ from: 'entry', to: 'a' },
				{ name: 'never', from: 'a', to: 'b', trigger: 'Go', guard: 'false' },
				{ name: 'maybe', from: 'a', to: 'c', trigger: 'Go', guard: 'x > 1' },
				{ name: 'off', from: 'a', to: 'c', trigger: 'when 1 > 2' }
			]
		);
		expect(reachability(m)).toEqual({
			unreachable: ['b'],
			dead: [
				{ index: 1, label: 'never', reason: 'its guard `false` is always false' },
				{ index: 3, label: 'off', reason: 'its condition `1 > 2` is never true' }
			]
		});
	});

	it('a transition with no trigger and no guard out of a simple state shadows the others from it', () => {
		const m = machine(
			[
				{ name: 'entry', kind: 'initial' },
				{ name: 'a' },
				{ name: 'b' },
				{ name: 'c' },
				{ name: 'd' }
			],
			[
				{ from: 'entry', to: 'a' },
				{ name: 'early', from: 'a', to: 'c', trigger: 'Go' },
				{ name: 'next', from: 'a', to: 'b' },
				{ name: 'later', from: 'a', to: 'd' }
			]
		);
		const r = reachability(m);
		expect(r.unreachable).toEqual(['c', 'd']);
		expect(r.dead).toEqual([
			{
				index: 1,
				label: 'early',
				reason: '`next` always fires first: it has no trigger and no guard'
			},
			{
				index: 3,
				label: 'later',
				reason: '`next` always fires first: it has no trigger and no guard'
			}
		]);
	});

	it('a composite state’s completion transition waits for its regions, so it shadows nothing', () => {
		const m = machine(
			[
				{ name: 'entry', kind: 'initial' },
				{ name: 'p' },
				{ name: 'p.entry', kind: 'initial', parent: 'p' },
				{ name: 'p.x', parent: 'p' },
				{ name: 'q' },
				{ name: 'r' }
			],
			[
				{ from: 'entry', to: 'p' },
				{ from: 'p.entry', to: 'p.x' },
				{ from: 'p', to: 'q' },
				{ from: 'p', to: 'r', trigger: 'Abort' }
			]
		);
		expect(reachability(m)).toEqual({ unreachable: [], dead: [] });
	});

	it('every initial transition may be taken (their guards are not read), and a parallel state enters each region', () => {
		const m = machine(
			[
				{ name: 'entry', kind: 'initial' },
				{ name: 'on' },
				{ name: 'off' },
				{ name: 'p', parallel: true },
				{ name: 'p.r1', parent: 'p' },
				{ name: 'p.r1.x', parent: 'p.r1' },
				{ name: 'p.r2', parent: 'p' },
				{ name: 'p.r2.y', parent: 'p.r2' }
			],
			[
				{ from: 'entry', to: 'on', guard: 'startOn' },
				{ from: 'entry', to: 'off', guard: 'not startOn' },
				{ from: 'off', to: 'p', trigger: 'Go' }
			]
		);
		expect(reachability(m)).toEqual({ unreachable: [], dead: [] });
	});

	it('finds nothing in the demo’s machines', () => {
		expect(reachability(flightModes)).toEqual({ unreachable: [], dead: [] });
		expect(reachability(nestedMachine)).toEqual({ unreachable: [], dead: [] });
	});
});
