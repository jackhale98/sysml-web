/**
 * How the demo's elements are related (`ToolkitHost.related`), and a general
 * view drawing elements added to it.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { RelatedElement } from '../../types';
import type { ToolkitHost } from '../host';
import { demoFiles, loadHost } from '../testing';

let host: ToolkitHost;
const files = demoFiles();

beforeAll(async () => {
	host = await loadHost();
	host.analyzeProject(files);
}, 60_000);

/** The id of the element with this qualified name. */
function idOf(qualified: string): string {
	const found = host
		.analyzeProject(files)
		.flatMap((a) => [...a.model.definitions, ...a.model.usages])
		.find((e) => e.qualified_name === qualified);
	if (!found?.id) throw new Error(`no ${qualified}`);
	return found.id;
}

const show = (list: RelatedElement[]) =>
	list
		.map((r) => `${r.direction} ${r.kind} ${r.element.qualifiedName}${r.via ? ` (${r.via})` : ''}`)
		.sort();

describe('related elements', () => {
	it('a part: what defines it, what it satisfies, what it is wired and allocated to', () => {
		const started = performance.now();
		const battery = show(host.related(files, idOf('DroneArchitecture::drone::battery')));
		expect(performance.now() - started).toBeLessThan(1000);
		expect(battery).toEqual(
			expect.arrayContaining([
				'out typed DroneComponents::Battery',
				"out satisfies SystemRequirements::'Battery protection'",
				'out connects DroneArchitecture::drone::powerDistribution (batteryPower)'
			])
		);
		const controller = show(
			host.related(files, idOf('DroneArchitecture::drone::flightController'))
		);
		expect(controller).toEqual(
			expect.arrayContaining([
				'in allocates DeliveryMission::DeliveryFlight::takeOff',
				'in flows DroneArchitecture::drone::gnss',
				'out flows DroneArchitecture::drone::frontLeft',
				'in connects DroneArchitecture::drone::radio (radioCable)'
			])
		);
	});

	it('a definition: what specializes it and what it is used as, and its supertype', () => {
		const battery = show(host.related(files, idOf('DroneComponents::Battery')));
		expect(battery).toEqual(
			expect.arrayContaining([
				'out specializes DroneComponents::Component',
				'in typed DroneArchitecture::drone::battery'
			])
		);
		const component = show(host.related(files, idOf('DroneComponents::Component')));
		expect(component.filter((r) => r.startsWith('in specializes')).length).toBeGreaterThan(5);
	});

	it('a requirement: what it is derived from, and what satisfies and verifies it', () => {
		const endurance = show(host.related(files, idOf("SystemRequirements::'Flight endurance'")));
		expect(endurance).toEqual(
			expect.arrayContaining([
				"out derives StakeholderNeeds::'Parcel delivery'",
				'in satisfies DroneArchitecture::drone'
			])
		);
		expect(endurance.some((r) => r.startsWith('in verifies'))).toBe(true);
	});
});

describe('a general view with elements added', () => {
	it('draws them, joined to what is there', () => {
		const plain = host.diagram('general', files, 'DroneComponents');
		expect(plain.nodes.map((n) => n.id)).not.toContain('drone');
		const graph = host.diagram('general', files, 'DroneComponents', [
			'DroneArchitecture::drone',
			'DroneArchitecture::DeliveryDrone',
			'DroneComponents::Battery',
			'Nowhere::nothing'
		]);
		expect(graph.nodes.length).toBe(plain.nodes.length + 2);
		const drone = graph.nodes.find((n) => n.id === 'drone')!;
		expect(drone.attributes.some(([, text]) => text.startsWith('battery'))).toBe(true);
		expect(graph.edges).toContainEqual(
			expect.objectContaining({ source: 'drone', target: 'DeliveryDrone', kind: 'typing' })
		);
	});
});
