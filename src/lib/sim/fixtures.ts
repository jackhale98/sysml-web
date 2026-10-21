/** Machines as the engine extracts them, and SysML sources of machines, for tests. */
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
			line: 25
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
			line: 25
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

// ---------------------------------------------------------------- SysML sources

/** Change triggers, assignments in entry actions, a final state. */
export const LAMP = `package Home {
    item def Toggle;
    state def Lamp {
        attribute brightness : Real = 0.5;
        attribute switches : Integer = 0;
        entry; then off;
        state off;
        state on { entry assign switches := switches + 1; }
        transition turnOn first off accept Toggle if brightness > 0 then on;
        transition turnOff first on accept Toggle then off;
        transition burnOut first on accept when switches > 1 then done;
    }
}`;

/** Completion transitions and guards that read assigned values. */
export const COUNTER = `state def Counter {
    attribute count : Integer = 0;
    attribute limit : Integer = 2;
    entry; then idle;
    state idle { entry assign count := count + 1; }
    state busy;
    transition start first idle accept Go if count < limit then busy;
    transition finish first busy then idle;
    transition overflow first idle accept when count >= limit then done;
}`;

/** A parallel state whose regions take the same event. */
export const DRONE = `state def Drone {
    attribute log : Integer = 0;
    entry; then off;
    state off;
    state on parallel {
        exit action { assign log := log + 100; }
        state motors {
            entry; then idle;
            state idle;
            state spinning { entry assign log := log + 1; }
            transition first idle accept Spin then spinning;
            transition first spinning accept Halt then idle;
        }
        state camera {
            entry; then standby;
            state standby;
            state recording;
            transition first standby accept Spin then recording;
            transition first recording accept Snap then standby;
        }
    }
    transition first off accept Start then on;
    transition first on accept Stop then off;
}`;

/** The emulator fixture `nestedMachine` as SysML. */
export const NESTED = `package P {
    state def Machine {
        attribute count : Integer = 0;
        attribute mode : String = "a";
        entry; then off;

        state off;
        state on {
            entry; then low;
            entry action beep;
            exit action boop;
            state low;
            state high;
            transition up first low accept Go if count > 2 do action inc then high;
            transition down first high accept Stop then low;
        }
        state par parallel {
            state motors {
                entry; then idle;
                state idle; state spinning;
                transition first idle accept Spin then spinning;
            }
            state lights {
                entry; then dark;
                state dark; state lit;
                transition first dark accept Light then lit;
            }
        }
        state done;
        transition first off accept Power then on;
        transition first on accept Par then par;
        transition first par accept Finish then done;
        transition first on accept Off then off;
        transition first done then fin;
    }
}`;

/** Composite states that finish (final states in regions) and effects that assign. */
export const MISSION = `package M {
    item def Go; item def Abort;
    state def Mission {
        attribute fuel : Real = 10;
        attribute legs : Integer = 0;
        attribute ok : Boolean = true;
        entry; then ground;
        state ground;
        state travel {
            entry; then outbound;
            exit action { assign legs := legs + 10; }
            state outbound { do action { assign fuel := fuel - 2.5; } }
            state inbound;
            state holding;
            transition first outbound accept Go do assign legs := legs + 1 then inbound;
            transition first inbound if fuel > 4 then holding;
            transition first inbound accept when fuel <= 4 then holding;
            transition first holding accept Home then done;
        }
        transition launch first ground accept Go if ok and fuel >= 5 then travel;
        transition landed first travel then ground;
        transition abort first travel accept Abort do assign ok := false then ground;
        transition retire first ground accept when not ok then done;
    }
}`;
