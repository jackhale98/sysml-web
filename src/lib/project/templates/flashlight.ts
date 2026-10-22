/**
 * Small system: a flashlight everyone can picture. Its parts (battery,
 * switch, LED, housing) as a tree, their ports and one kind of interface
 * between them, a mass budget with a limit that is checked, two
 * requirements met and verified, and a state machine (off, on, low battery)
 * that runs in the simulator.
 */
import type { ProjectFile, ProjectInfo } from '../workspace.svelte.ts';
import { docText } from './blank.ts';

export function flashlightProject(
	name: string,
	description: string,
	viewLibraries: ProjectFile[]
): { info: ProjectInfo; files: ProjectFile[] } {
	// Named for the flashlight, not the project: a project called "Flashlight"
	// would otherwise have a package and a part def of the same name.
	const pkg = 'FlashlightDesign';
	const reqs = 'FlashlightRequirements';
	const modes = 'FlashlightBehaviour';
	const tests = 'FlashlightVerification';
	const views = 'FlashlightViews';
	const about = description.trim() || 'A hand-held flashlight, as a small example system.';
	const modelPath = 'model/Flashlight.sysml';

	const model = `package ${pkg} {
    doc /* ${docText(about)} */

    private import ScalarValues::*;
    private import ISQ::*;
    private import SI::*;
    private import ${modes}::FlashlightModes;

    // --- What flows between the parts, and where it connects ------------
    item def ElectricPower {
        doc /* Electrical energy, from the battery to the light. */
    }

    port def PowerPort {
        doc /* A connection point where power goes out. A part that takes power in
             * has ~PowerPort, the mirror image: what goes out of one comes into the other. */
        out item power : ElectricPower;
    }

    interface def Wire {
        doc /* A wire between two parts: power flows from the supply to the load. */
        end supply : PowerPort;
        end load : ~PowerPort;
        flow of ElectricPower from supply.power to load.power;
    }

    // --- The kinds of part, like datasheets ------------------------------
    part def Battery {
        doc /* Two AA cells in a holder. */
        attribute mass :> ISQ::mass = 48 [g];
        port powerOut : PowerPort;
    }

    part def Switch {
        doc /* A push button that turns the light on and off. */
        attribute mass :> ISQ::mass = 4 [g];
        port powerIn : ~PowerPort;
        port powerOut : PowerPort;
    }

    part def Led {
        doc /* The light source and its driver board. */
        attribute mass :> ISQ::mass = 6 [g];
        port powerIn : ~PowerPort;
    }

    part def Housing {
        doc /* The aluminium body, lens and end cap. */
        attribute mass :> ISQ::mass = 72 [g];
    }

    part def Flashlight {
        doc /* A hand-held light. */
        attribute mass :> ISQ::mass;
        attribute runTime :> ISQ::duration {
            doc /* How long it stays lit on new batteries, from the battery's capacity
                 * and the LED's current. */
        }
        exhibit state modes : FlashlightModes;
    }

    // --- The design: this flashlight, made of those parts -----------------
    part flashlight : Flashlight {
        part battery : Battery;
        part switch : Switch;
        part led : Led;
        part housing : Housing;

        interface batteryToSwitch : Wire connect battery.powerOut to switch.powerIn;
        interface switchToLed : Wire connect switch.powerOut to led.powerIn;

        // A mass roll-up: like a spreadsheet formula, kept in the model.
        attribute :>> mass = battery.mass + switch.mass + led.mass + housing.mass;
        attribute :>> runTime = 3 [h];
    }
}
`;

	const requirements = `package ${reqs} {
    doc /* What the flashlight must do. Each requirement's limit is written as a
         * constraint, so the app checks it against the design's values. */

    private import ISQ::*;
    private import SI::*;
    private import ${pkg}::Flashlight;
    private import ${pkg}::flashlight;

    requirement def FlashlightRequirement {
        doc /* A requirement on the flashlight. */
        subject light : Flashlight;
    }

    requirement <'REQ-001'> 'Maximum mass' : FlashlightRequirement {
        doc /* The flashlight, with its batteries, shall weigh no more than 150 g. */
        require constraint { light.mass <= 150 [g] }
    }

    requirement <'REQ-002'> 'Run time' : FlashlightRequirement {
        doc /* On new batteries, the flashlight shall stay lit for at least 2 hours. */
        require constraint { light.runTime >= 2 [h] }
    }

    // --- What meets each requirement --------------------------------------
    satisfy 'Maximum mass' by flashlight;
    satisfy 'Run time' by flashlight;
}
`;

	const machine = `package ${modes} {
    doc /* What the flashlight is doing, as a state machine. It is always in one
         * state; a transition says which state it leaves (first), what makes it
         * move (accept) and where it goes (then). Run it from Simulations. */

    private import ScalarValues::*;

    item def ButtonPress {
        doc /* Someone pressed the button. */
    }

    state def FlashlightModes {
        doc /* Off, on, and on with a low battery. */
        attribute charge : Real = 1.0 {
            doc /* Battery charge left: 0 is empty, 1 is full. */
        }
        attribute lowLevel : Real = 0.15 {
            doc /* Below this charge, the light dims to last longer. */
        }

        entry; then off;

        state off {
            doc /* Dark. */
        }
        state on {
            doc /* Lit at full brightness. Each hour lit uses 30 % of the battery. */
        }
        state lowBattery {
            doc /* Still lit, but dimmed to save the battery. */
        }

        transition switchOn first off accept ButtonPress then on;
        transition switchOff first on accept ButtonPress then off;
        transition drain first on accept after 1 [SI::h] do assign charge := charge - 0.3 then on;
        transition batteryLow first on accept when charge < lowLevel then lowBattery;
        transition switchOffLow first lowBattery accept ButtonPress then off;
    }
}
`;

	const verification = `package ${tests} {
    doc /* How we will show the flashlight meets its requirements. */

    private import VerificationCases::*;
    private import ${reqs}::*;
    private import ${pkg}::flashlight;

    verification <'VC-001'> weighTest {
        doc /* Weigh three flashlights with batteries fitted. Passes at 150 g or less. */
        subject unit :> flashlight;
        objective { verify 'Maximum mass'; }
        @VerificationMethod { kind = VerificationMethodKind::test; }
    }

    verification <'VC-002'> runTimeTest {
        doc /* Switch on with new batteries and time how long it stays lit. Passes at 2 hours or more. */
        subject unit :> flashlight;
        objective { verify 'Run time'; }
        @VerificationMethod { kind = VerificationMethodKind::test; }
    }
}
`;

	const viewsText = `package ${views} {
    doc /* Saved views: diagrams and tables that are part of the model. */

    private import StandardViewDefinitions::*;
    private import Views::asTreeDiagram;
    private import ModelViews::*;

    view partsTree : GeneralView {
        doc /* The flashlight and what it is made of. */
        expose ${pkg}::flashlight::**;
        render asTreeDiagram;
    }

    view connections : InterconnectionView {
        doc /* The parts inside the flashlight, with their ports and wires. */
        expose ${pkg}::flashlight::*;
    }

    view massBudget : MassBudget {
        doc /* The flashlight's mass, added up over its parts, against its limit. */
        expose ${pkg}::flashlight::**;
    }

    view requirements : RequirementsTable {
        doc /* The requirements, what meets them and whether the design passes. */
        expose ${reqs}::*;
    }

    view designChecks : ConstraintChecks {
        doc /* Each limit, checked against the design's values. */
    }

    view modes : StateTransitionView {
        doc /* Off, on and low battery, and what switches between them. */
        expose ${modes}::FlashlightModes;
    }
}
`;

	const tour = `# Start here: ${name}

${about}

A flashlight is small enough to see whole, and it has everything a bigger
system has: parts, connections, numbers to add up, requirements to meet, and
behaviour over time. Change it into your own system, or use it to learn.

## 1. The parts: \`partsTree\`

\`flashlight\` is made of a \`Battery\`, a \`Switch\`, an \`Led\` and a \`Housing\`.
Each of those is a **part def**: a kind of part, like a datasheet. The
\`flashlight\` itself is a **part**: one particular flashlight, built from them.

## 2. The connections: \`connections\`

Power leaves the battery at its \`PowerPort\` and comes into the switch and the
LED at the mirror-image \`~PowerPort\`. \`Wire\` is the kind of connection (an
**interface**) that joins them.

## 3. The numbers: \`massBudget\`

Each part has a mass, and the flashlight's mass adds them up (look for
\`attribute :>> mass\` in \`${modelPath}\`). The budget shows each part's share
and the 150 g limit from \`'Maximum mass'\`. Make the housing heavier and watch
the check turn red.

## 4. The requirements: \`requirements\` and \`designChecks\`

\`'Maximum mass'\` and \`'Run time'\` each have a limit written as a
constraint, a part that meets them (\`satisfy\`) and a test that checks them
(\`weighTest\`, \`runTimeTest\`).

## 5. The behaviour: \`modes\`

\`FlashlightModes\` is a state machine: off, on, and low battery. Run it from
**Simulations** in the explorer: press the button, then set \`charge\` to 0.05
and step to see the light dim.

## Make it yours

Rename the parts, add one with **Add** in a diagram, and use
[New view](#do:new-view) for more tables and diagrams. [Open the help](#do:help)
for each idea in plain words.
`;

	return {
		info: { name, description: about, version: '0.1.0' },
		files: [
			{ path: modelPath, text: model },
			{ path: 'model/Requirements.sysml', text: requirements },
			{ path: 'model/Behaviour.sysml', text: machine },
			{ path: 'model/Verification.sysml', text: verification },
			{ path: 'views/Views.sysml', text: viewsText },
			...viewLibraries,
			{ path: 'TOUR.md', text: tour }
		]
	};
}
