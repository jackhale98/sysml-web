import { beforeAll, describe, expect, it } from 'vitest';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import { demoFiles, loadHost } from '#lib/engine/toolkit/testing.ts';
import type { DiagramGraph } from '#lib/engine/types.ts';
import { buildTree, collectElements, type ModelElement } from '#lib/project/elements.ts';
import type { EditStep } from '#lib/workbench/actions.ts';
import { ownersOf, qualifiedName } from './model.ts';
import type { ModelContext } from './relationships.ts';
import {
	chooseNeighbours,
	coverage,
	exposesOf,
	neighbours,
	planExpose,
	planUnexpose,
	withoutHidden
} from './viewEdits.ts';

let host: ToolkitHost;
let files: Record<string, string>;
let ctx: ModelContext;
const VIEWS = 'views/Views.sysml';

function contextFor(texts: Record<string, string>): ModelContext {
	const list = Object.entries(texts).map(([path, text]) => ({ path, text }));
	const analyses = host.analyzeProject(list);
	const elements = collectElements(analyses);
	return {
		elements,
		owners: ownersOf(buildTree(elements)),
		textOf: (path) => texts[path],
		analyses
	};
}

const find = (qualified: string, c = ctx): ModelElement => {
	const found = c.elements.find((e) => qualifiedName(e, c.owners) === qualified);
	if (!found) throw new Error(`no ${qualified}`);
	return found;
};

function patched(steps: EditStep[]): Record<string, string> {
	const next = { ...files };
	for (const step of steps) {
		if (step.kind !== 'patch') throw new Error('only patches');
		expect(next[step.path]).toBe(step.before);
		next[step.path] = step.after;
	}
	return next;
}

/** What the general view of a saved view draws, from the edited texts. */
function drawn(texts: Record<string, string>, view: string): string[] {
	const list = Object.entries(texts).map(([path, text]) => ({ path, text }));
	return host
		.diagram('general', list, view)
		.nodes.map((n) => n.id)
		.sort();
}

beforeAll(async () => {
	host = await loadHost();
	files = Object.fromEntries(demoFiles().map((f) => [f.path, f.text]));
	ctx = contextFor(files);
}, 60_000);

describe('a saved view’s expose lines', () => {
	it('reads each expose, with what it takes in', () => {
		const tree = find('DroneViews::requirementTree');
		expect(exposesOf(tree, ctx).map((e) => [e.target, e.members])).toEqual([
			['StakeholderNeeds', '*'],
			['SystemRequirements', '*']
		]);
		const breakdown = find('DroneViews::droneBreakdown');
		const [drone] = exposesOf(breakdown, ctx);
		expect(drone).toMatchObject({ target: 'DroneArchitecture::drone', members: '**' });
		expect(files[VIEWS]!.slice(drone!.from, drone!.to)).toBe(
			'expose DroneArchitecture::drone::**;'
		);
	});

	it('tells whether an expose shows an element itself, inside it, or not', () => {
		const e = (target: string, members: '' | '*' | '**' | '*::**') => ({
			target,
			members,
			from: 0,
			to: 0
		});
		expect(coverage(e('P::a', ''), 'P::a')).toBe('itself');
		expect(coverage(e('a', ''), 'P::a')).toBe('itself');
		expect(coverage(e('P', '*'), 'P::a')).toBe('inside');
		expect(coverage(e('P', '*'), 'P::a::b')).toBeNull();
		expect(coverage(e('P', '**'), 'P::a::b')).toBe('inside');
		expect(coverage(e('P', '**'), 'P')).toBe('itself');
		expect(coverage(e('P', '*::**'), 'P')).toBeNull();
		expect(coverage(e("'Q R'", ''), "P::'Q R'")).toBe('itself');
		expect(coverage(e('P', ''), 'P::a')).toBeNull();
	});
});

