/**
 * Large SysML v2 projects for performance tests and the benchmark
 * (`docs/performance.md`), generated rather than committed.
 *
 * A project is a product made of `subsystems`, each written the way the
 * drone demo is (`src/demo/drone/`), so every feature the app reads is
 * exercised at scale: interface and port definitions with flows; a
 * component catalogue (abstract base, specializations, redefined masses,
 * composite assemblies with bindings and connections); an architecture
 * usage with a deep part tree, interfaces and flows and a mass roll-up;
 * requirements with metadata, constraints and derivations; satisfy and
 * verify links; a state machine and an action flow; views (tables and
 * diagrams). About 1160 lines per subsystem across seven files, plus a
 * product that connects them and the demo's `EngineeringBasics` library.
 *
 * The output is valid: the toolkit finds no problems in it (checked by
 * `tests/unit/large-model.test.ts`). Deterministic for a given size.
 */

export interface GeneratedFile {
	path: string;
	text: string;
}

export interface GenerateOptions {
	/** Number of subsystems (about 1160 lines each). */
	subsystems: number;
	/** Component definitions per subsystem. */
	components?: number;
	/** Requirements per subsystem. */
	requirements?: number;
}

/** Subsystems for a project of about `lines` lines. */
export function subsystemsFor(lines: number): number {
	return Math.max(1, Math.round((lines - 100) / 1160));
}

/** A project of about `lines` lines. */
export function generateLines(lines: number): GeneratedFile[] {
	return generateProject({ subsystems: subsystemsFor(lines) });
}

export function generateProject(options: GenerateOptions): GeneratedFile[] {
	const n = options.subsystems;
	const components = options.components ?? 24;
	const requirements = options.requirements ?? 30;
	const files: GeneratedFile[] = [
		{ path: 'libraries/EngineeringBasics.sysml', text: ENGINEERING_BASICS },
		{ path: 'common/CommonInterfaces.sysml', text: commonInterfaces() }
	];
	for (let i = 0; i < n; i++) {
		const s = new Subsystem(i, components, requirements);
		const dir = `subsystems/s${pad(i, 3)}`;
		files.push(
			{ path: `${dir}/${s.p}Interfaces.sysml`, text: s.interfaces() },
			{ path: `${dir}/${s.p}Components.sysml`, text: s.components() },
			{ path: `${dir}/${s.p}Architecture.sysml`, text: s.architecture() },
			{ path: `${dir}/${s.p}Requirements.sysml`, text: s.requirements() },
			{ path: `${dir}/${s.p}Verification.sysml`, text: s.verification() },
			{ path: `${dir}/${s.p}Behaviour.sysml`, text: s.behaviour() },
			{ path: `${dir}/${s.p}Views.sysml`, text: s.views() }
		);
	}
	files.push({ path: 'system/Product.sysml', text: product(n) });
	return files.sort((a, b) => a.path.localeCompare(b.path));
}

export const lineCount = (files: GeneratedFile[]) =>
	files.reduce((sum, f) => sum + f.text.split('\n').length, 0);

const pad = (i: number, width: number) => String(i).padStart(width, '0');

/** A small deterministic generator, so a size always gives the same project. */
class Random {
	private state: number;
	constructor(seed: number) {
		this.state = (seed * 2654435761 + 1) >>> 0 || 1;
	}
	next(): number {
		// xorshift32
		let x = this.state;
		x ^= x << 13;
		x ^= x >>> 17;
		x ^= x << 5;
		this.state = x >>> 0;
		return this.state / 0x100000000;
	}
	int(min: number, max: number): number {
		return min + Math.floor(this.next() * (max - min + 1));
	}
	pick<T>(list: readonly T[]): T {
		return list[Math.floor(this.next() * list.length)]!;
	}
}

const ROLES = [
	'Controller',
	'Sensor',
	'Actuator',
	'Converter',
	'Filter',
	'Processor',
	'Transceiver',
	'Regulator',
	'Valve',
	'Pump',
	'Heater',
	'Monitor'
] as const;

const KINDS = ['functional', 'performance', 'safety', 'environmental', 'regulatory'] as const;
const PRIORITIES = ['high', 'medium', 'low'] as const;
const STATUSES = ['open', 'tbd', 'tbr', 'tbc', 'done', 'closed'] as const;
const OWNERS = ['J. Hale', 'R. Tanaka', 'L. Moreau', 'K. Novak', 'A. Brandt', 'M. Okafor'] as const;

class Subsystem {
	/** Prefix of every name: `S007`. */
	readonly p: string;
	private readonly random: Random;
	private readonly componentCount: number;
	private readonly requirementCount: number;

