import { describe, expect, it } from 'vitest';
import { parseAction } from './actions.ts';
import { advance, begin, graphOf, initialNodes, runBody, type FlowHost } from './flow.ts';
import { elkFlowGraph } from './flow-layout.ts';

const host: FlowHost = {
	send: () => 'queued',
	resolve: () => null,
	canWait: true,
	choose: 'wait'
};

const DELIVERY = `
	in item flightPlan : FlightPlan;
	first start;
	then action takeOff { }
	then action flyToDropPoint { in item plan : FlightPlan = flightPlan; }
	then fork;
		then descend;
		then checkDropZone;
	action descend { }
	then atDropPoint;
	action checkDropZone { out attribute isClear : Boolean default true; }
	then atDropPoint;
	join atDropPoint;
	then decide;
		if checkDropZone.isClear then releaseParcel;
		else keepParcel;
	action releaseParcel { }
	then readyToReturn;
	action keepParcel { }
	then readyToReturn;
	merge readyToReturn;
	then action returnHome { }
	then action land { }
	then done;`;

describe('the graph of an action', () => {
	it('names its nodes as the action flow diagram does, and joins them as the text says', () => {
		const graph = graphOf(parseAction(DELIVERY));
		expect(graph.nodes.map((n) => `${n.id}:${n.kind}`)).toEqual([
			'start:start',
			'takeOff:action',
			'flyToDropPoint:action',
			'fork#1:fork',
			'descend:action',
			'checkDropZone:action',
			'atDropPoint:join',
			'decide#1:decide',
			'releaseParcel:action',
			'keepParcel:action',
			'readyToReturn:merge',
			'returnHome:action',
			'land:action',
			'done:done'
		]);
		// `then` after `then fork;` comes from the fork: successions are not the step before.
		expect(graph.edges.map((e) => `${e.from}->${e.to}${e.guard ? ` [${e.guard}]` : ''}`)).toEqual([
			'start->takeOff',
			'takeOff->flyToDropPoint',
			'flyToDropPoint->fork#1',
			'fork#1->descend',
			'fork#1->checkDropZone',
			'descend->atDropPoint',
			'checkDropZone->atDropPoint',
			'atDropPoint->decide#1',
			'decide#1->releaseParcel [checkDropZone.isClear]',
			'decide#1->keepParcel [else]',
			'releaseParcel->readyToReturn',
			'keepParcel->readyToReturn',
			'readyToReturn->returnHome',
			'returnHome->land',
			'land->done'
		]);
		expect(graph.features.map((f) => f.name)).toEqual(['flightPlan']);
		expect(initialNodes(graph).map((n) => n.id)).toEqual(['start']);
		expect(graph.notes).toEqual([]);
	});

	it('notes a succession to a step the action does not have', () => {
		const graph = graphOf(parseAction('first start; then nowhere;'));
		expect(graph.notes).toEqual(['`nowhere` is not a step of this action']);
	});

	it('lays out every node and succession, with the guards as labels', () => {
		const graph = graphOf(parseAction(DELIVERY));
		const elk = elkFlowGraph(graph, 'DOWN');
		expect(elk.children).toHaveLength(graph.nodes.length);
		expect(elk.edges!.flatMap((e) => e.labels!.map((l) => l.text))).toEqual([
			'[checkDropZone.isClear]',
			'[else]'
		]);
		const bar = elk.children!.find((c) => c.id === 'fork#1')!;
		expect(bar.width).toBeGreaterThan(bar.height!);
	});
});

describe('a run', () => {
	it('is plain JSON between steps, and gives the same run from the same moves', () => {
		const graph = graphOf(parseAction(DELIVERY));
		const play = () => {
			let { state } = begin(graph, host);
			const states = [JSON.stringify(state)];
			for (let i = 0; i < 6; i++) {
				state = JSON.parse(JSON.stringify(advance(graph, host, state).state));
				states.push(JSON.stringify(state));
			}
			return states;
		};
		const once = play();
		expect(play()).toEqual(once);
		expect(JSON.parse(once.at(-1)!).root.done).toBe(true);
	});

	it('in one go (a state’s action): an accept ends it, with a note', () => {
		const notes = runBody(parseAction('assign n := 1; then accept Go; then assign n := 2;'), {
			send: () => 'queued',
			resolve: () => null
		});
		expect(notes).toEqual([
			'`accept Go` waits for a signal; the action runs within one step of the machine, so it does not wait, and the steps after it were not run'
		]);
	});
});
