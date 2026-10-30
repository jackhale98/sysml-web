/**
 * The use case view (`usecases.ts`) on the demo's delivery use cases, and
 * on small models for what the demo doesn't have: specialization between
 * use cases and between actors, a use case usage in a part, actors that
 * redefine their use case def's.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { DiagramGraph } from '../../types';
import type { ToolkitHost } from '../host';
import { demoFiles, loadHost } from '../testing';

let host: ToolkitHost;

beforeAll(async () => {
	host = await loadHost();
}, 60_000);

const lines = (g: DiagramGraph, kind?: string) =>
	g.edges
		.filter((e) => !kind || e.kind === kind)
		.map((e) => `${e.source} -${e.kind}-> ${e.target}`)
		.sort();
const kinds = (g: DiagramGraph) => g.nodes.map((n) => [n.id, n.kind]);

function draw(text: string, scope: string | null) {
	const files = [{ path: 'UseCases.sysml', text }];
	const [analysis] = host.analyzeProject(files);
	expect([...analysis!.model.syntax_errors, ...analysis!.diagnostics]).toEqual([]);
	return host.diagram('usecases', files, scope);
}

describe('use case view', () => {
	it('draws the delivery service: use cases in the drone’s boundary, actors joined to theirs', () => {
		const files = demoFiles();
		host.analyzeProject(files);
		const g = host.diagram('usecases', files, 'DroneViews::deliveryUseCases');
		expect(g.title).toBe('uc [deliveryUseCases]');
		expect(kinds(g)).toEqual([
			['DeliverParcel', 'use_case'],
			// What a use case includes comes right after it.
			['VerifyDropZone', 'use_case'],
			['PlanRoute', 'use_case'],
			['ChargeBattery', 'use_case'],
			['Operator', 'actor'],
			['Recipient', 'actor'],
			['AviationAuthority', 'actor']
		]);
		// One figure per kind of actor, joined to every use case it takes part in.
		expect(lines(g, 'actor')).toEqual([
			'AviationAuthority -actor-> PlanRoute',
			'Operator -actor-> ChargeBattery',
			'Operator -actor-> DeliverParcel',
			'Operator -actor-> PlanRoute',
			'Recipient -actor-> DeliverParcel',
			'Recipient -actor-> VerifyDropZone'
		]);
		expect(lines(g, 'include')).toEqual(['DeliverParcel -include-> VerifyDropZone']);
		// Every use case is the drone's: one boundary holds them all, the actors stay outside.
		expect(g.subgraphs).toEqual([
			{
				id: expect.stringMatching(/^subject:/),
				label: 'DeliveryDrone',
				node_ids: ['DeliverParcel', 'VerifyDropZone', 'PlanRoute', 'ChargeBattery']
			}
		]);
		const deliver = g.nodes.find((n) => n.id === 'DeliverParcel')!;
		expect(deliver).toMatchObject({ stereotype: '<<use case def>>', is_definition: true });
		expect(deliver.attributes).toEqual([
			[
				'objective',
				'The recipient has the parcel, undamaged, and the drone is back at the depot ready for its next flight.'
			]
		]);
		// The line from an actor is the actor parameter, where it is written.
		const operator = g.edges.find((e) => e.kind === 'actor' && e.target === 'PlanRoute')!;
		expect(operator.element?.file).toBe('behaviour/DeliveryUseCases.sysml');
		const text = files.find((f) => f.path === operator.element!.file)!.text;
		expect(
			new TextDecoder()
				.decode(new TextEncoder().encode(text).slice(operator.element!.start_byte))
				.startsWith('actor operator : Operator;')
		).toBe(true);
	});

	it('draws a part’s use cases with the subject and actors their definition names', () => {
		const files = demoFiles();
		host.analyzeProject(files);
		const g = host.diagram('usecases', files, 'DeliveryContext::deliveryService');
		expect(kinds(g)).toEqual([
			['deliverParcel', 'use_case'],
			['Operator', 'actor'],
			['Recipient', 'actor']
		]);
		expect(g.nodes[0]).toMatchObject({
			label: 'deliverParcel : DeliverParcel',
			stereotype: '<<use case>>'
		});
		// `actor :>> operator = deliveryService.operator` is typed by what it redefines.
		expect(lines(g)).toEqual([
			'Operator -actor-> deliverParcel',
			'Recipient -actor-> deliverParcel'
		]);
		// Its subject redefines DeliverParcel's, a DeliveryDrone.
		expect(g.subgraphs.map((s) => [s.label, s.node_ids])).toEqual([
			['DeliveryDrone', ['deliverParcel']]
		]);
		// Without a subject, a use case usage is the part's it belongs to.
		const own = draw(
			`package Depot {
				part depot { use case unload { actor driver; } }
			}`,
			'Depot::depot'
		);
		expect(own.subgraphs.map((s) => [s.label, s.node_ids])).toEqual([['depot', ['unload']]]);
		expect(lines(own)).toEqual(['driver -actor-> unload']);
	});

	it('draws specialization between use cases and between actors, and includes it must pull in', () => {
		const g = draw(
			`package Shop {
				part def System;
				part def Person;
				part def Customer :> Person;
				part def Clerk :> Person;
				use case def Buy {
					subject shop : System;
					actor customer : Customer;
					include use case pay : Pay;
				}
				use case def BuyOnline :> Buy {
					actor helper : Person;
				}
				use case def Pay {
					subject shop : System;
					actor clerk : Clerk;
				}
				use case def Browse;
			}`,
			'Shop'
		);
		expect(kinds(g)).toEqual([
			['Buy', 'use_case'],
			['Pay', 'use_case'],
			['BuyOnline', 'use_case'],
			['Browse', 'use_case'],
			['Customer', 'actor'],
			['Clerk', 'actor'],
			['Person', 'actor']
		]);
		expect(lines(g, 'specialization')).toEqual([
			'BuyOnline -specialization-> Buy',
			'Clerk -specialization-> Person',
			'Customer -specialization-> Person'
		]);
		expect(lines(g, 'include')).toEqual(['Buy -include-> Pay']);
		// BuyOnline inherits Buy's subject; Browse has none, so no boundary.
		expect(g.subgraphs.map((s) => [s.label, s.node_ids])).toEqual([
			['System', ['Buy', 'Pay', 'BuyOnline']]
		]);
		// A use case drawn for an include, outside the scope, still gets its actors.
		const only = draw(
			`package Shop {
				part def Clerk;
				use case def Buy { include use case pay : Other::Pay; }
			}
			package Other {
				use case def Pay { actor clerk : Shop::Clerk; }
			}`,
			'Shop::Buy'
		);
		expect(lines(only)).toEqual(['Buy -include-> Pay', 'Clerk -actor-> Pay']);
	});

	it('draws every use case of the project without a scope, and nothing for an unknown one', () => {
		const text = `package A { use case def One { actor someone; } use case def Two; }`;
		expect(kinds(draw(text, null))).toEqual([
			['One', 'use_case'],
			['Two', 'use_case'],
			['someone', 'actor']
		]);
		expect(draw(text, 'Nowhere').nodes).toEqual([]);
	});
});