	constructor(
		readonly index: number,
		components: number,
		requirements: number
	) {
		this.p = `S${pad(index, 3)}`;
		this.random = new Random(index + 1);
		this.componentCount = components;
		this.requirementCount = requirements;
	}

	/** The leaf component definitions' names. */
	private get units(): string[] {
		return Array.from(
			{ length: this.componentCount },
			(_, j) => `${this.p}${ROLES[j % ROLES.length]}${Math.floor(j / ROLES.length) + 1}`
		);
	}

	/** Composite assemblies, each built from three units. */
	private get assemblies(): { name: string; parts: string[] }[] {
		const units = this.units;
		const count = Math.max(1, Math.floor(units.length / 4));
		return Array.from({ length: count }, (_, k) => ({
			name: `${this.p}Assembly${k + 1}`,
			parts: [0, 1, 2].map((o) => units[(k * 3 + o) % units.length]!)
		}));
	}

	private get requirementNames(): string[] {
		return Array.from(
			{ length: this.requirementCount },
			(_, j) => `'${this.p} requirement ${pad(j + 1, 3)}'`
		);
	}

	interfaces(): string {
		const p = this.p;
		return `package ${p}Interfaces {
    doc
    /*
     * What flows inside subsystem ${p}, and the ports it flows through.
     */

    private import ScalarValues::Real;
    private import ISQ::*;

    item def ${p}Power {
        doc /* Electrical energy delivered inside ${p}. */
        attribute voltage :> ISQ::voltage;
        attribute current :> electricCurrent;
    }

    item def ${p}Command { doc /* A set-point for a ${p} unit. */ }
    item def ${p}StartCommand :> ${p}Command { doc /* Start the unit. */ }
    item def ${p}StopCommand :> ${p}Command { doc /* Stop the unit. */ }
    item def ${p}Measurement {
        doc /* A sampled value with its rate. */
        attribute rate : Real;
        attribute value : Real;
    }
    item def ${p}Fault { doc /* A unit reported a fault. */ }
    item def ${p}Recovered { doc /* The fault has cleared. */ }

    port def ${p}PowerPort {
        doc /* Supplies power. A load uses ~${p}PowerPort. */
        out item power : ${p}Power;
    }

    port def ${p}CommandPort {
        doc /* Commands go out, measurements come back. */
        out item command : ${p}Command;
        in item measurement : ${p}Measurement;
    }

    port def ${p}DataPort { out item data : ${p}Measurement; }

    interface def ${p}PowerLink {
        doc /* A power cable from a supply to a load. */
        end supply : ${p}PowerPort;
        end load : ~${p}PowerPort;
        flow of ${p}Power from supply.power to load.power;
    }

    interface def ${p}CommandLink {
        doc /* Commands one way, measurements the other. */
        end commander : ${p}CommandPort;
        end commanded : ~${p}CommandPort;
        flow of ${p}Command from commander.command to commanded.command;
        flow of ${p}Measurement from commanded.measurement to commander.measurement;
    }
}
`;
	}

	components(): string {
		const p = this.p;
		const r = this.random;
		const out: string[] = [
			`package ${p}Components {
    doc
    /*
     * The component catalogue of subsystem ${p}: each part def is a kind of
     * component with its mass, power draw and ports.
     */

    private import ScalarValues::Real;
    private import ISQ::*;
    private import SI::*;
    private import ${p}Interfaces::*;

    abstract part def ${p}Component {
        doc /* Anything built into ${p}. */
        attribute mass :> ISQ::mass;
        attribute powerDraw :> ISQ::power [0..1] {
            doc /* Electrical power drawn in normal operation. */
        }
    }

    enum def ${p}Mode {
        doc /* How a unit is operated. */
        nominal;
        degraded;
        standby;
    }

    part def ${p}PowerSupply :> ${p}Component {
        doc /* Converts the product's bus power for the subsystem. */
        attribute :>> mass = ${r.int(200, 900)} [g];
        attribute efficiency : Real = 0.9${r.int(0, 9)};
        port powerOut : ${p}PowerPort;
        port commandIn : ~${p}CommandPort;
    }
`
		];
		for (const name of this.units) {
			const mass = r.int(10, 500);
			const power = r.int(1, 60);
			out.push(`
    part def ${name} :> ${p}Component {
        doc /* A ${name.replace(p, '').replace(/\d+$/, '').toLowerCase()} of subsystem ${p}, catalogue item ${r.int(1000, 9999)}. */
        attribute :>> mass = ${mass} [g];
        attribute :>> powerDraw = ${power} [W] { doc /* At nominal load. */ }
        attribute mode : ${p}Mode;
        attribute temperatureLimit :> temperature = ${r.int(320, 380)} [K];
        attribute lifetime :> duration = ${r.int(1000, 50000)} [h];
        port powerIn : ~${p}PowerPort;
        port command : ~${p}CommandPort;
        port dataOut : ${p}DataPort;
    }
`);
		}
		for (const { name, parts } of this.assemblies) {
			const [a, b, c] = parts;
			out.push(`
    part def ${name} :> ${p}Component {
        doc /* Three units replaced as one; its mass and power add up its parts'. */
        attribute :>> mass = partA.mass + partB.mass + partC.mass;
        attribute :>> powerDraw = partA.powerDraw + partB.powerDraw + partC.powerDraw;
        port powerIn : ~${p}PowerPort;
        port command : ~${p}CommandPort;

        part partA : ${a};
        part partB : ${b};
        part partC : ${c};

        bind powerIn = partA.powerIn;
        bind command = partA.command;
        connect partA to partB;
        connect partB to partC;
    }
`);
		}
		out.push('}\n');
		return out.join('');
	}

