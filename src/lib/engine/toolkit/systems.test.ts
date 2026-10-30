/**
 * Parts whose machines run together (`systems.ts`), read from the toolkit's
 * model: which contexts qualify, their parts' machines and ports (their
 * own and their definitions'), and the connections and bindings between
 * ports, as paths from the context.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ToolkitHost } from './host';
import { demoFiles, loadHost } from './testing';

let host: ToolkitHost;
beforeAll(async () => {
	host = await loadHost();
}, 60_000);

const MODEL = `package Sys {
    item def Ping;
    port def P;
    state def Blink { entry; then on; state on; state off;
        transition first on accept Ping then off; }
    part def Lamp { port q : ~P; exhibit state blink : Blink; }
    part def SmartLamp :> Lamp;
    part def Switch { port p : P; exhibit state m { entry; then up; state up; } }
    part def Plain { port q : ~P; }
    part house {
        part sw : Switch;
        part room {
            port feed : ~P;
            part lamp : SmartLamp;
            bind feed = lamp.q;
        }
        part spare : Plain;
        connect sw.p to room.feed;
    }
    part single { part sw : Switch; part spare : Plain; }
}`;

describe('parts whose machines run together', () => {
	it('finds a context with two machines, at any depth, through definitions and their supertypes', () => {
		const systems = host.machineSystems([{ path: 'm.sysml', text: MODEL }]);
		// `single` has one machine only: the emulator runs it alone.
		expect(systems.map((s) => s.qualifiedName)).toEqual(['Sys::house']);
		const [house] = systems;
		expect(house!.parts.map((p) => [p.path, p.machine.name, p.ports])).toEqual([
			['sw', 'm', ['p']],
			// The machine of its definition's supertype, `Blink`, and the port it inherits.
			['room.lamp', 'Blink', ['q']]
		]);
		expect(house!.allParts).toEqual(['sw', 'room', 'room.lamp', 'spare']);
		// The context's connections, then those of the parts inside it.
		expect(house!.links).toEqual([
			{ kind: 'connection', ends: ['sw.p', 'room.feed'] },
			{ kind: 'binding', ends: ['room.feed', 'room.lamp.q'] }
		]);
	});

	it('in the demo: the ground station console and the flight controller of `GroundLink::linkTest`', () => {
		const systems = host.machineSystems(demoFiles());
		const link = systems.find((s) => s.qualifiedName === 'GroundLink::linkTest');
		expect(link?.parts.map((p) => p.path)).toEqual(['station', 'controller']);
		expect(link?.links).toEqual([
			{ kind: 'connection', ends: ['station.commandLink', 'controller.commandLink'], name: 'link' }
		]);
	});
});
