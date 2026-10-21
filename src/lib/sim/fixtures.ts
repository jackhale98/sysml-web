/** Machines as the engine returns them, for tests. */
import type { StateMachine } from '#lib/engine/types.ts';

export const flightModes: StateMachine = {
	name: 'FlightModes',
	qualifiedName: 'FlightControl::FlightModes',
	file: 'behaviour/FlightControl.sysml',
	line: 19,
	doc: 'Flight modes of the delivery drone.',
	states: [
		{
			name: 'entry',
			label: 'entry',
			kind: 'initial',
			line: 19
		},
		{
			name: 'idle',
			label: 'idle',
			kind: 'state',
			doc: 'On the ground with the motors off. Safe to handle.',
			line: 27
		},
		{
			name: 'armed',
			label: 'armed',
			kind: 'state',
			doc: 'On the ground with the motors idling, ready to take off.',
			line: 28
		},
		{
			name: 'flying',
			label: 'flying',
			kind: 'state',
			do: 'followFlightPlan',
			doc: 'Flying the mission under automatic control.',
			line: 29
		},
		{
			name: 'returningHome',
			label: 'returningHome',
			kind: 'state',
			doc: 'Flying back to the depot on its own.',
			line: 33
		},
		{
			name: 'landing',
			label: 'landing',
			kind: 'state',
			doc: 'Descending onto the landing pad.',
			line: 34
		},
		{
			name: 'failsafe',
			label: 'failsafe',
			kind: 'state',
			entry: 'alertOperator',
			doc: 'Something is wrong: land at once, where the drone is.',
			line: 35
		}
	],
	transitions: [
		{
			from: 'entry',
			to: 'idle',
			line: 19
		},
		{
			name: 'arm',
			from: 'idle',
			to: 'armed',
			trigger: 'ArmCommand',
			guard: 'preflightChecksPassed',
			line: 40
		},
		{
			name: 'disarm',
			from: 'armed',
			to: 'idle',
			trigger: 'DisarmCommand',
			line: 41
		},
		{
			name: 'takeOff',
			from: 'armed',
			to: 'flying',
			trigger: 'TakeOffCommand',
			line: 42
		},
		{
			name: 'commandedReturn',
			from: 'flying',
			to: 'returningHome',
			trigger: 'ReturnHomeCommand',
			line: 44
		},
		{
			name: 'linkLost',
			from: 'flying',
			to: 'returningHome',
			trigger: 'LinkLost',
			line: 45
		},
		{
			name: 'lowBattery',
			from: 'flying',
			to: 'returningHome',
			trigger: 'when stateOfCharge < returnThreshold',
			line: 46
		},
		{
			name: 'overDepot',
			from: 'returningHome',
			to: 'landing',
			trigger: 'ArrivedHome',
			line: 47
		},
		{
			name: 'landed',
			from: 'landing',
			to: 'idle',
			trigger: 'TouchDown',
			line: 48
		},
		{
			name: 'faultInFlight',
			from: 'flying',
			to: 'failsafe',
			trigger: 'FaultDetected',
			line: 50
		},
		{
			name: 'faultOnReturn',
			from: 'returningHome',
			to: 'failsafe',
			trigger: 'FaultDetected',
			line: 51
		},
		{
			name: 'emergencyLanded',
			from: 'failsafe',
			to: 'idle',
			trigger: 'TouchDown',
			line: 52
		}
	],
	variables: [
		{
			name: 'preflightChecksPassed',
			type: 'Boolean',
			direction: 'in'
		},
		{
			name: 'stateOfCharge',
			type: 'Real',
			direction: 'in',
			doc: 'Battery charge left: 0 is empty, 1 is full.'
		},
		{
			name: 'returnThreshold',
			type: 'Real',
			value: '0.3',
			doc: 'Charge needed to fly home plus a 20 % reserve.'
		}
	]
};