	architecture(): string {
		const p = this.p;
		const v = p.toLowerCase();
		const assemblies = this.assemblies;
		const units = this.units;
		const loose = units.slice(0, Math.min(units.length, 8));
		const out: string[] = [
			`package ${p}Architecture {
    doc
    /*
     * Subsystem ${p}: what any ${p} offers, and our design of it.
     */

    private import ISQ::*;
    private import SI::*;
    private import CommonInterfaces::*;
    private import ${p}Components::*;
    private import ${p}Interfaces::*;
    private import ${p}Behaviour::*;

    part def ${p}System {
        doc /* Any ${p} that does the job. */
        attribute emptyMass :> mass;
        attribute massLimit :> mass = ${this.random.int(20, 90)} [kg];
        attribute supplyPower :> power;
        port bus : ~BusPort;
        perform action operate : ${p}Operation;
        exhibit state modes : ${p}Modes;
    }

    part ${v} : ${p}System {
        doc /* Our design of ${p}. */

        part supply : ${p}PowerSupply;
`
		];
		assemblies.forEach((a, k) => {
			out.push(`        part assembly${k + 1} : ${a.name};\n`);
		});
		// A deeper tree: bays of racks of slots, each holding units.
		out.push(`        part bay {
            doc /* The equipment bay. */
`);
		for (let rack = 1; rack <= 2; rack++) {
			out.push(`            part rack${rack} {
`);
			for (let slot = 1; slot <= 2; slot++) {
				const unit = loose[(rack * 2 + slot) % loose.length]!;
				out.push(`                part slot${slot} {
                    part unit : ${unit};
                    attribute position : ScalarValues::Integer = ${rack * 10 + slot};
                }
`);
			}
			out.push(`            }
`);
		}
		out.push(`        }
`);
		loose.forEach((u, k) => out.push(`        part unit${k + 1} : ${u};\n`));
		out.push('\n');
		// Power: supply → every assembly and loose unit.
		assemblies.forEach((_, k) => {
			out.push(
				`        interface power${k + 1} : ${p}PowerLink connect supply.powerOut to assembly${k + 1}.powerIn;\n`
			);
		});
		loose.forEach((_, k) => {
			out.push(
				`        interface unitPower${k + 1} : ${p}PowerLink connect supply.powerOut to unit${k + 1}.powerIn;\n`
			);
		});
		out.push('\n');
		// Commands: the first unit commands the others; data flows back to it.
		loose.slice(1).forEach((_, k) => {
			out.push(
				`        flow of ${p}Measurement from unit${k + 2}.dataOut.data to unit1.command.measurement;\n`
			);
		});
		out.push(`        connect bay.rack1.slot1.unit.dataOut to unit1.command;\n`);
		const massTerms = [
			'supply.mass',
			...assemblies.map((_, k) => `assembly${k + 1}.mass`),
			...loose.map((_, k) => `unit${k + 1}.mass`)
		];
		out.push(`
        attribute :>> emptyMass = ${massTerms.slice(0, 6).join(' + ')}
            + ${massTerms.slice(6).join(' + ') || '0 [kg]'};
        attribute :>> supplyPower = ${this.random.int(200, 2000)} [W];
    }
}
`);
		return out.join('');
	}

