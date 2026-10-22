/**
 * The Sequence View (`sequence.ts`) on the demo's delivery interaction and
 * on small interactions written the other ways the specification's
 * examples write them: ends through event occurrences, events that name
 * the message they belong to, and `first a then b`.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { DiagramGraph } from '../../types';
import type { ToolkitHost } from '../host';
import { demoFiles, loadHost } from '../testing';
import { readMessageHeader, splitPath } from './sequence';

let host: ToolkitHost;

beforeAll(async () => {
	host = await loadHost();
}, 60_000);

const arrows = (g: DiagramGraph) => g.edges.map((e) => `${e.source} -> ${e.target}: ${e.label}`);

function draw(text: string, scope: string) {
	const files = [{ path: 'Interaction.sysml', text }];
	const [analysis] = host.analyzeProject(files);
	expect([...analysis!.model.syntax_errors, ...analysis!.diagnostics]).toEqual([]);
	return host.diagram('sequence', files, scope);
}

describe('sequence view', () => {
	it('draws the delivery: lifelines in declaration order, messages in time order', () => {
		const files = demoFiles();
		host.analyzeProject(files);
		const started = performance.now();
		const g = host.diagram('sequence', files, 'ParcelDelivery');
		expect(performance.now() - started).toBeLessThan(50);
		expect(g.title).toBe('sv [ParcelDelivery]');
		expect(g.nodes.map((n) => [n.id, n.label, n.kind, n.stereotype])).toEqual([
			['operator', 'operator : Operator', 'lifeline', '<<ref part>>'],
			['groundStation', 'groundStation : GroundStation', 'lifeline', '<<ref part>>'],
			['drone', 'drone : DeliveryDrone', 'lifeline', '<<ref part>>'],
			['recipient', 'recipient : Recipient', 'lifeline', '<<ref part>>']
		]);
		expect(arrows(g)).toEqual([
			'operator -> groundStation: planDelivery of FlightPlan',
			'groundStation -> drone: uploadPlan of FlightPlan',
			'drone -> groundStation: preflightReport of Telemetry',
			'operator -> groundStation: launch of TakeOffCommand',
			'groundStation -> drone: takeOff of TakeOffCommand',
			'drone -> groundStation: flightStatus of Telemetry',
			'drone -> recipient: handOver of Parcel',
			'drone -> groundStation: deliveryReport of Telemetry'
		]);
		// Each message is the element it draws, with its details.
		const first = g.edges[0]!;
		expect(first.kind).toBe('message');
		expect(first.element?.file).toBe('behaviour/DeliverySequence.sysml');
		expect(first.message).toEqual({
			name: 'planDelivery',
			payload: 'FlightPlan',
			doc: "The operator plans the route to the recipient's drop point."
		});
		// A lifeline without a doc of its own shows its type's.
		expect(g.nodes[0]!.attributes).toEqual([
			['doc', 'The remote pilot who plans and supervises delivery flights at the depot.']
		]);
		// Every lifeline and message is an element of the model, so it can be selected.
		const keys = new Set(
			host
				.analyzeProject(files)
				.flatMap((a) => a.model.usages.map((u) => `${a.model.file}@${u.span.start_byte}`))
		);
		for (const x of [...g.nodes, ...g.edges])
			expect(keys.has(`${x.element!.file}@${x.element!.start_byte}`)).toBe(true);
	});

	it('orders messages by the events on each lifeline, not as declared', () => {
		const g = draw(
			`package P {
				item def Request;
				item def Reply;
				item def Note;
				occurrence def Exchange {
					part client {
						event occurrence requestSent;
						then event occurrence replyReceived;
					}
					message reply of Reply from server.replySent to client.replyReceived;
					part server {
						event occurrence requestReceived;
						then event occurrence auditSent;
						then event occurrence auditReceived;
						then event occurrence replySent;
					}
					message request of r : Request [1] from client.requestSent to server.requestReceived;
					message audit of Note from server.auditSent to server.auditReceived;
				}
			}`,
			'Exchange'
		);
		expect(g.nodes.map((n) => n.id)).toEqual(['client', 'server']);
		expect(arrows(g)).toEqual([
			'client -> server: request of Request',
			'server -> server: audit of Note',
			'server -> client: reply of Reply'
		]);
		expect(g.edges[0]!.message).toMatchObject({
			sourceEvent: 'requestSent',
			targetEvent: 'requestReceived'
		});
	});

	it('takes a message’s ends from the events that name it, and orders by first … then', () => {
		const text = `package P {
				item def Ping;
				item def Pong;
				part def Node;
				occurrence def PingPong {
					ref part a : Node {
						event ping.sourceEvent;
						then event pong.targetEvent;
					}
					ref part b : Node {
						event ping.targetEvent;
						then event pong.sourceEvent;
					}
					message pong of Pong;
					message ping of Ping;
				}
				occurrence def Ordered {
					part x;
					part y;
					message first_ from x to y;
					message second from y to x;
					first second then first_;
				}
			}`;
		const g = draw(text, 'PingPong');
		expect(arrows(g)).toEqual(['a -> b: ping of Ping', 'b -> a: pong of Pong']);
		const ordered = host.diagram('sequence', [{ path: 'Interaction.sysml', text }], 'Ordered');
		expect(arrows(ordered)).toEqual(['y -> x: second', 'x -> y: first_']);
	});

	it('reads message headers and paths as written', () => {
		expect(readMessageHeader('then message m of p : T [1] = x.p from a.b to c.d')).toEqual({
			payload: 'T',
			from: 'a.b',
			to: 'c.d'
		});
		expect(readMessageHeader('message m of Publish[1] from p.e to s.e')).toEqual({
			payload: 'Publish',
			from: 'p.e',
			to: 's.e'
		});
		expect(readMessageHeader('message m;')).toEqual({ payload: null, from: null, to: null });
		expect(splitPath("a.'b c'.d")).toEqual(['a', 'b c', 'd']);
	});
});