/** Nested states, a parallel state with two regions, entry/exit actions and an effect. */
export const nestedMachine: StateMachine = {
	name: 'Machine',
	qualifiedName: 'P::Machine',
	file: 'p.sysml',
	line: 4,
	states: [
		{
			name: 'entry',
			label: 'entry',
			kind: 'initial',
			line: 4
		},
		{
			name: 'off',
			label: 'off',
			kind: 'state',
			line: 8
		},
		{
			name: 'on',
			label: 'on',
			kind: 'state',
			entry: 'beep',
			exit: 'boop',
			line: 9
		},
		{
			name: 'on.entry',
			label: 'entry',
			kind: 'initial',
			parent: 'on',
			line: 9
		},
		{
			name: 'on.low',
			label: 'low',
			kind: 'state',
			parent: 'on',
			line: 13
		},
		{
			name: 'on.high',
			label: 'high',
			kind: 'state',
			parent: 'on',
			line: 14
		},
		{
			name: 'par',
			label: 'par',
			kind: 'state',
			parallel: true,
			line: 18
		},
		{
			name: 'par.motors',
			label: 'motors',
			kind: 'state',
			parent: 'par',
			line: 19
		},
		{
			name: 'par.motors.entry',
			label: 'entry',
			kind: 'initial',
			parent: 'par.motors',
			line: 19
		},
		{
			name: 'par.motors.idle',
			label: 'idle',
			kind: 'state',
			parent: 'par.motors',
			line: 21
		},
		{
			name: 'par.motors.spinning',
			label: 'spinning',
			kind: 'state',
			parent: 'par.motors',
			line: 21
		},
		{
			name: 'par.lights',
			label: 'lights',
			kind: 'state',
			parent: 'par',
			line: 24
		},
		{
			name: 'par.lights.entry',
			label: 'entry',
			kind: 'initial',
			parent: 'par.lights',
			line: 24
		},
		{
			name: 'par.lights.dark',
			label: 'dark',
			kind: 'state',
			parent: 'par.lights',
			line: 26
		},
		{
			name: 'par.lights.lit',
			label: 'lit',
			kind: 'state',
			parent: 'par.lights',
			line: 26
		},
		{
			name: 'done',
			label: 'done',
			kind: 'state',
			line: 30
		},
		{
			name: 'fin',
			label: 'fin',
			kind: 'state',
			line: 0
		}
	],
	transitions: [
		{
			from: 'entry',
			to: 'off',
			line: 4
		},
		{
			from: 'on.entry',
			to: 'on.low',
			line: 9
		},
		{
			name: 'up',
			from: 'on.low',
			to: 'on.high',
			trigger: 'Go',
			guard: 'count > 2',
			effect: 'inc',
			line: 15
		},
		{
			name: 'down',
			from: 'on.high',
			to: 'on.low',
			trigger: 'Stop',
			line: 16
		},
		{
			from: 'par.motors.entry',
			to: 'par.motors.idle',
			line: 19
		},
		{
			from: 'par.motors.idle',
			to: 'par.motors.spinning',
			trigger: 'Spin',
			line: 22
		},
		{
			from: 'par.lights.entry',
			to: 'par.lights.dark',
			line: 24
		},
		{
			from: 'par.lights.dark',
			to: 'par.lights.lit',
			trigger: 'Light',
			line: 27
		},
		{
			from: 'off',
			to: 'on',
			trigger: 'Power',
			line: 31
		},
		{
			from: 'on',
			to: 'par',
			trigger: 'Par',
			line: 32
		},
		{
			from: 'par',
			to: 'done',
			trigger: 'Finish',
			line: 33
		},
		{
			from: 'on',
			to: 'off',
			trigger: 'Off',
			line: 34
		},
		{
			from: 'done',
			to: 'fin',
			line: 35
		}
	],
	variables: [
		{
			name: 'count',
			type: 'Integer',
			value: '0'
		},
		{
			name: 'mode',
			type: 'String',
			value: '"a"'
		}
	],
	warnings: ['transition: unknown state `fin`']
};