	requirements(): string {
		const p = this.p;
		const v = p.toLowerCase();
		const r = this.random;
		const out: string[] = [
			`package ${p}Requirements {
    doc
    /*
     * What subsystem ${p} shall do and how well.
     */

    private import SI::*;
    private import EngineeringBasics::*;
    private import ModelingMetadata::*;
    private import RequirementDerivation::*;
    private import ${p}Architecture::${p}System;

    requirement def ${p}Requirement :> EngineeringRequirement {
        doc /* A requirement on ${p}. */
        subject sys : ${p}System;
    }

    requirement <'${p}-000'> '${p} purpose' : EngineeringRequirement {
        doc /* The product needs ${p} to do its part of the mission. */
        :>> kind = RequirementKind::functional;
        :>> priority = Priority::high;
        @StatusInfo { status = StatusKind::closed; owner = "M. Okafor"; originator = "Operations"; }
    }
`
		];
		const names = this.requirementNames;
		names.forEach((name, j) => {
			const id = `${p}-${pad(j + 1, 3)}`;
			const kind = KINDS[j % KINDS.length]!;
			const constraint =
				j % 3 === 0
					? `        require constraint { sys.emptyMass <= ${r.int(20, 120)} [kg] }\n`
					: j % 3 === 1
						? `        require constraint { sys.supplyPower >= ${r.int(50, 150)} [W] }\n`
						: '';
			out.push(`
    requirement <'${id}'> ${name} : ${p}Requirement {
        doc /* ${p} shall meet condition ${j + 1}: a ${kind} need, stated in plain words
             * so that a reviewer can check it against the design and the tests. */
        :>> kind = RequirementKind::${kind};
        :>> priority = Priority::${r.pick(PRIORITIES)};
        :>> verificationMethod = VerificationMethod::test;
        @StatusInfo { status = StatusKind::${r.pick(STATUSES)}; owner = "${r.pick(OWNERS)}"; }
${j % 4 === 0 ? `        @Rationale { text = "Derived from the product budget for ${v}."; }\n` : ''}${constraint}    }
`);
		});
		out.push(`
    #derivation connection {
        end #original ::> '${p} purpose';
${names
	.slice(0, 5)
	.map((n) => `        end #derive ::> ${n};\n`)
	.join('')}    }
`);
		out.push(`
    package ${p}Satisfaction {
        private import ${p}Architecture::${v};

${names
	.map((n, j) => {
		const by = j % 3 === 0 ? v : j % 3 === 1 ? `${v}.supply` : `${v}.unit${(j % 8) + 1}`;
		return `        satisfy ${n} by ${by};\n`;
	})
	.join('')}    }
}
`);
		return out.join('');
	}

	verification(): string {
		const p = this.p;
		const v = p.toLowerCase();
		const names = this.requirementNames;
		const out: string[] = [
			`package ${p}Verification {
    doc /* How we prove that ${p} meets its requirements. */

    private import ISQ::*;
    private import SI::*;
    private import VerificationCases::*;
    private import ${p}Requirements::*;
    private import ${p}Architecture::${v};
`
		];
		for (let k = 0; k * 3 < names.length; k++) {
			const verified = names.slice(k * 3, k * 3 + 2);
			out.push(`
    verification <'${p}-VC-${pad(k + 1, 2)}'> ${v}Test${k + 1} {
        doc /* Test campaign ${k + 1} of ${p}. */
        subject testSystem :> ${v};
        objective {
${verified.map((n) => `            verify ${n};\n`).join('')}        }
        @VerificationMethod { kind = VerificationMethodKind::test; }
    }
`);
		}
		out.push('}\n');
		return out.join('');
	}

	behaviour(): string {
		const p = this.p;
		return `package ${p}Behaviour {
    doc /* How subsystem ${p} is operated: its modes and its operating sequence. */

    private import ScalarValues::*;
    private import ${p}Interfaces::*;

    state def ${p}Modes {
        doc /* The modes of ${p}. */
        in attribute ready : Boolean;
        in attribute load : Real;
        attribute overloadLimit : Real = 0.9;

        entry; then off;

        state off { doc /* Unpowered. */ }
        state standby { doc /* Powered, waiting for a command. */ }
        state running {
            doc /* Doing its job. */
            do action regulate;
        }
        state degraded { doc /* Running with a fault. */ }
        state safe {
            doc /* Stopped after a fault. */
            entry action report;
        }

        transition powerUp first off accept ${p}StartCommand if ready then standby;
        transition start first standby accept ${p}StartCommand then running;
        transition stop first running accept ${p}StopCommand then standby;
        transition overload first running accept when load > overloadLimit then degraded;
        transition fault first running accept ${p}Fault then safe;
        transition recover first degraded accept ${p}Recovered then running;
        transition giveUp first degraded accept ${p}Fault then safe;
        transition reset first safe accept ${p}StopCommand then off;
    }

    action def ${p}Operation {
        doc /* One operating cycle of ${p}. */
        in item command : ${p}Command;

        first start;
        then action prepare { doc /* Check the inputs. */ }
        then fork;
            then measure;
            then actuate;

        action measure {
            doc /* Sample the sensors. */
            out attribute ok : Boolean;
        }
        then synced;

        action actuate { doc /* Drive the actuators. */ }
        then synced;

        join synced;
        then decide;
            if measure.ok then commit;
            else retry;

        action commit { doc /* Accept the cycle. */ }
        then finished;

        action retry { doc /* Discard the cycle. */ }
        then finished;

        merge finished;
        then action report { doc /* Send the cycle's results. */ }
        then done;
    }
}
`;
	}

	views(): string {
		const p = this.p;
		const v = p.toLowerCase();
		return `package ${p}Views {
    doc /* The saved diagrams and tables of ${p}. */

    private import StandardViewDefinitions::*;
    private import ModelViews::*;

    view ${v}Requirements : RequirementsTable {
        doc /* The requirements of ${p}. */
        expose ${p}Requirements::*;
    }

    view ${v}BillOfMaterials : BillOfMaterials {
        doc /* What ${p} is made of. */
        expose ${p}Architecture::${v}::**;
    }

    view ${v}Catalogue : GeneralView {
        doc /* The component definitions of ${p}. */
        expose ${p}Components::*;
        filter @SysML::PartDefinition;
    }

    view ${v}Interconnection : InterconnectionView {
        doc /* The parts of ${p} and how they connect. */
        expose ${p}Architecture::${v}::*;
    }

    view ${v}Modes : StateTransitionView {
        doc /* The modes of ${p}. */
        expose ${p}Behaviour::${p}Modes;
    }
}
`;
	}
}

function commonInterfaces(): string {
	return `package CommonInterfaces {
    doc /* What the subsystems exchange over the product's data bus. */

    private import ScalarValues::*;

    item def BusMessage {
        doc /* One message on the bus. */
        attribute sender : String;
        attribute payload : String;
    }

    port def BusPort {
        doc /* The bus side of a connection; a subsystem uses ~BusPort. */
        out item msg : BusMessage;
    }

    interface def BusLink {
        doc /* A bus drop to one subsystem. */
        end hub : BusPort;
        end node : ~BusPort;
        flow of BusMessage from hub.msg to node.msg;
    }
}
`;
}

function product(n: number): string {
	const subs = Array.from({ length: n }, (_, i) => `S${pad(i, 3)}`);
	return `package Product {
    doc
    /*
     * The product: every subsystem, connected to the data bus.
     */

    private import ISQ::*;
    private import CommonInterfaces::*;
    private import StandardViewDefinitions::*;
    private import ModelViews::*;
${subs.map((s) => `    private import ${s}Architecture::*;\n`).join('')}
    part def DataBus {
        doc /* The product's data bus. */
        port drops : BusPort[${n}];
    }

    part product {
        doc /* The whole product. */
        part bus : DataBus;
${subs.map((s) => `        part ${s.toLowerCase()}Use :> ${s.toLowerCase()};\n`).join('')}
${subs.map((s) => `        interface ${s.toLowerCase()}Drop : BusLink connect bus.drops to ${s.toLowerCase()}Use.bus;\n`).join('')}    }

    view allRequirements : RequirementsTable {
        doc /* Every requirement of the product. */
    }

    view productBillOfMaterials : BillOfMaterials {
        doc /* What the product is made of. */
        expose Product::product::**;
    }

    view productInterconnection : InterconnectionView {
        doc /* The subsystems on the data bus. */
        expose Product::product::*;
    }
}
`;
}

/** The demo's `libraries/EngineeringBasics.sysml`. */
const ENGINEERING_BASICS = `library package EngineeringBasics {
    doc /* General-purpose vocabulary for engineering requirements: kind, priority and verification method. */

    enum def RequirementKind {
        doc /* The nature of a requirement. */
        enum functional;
        enum performance;
        enum 'interface';
        enum safety;
        enum regulatory;
        enum environmental;
    }

    enum def Priority {
        doc /* How important a requirement is to the success of the product. */
        enum high;
        enum medium;
        enum low;
    }

    enum def VerificationMethod {
        doc /* The way a requirement is shown to be met. */
        enum test;
        enum 'analysis';
        enum inspection;
        enum demonstration;
    }

    requirement def EngineeringRequirement {
        doc /* A requirement classified by kind, priority and planned verification method. */
        attribute kind : RequirementKind[0..1];
        attribute priority : Priority[0..1];
        attribute verificationMethod : VerificationMethod[0..*];
    }
}
`;
