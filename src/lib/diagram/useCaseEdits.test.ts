/**
 * Editing a use case diagram, on the demo: adding a use case or an actor
 * (`useCaseEdits.ts`), drawing an actor's line or an «include» and taking
 * one away (`relationships.ts`), each checked in the SysML it writes and
 * in the use case view drawn from it afterwards.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { editFiles } from '#lib/engine/toolkit/edit-testing.ts';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import { demoFiles, loadHost } from '#lib/engine/toolkit/testing.ts';
import { buildTree, collectElements, type ModelElement } from '#lib/project/elements.ts';
import type { EditStep } from '#lib/workbench/actions.ts';
import { ownersOf } from './model.ts';
import {
	defaultChoice,
	planEdgeRemoval,
	planRelation,
	relationsFor,
	type ModelContext,
	type Plan
} from './relationships.ts';
import { planAddActor, planAddUseCase, useCaseHost } from './useCaseEdits.ts';

let host: ToolkitHost;
let files: Record<string, string>;
let ctx: ModelContext;

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

/** Apply a plan's steps the way the workbench does, and check the result parses. */
function apply(plan: Plan | string): Record<string, string> {
	if (typeof plan === 'string') throw new Error(plan);
	let next = { ...files };
	for (const step of plan.steps as EditStep[]) {
		const source = next[step.path]!;
		if (step.kind === 'patch') {
			expect(source).toBe(step.before);
			next[step.path] = step.after;
			continue;
		}
		const edited = editFiles(
			host,
			next,
			step.kind === 'remove'
				? {
						op: 'remove',
						path: step.path,
						name: step.element.name,
						line: step.element.span.start_row,
						...(step.element.id ? { id: step.element.id } : {})
					}
				: step.kind === 'member'
					? {
							op: 'insertMember',
							path: step.path,
							parent: step.parent.name,
							parentLine: step.parent.span.start_row,
							...(step.parent.id ? { parentId: step.parent.id } : {}),
							text: step.text
						}
					: (() => {
							throw new Error(step.kind);
						})()
		);
		if ('error' in edited) throw new Error(edited.error);
		next = edited.files;
	}
	const analyses = host.analyzeProject(
		Object.entries(next).map(([path, text]) => ({ path, text }))
	);
	expect(analyses.flatMap((a) => a.model.syntax_errors)).toEqual([]);
	return next;
}

/** The use case view's lines after an edit. */
function drawn(texts: Record<string, string>, kind: string): string[] {
	const list = Object.entries(texts).map(([path, text]) => ({ path, text }));
	host.analyzeProject(list);
	return host
		.diagram('usecases', list, 'DroneViews::deliveryUseCases')
		.edges.filter((e) => e.kind === kind)
		.map((e) => `${e.source} -> ${e.target}`)
		.sort();
}

const named = (name: string, isDefinition = true): ModelElement => {
	const e = ctx.elements.find((x) => x.name === name && x.isDefinition === isDefinition);
	if (!e) throw new Error(`no element ${name}`);
	return e;
};

beforeAll(async () => {
	host = await loadHost();
	files = Object.fromEntries(demoFiles().map((f) => [f.path, f.text]));
	ctx = contextFor(files);
}, 60_000);