describe('removing an element from a saved view', () => {
	it('removes the expose that names it, and the diagram no longer draws it', () => {
		// A view that exposes two things by name.
		const text = files[VIEWS]!.replace(
			'expose DroneComponents::*;\n',
			'expose DroneComponents::Battery;\n        expose DroneComponents::Motor;\n'
		);
		const texts = { ...files, [VIEWS]: text };
		const c = contextFor(texts);
		const view = find('DroneViews::componentCatalogue', c);
		expect(drawn(texts, 'DroneViews::componentCatalogue')).toEqual(['Battery', 'Motor']);
		const plan = planUnexpose(view, find('DroneComponents::Motor', c), c);
		expect(plan.stillShown).toBe(false);
		expect(plan.removed).toEqual(['expose DroneComponents::Motor;']);
		const step = plan.steps[0]!;
		if (step.kind !== 'patch') throw new Error('a patch');
		expect(step.after).toContain('expose DroneComponents::Battery;\n        filter');
		expect(drawn({ ...texts, [VIEWS]: step.after }, 'DroneViews::componentCatalogue')).toEqual([
			'Battery'
		]);
	});

	it('only hides what a wildcard shows, or what the last expose names', () => {
		const catalogue = find('DroneViews::componentCatalogue');
		expect(planUnexpose(catalogue, find('DroneComponents::Battery'), ctx)).toEqual({
			steps: [],
			removed: [],
			stillShown: true
		});
		// Removing the only expose would show the whole model: it is hidden instead.
		const text = files[VIEWS]!.replace(
			'expose DroneComponents::*;',
			'expose DroneComponents::Battery;'
		);
		const c = contextFor({ ...files, [VIEWS]: text });
		const plan = planUnexpose(
			find('DroneViews::componentCatalogue', c),
			find('DroneComponents::Battery', c),
			c
		);
		expect(plan).toMatchObject({ steps: [], stillShown: true });
	});

	it('removes its own expose and still hides it when a wildcard shows it too', () => {
		const text = files[VIEWS]!.replace(
			'expose DroneComponents::*;',
			'expose DroneComponents::*;\n        expose DroneComponents::Battery;'
		);
		const c = contextFor({ ...files, [VIEWS]: text });
		const plan = planUnexpose(
			find('DroneViews::componentCatalogue', c),
			find('DroneComponents::Battery', c),
			c
		);
		expect(plan.stillShown).toBe(true);
		expect(plan.removed).toEqual(['expose DroneComponents::Battery;']);
	});
});

describe('adding elements to a saved view', () => {
	it('writes an expose for each, by its qualified name, after the last one', () => {
		const tree = find('DroneViews::requirementTree');
		const plan = planExpose(
			tree,
			[find('DroneArchitecture::drone'), find('DroneArchitecture::drone')],
			ctx
		)!;
		expect(plan.added.map((e) => e.name)).toEqual(['drone']);
		const texts = patched(plan.steps);
		expect(texts[VIEWS]).toContain(
			'expose SystemRequirements::*;\n        expose DroneArchitecture::drone;\n        filter'
		);
		// The filter keeps requirements only, so the part is exposed but not drawn.
		expect(drawn(texts, 'DroneViews::requirementTree')).toEqual(
			drawn(files, 'DroneViews::requirementTree')
		);
		const catalogue = planExpose(
			find('DroneViews::droneBreakdown'),
			[find('DroneArchitecture::DeliveryDrone')],
			ctx
		)!;
		expect(
			drawn(patched(catalogue.steps), 'DroneViews::droneBreakdown').includes('DeliveryDrone')
		).toBe(false);
	});

	it('adds nothing an expose already names', () => {
		const breakdown = find('DroneViews::droneBreakdown');
		expect(planExpose(breakdown, [find('DroneArchitecture::drone')], ctx)).toBeNull();
	});
});

describe('hidden nodes', () => {
	const graph: DiagramGraph = {
		title: 'gv [x]',
		nodes: ['a', 'b', 'c'].map((id) => ({
			id,
			label: id,
			kind: 'block',
			stereotype: null,
			attributes: [],
			is_definition: true
		})),
		edges: [
			{ source: 'a', target: 'b', label: null, kind: 'composition' },
			{ source: 'b', target: 'c', label: null, kind: 'composition' }
		],
		subgraphs: [{ id: 's', label: 's', node_ids: ['a', 'b'] }],
		direction: 'top_bottom'
	};

	it('leaves them and their lines out', () => {
		const shown = withoutHidden(graph, ['b', 'gone']);
		expect(shown.nodes.map((n) => n.id)).toEqual(['a', 'c']);
		expect(shown.edges).toEqual([]);
		expect(shown.subgraphs[0]!.node_ids).toEqual(['a']);
		expect(withoutHidden(graph, ['gone'])).toBe(graph);
	});
});

describe('connected elements', () => {
	it('are the project’s elements related each way that are not drawn yet', () => {
		const battery = find('DroneArchitecture::drone::battery');
		const related = host.related(demoFiles(), battery.id!);
		const drawn = new Set([find('DroneComponents::Battery').key]);
		const list = neighbours(related, ctx.elements, drawn);
		const names = (direction: 'out' | 'in' | 'both') =>
			chooseNeighbours(list, direction)
				.map((n) => qualifiedName(n.element, ctx.owners))
				.sort();
		// Its type is drawn already; what it satisfies and is wired to is not.
		expect(names('out')).toEqual(
			expect.arrayContaining([
				"SystemRequirements::'Battery protection'",
				'DroneArchitecture::drone::powerDistribution'
			])
		);
		expect(names('out')).not.toContain('DroneComponents::Battery');
		const both = names('both');
		expect(new Set(both).size).toBe(both.length);
		expect(both.length).toBeGreaterThanOrEqual(names('out').length);
		// Each comes with the name the engine adds it to a diagram by.
		const requirement = list.find((n) => n.element.label === 'Battery protection')!;
		expect(requirement.qualified).toBe("SystemRequirements::'Battery protection'");
	});
});
