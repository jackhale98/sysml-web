import { describe, expect, it } from 'vitest';
import type { DiagramNode } from '#lib/engine/types.ts';
import { edgeLabelText, notationOf } from './notation.ts';
import { nodeSize } from './layout.ts';

const node = (over: Partial<DiagramNode>): DiagramNode => ({
	id: 'X',
	label: 'X',
	kind: 'block',
	stereotype: null,
	attributes: [],
	is_definition: false,
	...over
});

describe('notationOf', () => {
	it('reads definitions from the stereotype and groups features into compartments', () => {
		const n = notationOf(
			node({
				stereotype: '<<part def>>',
				is_definition: true,
				attributes: [
					['modifier', 'abstract'],
					['part', 'battery : Battery'],
					['attribute', 'mass : MassValue'],
					['part', 'frame : Frame'],
					['in port', 'power : ~PowerPort']
				]
			}),
			'general'
		);
		expect(n.keyword).toBe('part def');
		expect(n.isDefinition).toBe(true);
		expect(n.isAbstract).toBe(true);
		expect(n.family).toBe('structure');
		expect(n.compartments).toEqual([
			{ title: 'parts', rows: ['battery : Battery', 'frame : Frame'] },
			{ title: 'attributes', rows: ['mass : MassValue'] },
			{ title: 'ports', rows: ['in power : ~PowerPort'] }
		]);
	});

	it("lists a state's entry, do and exit actions, and a view's exposes and filters", () => {
		const state = notationOf(
			node({
				kind: 'state',
				attributes: [
					['entry', 'alertOperator'],
					['do', 'followFlightPlan']
				]
			}),
			'states'
		);
		expect(state.compartments).toEqual([
			{ title: 'actions', rows: ['entry / alertOperator', 'do / followFlightPlan'] }
		]);
		const view = notationOf(
			node({
				stereotype: '<<view>>',
				attributes: [
					['expose', 'DroneComponents::*'],
					['filter', '@SysML::PartDefinition'],
					['render', 'asTreeDiagram']
				]
			}),
			'general'
		);
		expect(view.compartments.map((c) => c.title)).toEqual(['exposes', 'filters', 'rendering']);
	});

	it('treats a "def" stereotype as a definition even when the flag is unset', () => {
		const n = notationOf(node({ stereotype: '<<requirement def>>' }), 'packages');
		expect(n.isDefinition).toBe(true);
		expect(n.family).toBe('requirement');
	});

	it('shows part usages as rounded usages and puts ports on the border in interconnection views', () => {
		const n = notationOf(
			node({
				attributes: [
					['out port', 'thrust : Thrust'],
					['port', 'data : Bus']
				]
			}),
			'interconnection'
		);
		expect(n.keyword).toBe('part');
		expect(n.isDefinition).toBe(false);
		expect(n.compartments).toEqual([]);
		expect(n.ports).toEqual([
			{ label: 'out thrust : Thrust', side: 'right' },
			{ label: 'data : Bus', side: 'left' }
		]);
	});

	it('draws packages as folders and leaves control flow out of compartments', () => {
		const pkg = notationOf(
			node({
				stereotype: '<<package>>',
				is_definition: true,
				attributes: [['part', 'drone : Drone']]
			}),
			'general'
		);
		expect(pkg.shape).toBe('package');
		expect(pkg.keyword).toBe('package');
		expect(pkg.isDefinition).toBe(false);
		const action = notationOf(
			node({
				stereotype: '<<action def>>',
				attributes: [
					['then_succession', 'takeOff'],
					['join_node', 'j'],
					['objective', ''],
					['action', 'descend']
				]
			}),
			'general'
		);
		expect(action.compartments).toEqual([{ title: 'actions', rows: ['descend'] }]);
	});

	it('keeps requirement text as documentation', () => {
		const n = notationOf(
			node({
				kind: 'requirement',
				stereotype: '<<requirement def>>',
				attributes: [['text', 'Fly.']]
			}),
			'requirements'
		);
		expect(n.doc).toBe('Fly.');
		expect(n.compartments).toEqual([]);
	});
});

describe('nodeSize', () => {
	it('grows with compartments and stays within bounds', () => {
		const small = nodeSize(node({ stereotype: '<<part def>>' }));
		const big = nodeSize(
			node({
				stereotype: '<<part def>>',
				attributes: [
					['part', 'a : A'],
					['attribute', 'b : B']
				]
			})
		);
		expect(big.height).toBeGreaterThan(small.height);
		expect(nodeSize(node({ label: 'x'.repeat(200) })).width).toBeLessThanOrEqual(320);
	});
});

describe('edgeLabelText', () => {
	it('drops a label that repeats the keyword and unwraps item types', () => {
		expect(edgeLabelText('satisfy', '<<satisfy>>')).toBeNull();
		expect(edgeLabelText('flow', '<<Power>>')).toBe('Power');
	});
});