describe('connecting on a use case diagram', () => {
	it('joins an actor to a use case: an actor parameter, beside the others', () => {
		const options = relationsFor(named('AviationAuthority'), named('ChargeBattery'), ctx);
		expect(options.map((o) => `${o.kind}:${o.label}`)).toEqual(['actor:takes part in']);
		// The same from the use case's end.
		expect(
			relationsFor(named('ChargeBattery'), named('AviationAuthority'), ctx).map((o) => o.kind)
		).toEqual(['actor']);
		const option = options[0]!;
		const choice = defaultChoice(option, ctx);
		expect(choice).toEqual({ name: 'aviationAuthority' });
		const plan = planRelation(option, choice, ctx);
		expect(plan).toMatchObject({
			label: 'AviationAuthority now takes part in ChargeBattery',
			statement: 'actor aviationAuthority : AviationAuthority;'
		});
		const after = apply(plan);
		expect(after['behaviour/DeliveryUseCases.sysml']).toContain(
			'        actor operator : Operator;\n        actor aviationAuthority : AviationAuthority;\n'
		);
		expect(drawn(after, 'actor')).toContain('AviationAuthority -> ChargeBattery');
		// Twice is once.
		expect(planRelation(options[0]!, choice, contextFor(after))).toEqual(
			'AviationAuthority already takes part in ChargeBattery.'
		);
	});

	it('includes one use case in another, and specializes', () => {
		const options = relationsFor(named('PlanRoute'), named('ChargeBattery'), ctx);
		expect(options.map((o) => `${o.kind}:${o.label}`)).toEqual([
			'specialize:specializes',
			'include:includes',
			'include:is included in'
		]);
		const include = options[1]!;
		const plan = planRelation(include, defaultChoice(include, ctx), ctx);
		expect(plan).toMatchObject({
			statement: 'include use case chargeBattery : ChargeBattery;',
			label: 'PlanRoute now includes ChargeBattery'
		});
		const after = apply(plan);
		expect(drawn(after, 'include')).toEqual([
			'DeliverParcel -> VerifyDropZone',
			'PlanRoute -> ChargeBattery'
		]);
	});

	it('takes an actor’s line or an include away by removing what it draws', () => {
		const list = Object.entries(files).map(([path, text]) => ({ path, text }));
		const graph = host.diagram('usecases', list, 'DroneViews::deliveryUseCases');
		const line = graph.edges.find(
			(e) => e.kind === 'actor' && e.target === 'PlanRoute' && e.source === 'AviationAuthority'
		)!;
		const plan = planEdgeRemoval(
			'actor',
			null,
			named('AviationAuthority'),
			named('PlanRoute'),
			ctx,
			line.element
		);
		expect(plan).toMatchObject({
			label: 'AviationAuthority no longer takes part in PlanRoute',
			statement: 'actor authority : AviationAuthority;'
		});
		expect(drawn(apply(plan), 'actor')).not.toContain('AviationAuthority -> PlanRoute');
		const include = planEdgeRemoval(
			'include',
			null,
			named('DeliverParcel'),
			named('VerifyDropZone'),
			ctx
		);
		expect(include).toMatchObject({ label: 'DeliverParcel no longer includes VerifyDropZone' });
		expect(drawn(apply(include), 'include')).toEqual([]);
	});
});

describe('adding to a use case diagram', () => {
	const shown = () =>
		['DeliverParcel', 'VerifyDropZone', 'PlanRoute', 'ChargeBattery'].map((n) => named(n));

	it('writes a new use case beside the last one drawn, with its subject', () => {
		const place = useCaseHost(shown(), undefined, undefined, ctx)!;
		expect(place.host.name).toBe('DeliveryUseCases');
		const plan = planAddUseCase('ReturnParcel', place, ctx);
		expect(plan).toMatchObject({
			statement: 'use case def ReturnParcel {\n    subject drone : DeliveryDrone;\n}'
		});
		const after = apply(plan);
		const list = Object.entries(after).map(([path, text]) => ({ path, text }));
		const graph = host.diagram('usecases', list, 'DroneViews::deliveryUseCases');
		// Inside the drone's boundary.
		expect(graph.subgraphs[0]!.node_ids).toContain('ReturnParcel');
		// Next to the selected use case, when one is.
		expect(useCaseHost(shown(), named('DeliverParcel'), undefined, ctx)!.host.name).toBe(
			'DeliveryMission'
		);
		expect(planAddUseCase('PlanRoute', place, ctx)).toBe(
			'DeliveryUseCases already has something called PlanRoute.'
		);
	});

	it('adds an actor to a use case, with a part def when there is none of that name', () => {
		const actors = ['Operator', 'Recipient'].map((n) => named(n));
		const plan = planAddActor('Neighbour', named('VerifyDropZone'), actors, ctx);
		expect(plan).toMatchObject({
			label: 'Neighbour now takes part in VerifyDropZone',
			statement: 'part def Neighbour;\nactor neighbour : Neighbour;'
		});
		const after = apply(plan);
		expect(after['system/DeliveryContext.sysml']).toContain('part def Neighbour;');
		expect(drawn(after, 'actor')).toContain('Neighbour -> VerifyDropZone');
		// An existing one is only referred to.
		const again = planAddActor('Resident', named('VerifyDropZone'), actors, ctx);
		expect(again).toMatchObject({ statement: 'actor resident : Resident;' });
		expect((again as Plan).steps).toHaveLength(1);
	});
});
