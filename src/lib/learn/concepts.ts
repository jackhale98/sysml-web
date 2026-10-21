/**
 * In-app teaching content: every SysML v2 concept the engine reports, explained for engineers who
 * know their domain but are new to MBSE. Terminology follows the SysML v2 / KerML 1.0
 * specifications ("part definition", "part usage", …).
 *
 * The one idea that runs through all of it: a *definition* is a reusable type or specification
 * (what every such thing is like); a *usage* is that type used in one particular context (this one,
 * here, in this role), and is "defined by" (typed by) a definition.
 */

/** A SysML concept explained for people new to MBSE. */
export interface Concept {
	/** Engine kind key (see below). */
	key: string;
	/** Display name, e.g. 'Part definition'. */
	title: string;
	/** The textual keyword(s), e.g. 'part def'. */
	keyword: string;
	/** One plain-language sentence (≤ 22 words), no jargon. */
	summary: string;
	/** 2–4 sentences: what it is for, when to use it, how it relates to its definition/usage pair. */
	explanation: string;
	/** Optional bridge from everyday engineering practice, e.g. 'Like a part number in a catalog…'. */
	analogy?: string;
	/** A minimal, valid SysML v2 snippet (2–8 lines) showing typical use. */
	example: string;
	/** Keys of related concepts. */
	related: string[];
}

const LIST: Concept[] = [
	// ── Organizing the model ────────────────────────────────────────────────────────────────────
	{
		key: 'package',
		title: 'Package',
		keyword: 'package',
		summary:
			'A package is a named folder that groups related model elements and keeps their names apart.',
		explanation:
			'A package is a namespace: it owns elements, gives each one a qualified name (Structure::Drone) and controls what is visible outside it (public or private). Packages say nothing about the system itself; they only organize the model. Nest them to mirror your breakdown, and use imports to reach elements in other packages.',
		analogy:
			'Like a folder in a PDM vault: it organizes the drawings, it is not part of the product.',
		example: `package DroneModel {
    package Structure {
        part def Drone;
    }
    package Requirements;
}`,
		related: ['import', 'alias', 'doc']
	},
	{
		key: 'import',
		title: 'Import',
		keyword: 'import',
		summary:
			'An import lets you use elements from another package by their short names, without copying them.',
		explanation:
			"'import Pkg::Element;' brings in one element, 'import Pkg::*;' all of a package's members, and 'import Pkg::**;' everything nested inside it as well. Imported elements stay where they are; only their names become visible. Imports are private unless declared public, so they do not leak into packages that import yours.",
		analogy:
			"Like an 'include' or 'using' line in code: it shortens names, it does not copy files.",
		example: `package DroneModel {
    private import ISQ::*;
    private import Structure::Drone;
    part def Battery {
        attribute mass :> ISQ::mass;
    }
}`,
		related: ['package', 'alias']
	},
	{
		key: 'alias',
		title: 'Alias',
		keyword: 'alias … for',
		summary:
			'An alias gives an existing element a second name somewhere else, without creating a new element.',
		explanation:
			"An alias is a membership that makes an element known under another name in another namespace. Everything you say through the alias applies to the original element. Use it to offer a team's own vocabulary ('UAV' for 'Drone') or a short name for something deeply nested.",
		analogy: 'Like a shortcut or symbolic link: two names, one file.',
		example: `package Structure {
    part def Drone;
}
package Customer {
    alias UAV for Structure::Drone;
    part fleet : UAV[12];
}`,
		related: ['import', 'package']
	},
	{
		key: 'doc',
		title: 'Documentation',
		keyword: 'doc',
		summary:
			'A doc comment is the plain-language description of an element, written inside the element it describes.',
		explanation:
			"'doc /* … */' creates a documentation comment owned by the element it sits in; tools show it as that element's description. A general 'comment … about X /* … */' can annotate other elements, while '//' notes are for readers of the text only and are not part of the model. Write the 'shall' text of a requirement as its doc.",
		example: `part def Battery {
    doc /* Rechargeable 6S LiPo pack, 22.2 V nominal. */
}
comment about Battery /* Supplier still to be selected. */`,
		related: ['metadata', 'requirement def']
	},

	// ── Structure ─────────────────────────────────────────────────────────────────────────────
	{
		key: 'part def',
		title: 'Part definition',
		keyword: 'part def',
		summary:
			'A part definition describes a kind of component once, with its properties, ports and inner parts, so it can be reused.',
		explanation:
			'A part definition is a reusable specification of a system or a part of a system: hardware, software, people or facilities. It declares the features every such part has, such as attributes, ports, sub-parts and the actions it performs. It does not place anything in your design by itself; part usages defined by it do that. Formally, a part definition is a special kind of item definition.',
		analogy:
			"Like a part number in a catalog: it says what every 'Battery 6S-5000' is like, not which one sits in which drone.",
		example: `part def Battery {
    attribute mass :> ISQ::mass;
    port powerOut : PowerPort;
}`,
		related: ['part', 'item def', 'port def', 'attribute']
	},
	{
		key: 'part',
		title: 'Part usage',
		keyword: 'part',
		summary:
			'A part usage is a component in a specific place and role, such as the battery inside this drone.',
		explanation:
			"A part usage is a usage of a part definition in a context: a feature of its owner (the drone 'has a' battery), defined by a part definition that supplies its features. Part usages are composite, so they belong to their owner and do not outlive it. A usage can add a multiplicity ([4]), set values for this context and redefine inherited features.",
		analogy:
			"Like a line in a bill of materials or a reference designator on a drawing ('B1: battery').",
		example: `part def Drone {
    part battery : Battery;
    part rotors : Rotor[4];
}
part prototype : Drone;`,
		related: ['part def', 'individual', 'connection', 'port']
	},
	{
		key: 'item def',
		title: 'Item definition',
		keyword: 'item def',
		summary:
			'An item definition describes a kind of thing that can exist, be stored or flow, like fuel, a parcel or a message.',
		explanation:
			'An item definition is an occurrence definition for objects that exist in space and time but are not necessarily parts of the system: payloads, fluids, energy, signals. Part definitions are themselves a special kind of item definition. Item usages defined by it appear as flow payloads, port contents or things a part carries.',
		analogy:
			'Like the material or medium on a process diagram: what moves, rather than the machine that moves it.',
		example: `item def Parcel {
    attribute weight :> ISQ::mass;
}
item def Fuel;`,
		related: ['item', 'part def', 'flow', 'occurrence def']
	},
	{
		key: 'item',
		title: 'Item usage',
		keyword: 'item',
		summary:
			'An item is a thing in a specific context, such as the parcel a drone carries or the fuel in a tank.',
		explanation:
			"An item usage is a usage of an item definition: a feature of its owner, defined by an item definition. Items often come and go during operation, so they are frequently declared with 'ref' (referenced, not owned). They also appear as directed features of ports and as what flows carry.",
		example: `part def Drone {
    ref item cargo : Parcel[0..1];
}
port def FuelPort {
    out item fuel : Fuel;
}`,
		related: ['item def', 'flow', 'port def']
	},
	{
		key: 'attribute def',
		title: 'Attribute definition',
		keyword: 'attribute def',
		summary:
			'An attribute definition describes a kind of value, like a mass, voltage or GPS position, that has no identity of its own.',
		explanation:
			'An attribute definition is a data type: its values are pure information, so two equal values are the same value (5 kg is 5 kg). For physical quantities, use or specialize the library types (ISQ, SI) instead of plain numbers; define your own for compound values. Attribute usages defined by it are the properties of parts, items, ports and actions.',
		analogy: 'Like a column type in a spreadsheet: it says what kind of value goes in the cell.',
		example: `attribute def GeoPosition {
    attribute latitude : ScalarValues::Real;
    attribute longitude : ScalarValues::Real;
    attribute altitude :> ISQ::length;
}`,
		related: ['attribute', 'enum def']
	},
	{
		key: 'attribute',
		title: 'Attribute usage',
		keyword: 'attribute',
		summary:
			'An attribute is a property of something, like the mass of a battery or the voltage at a port.',
		explanation:
			"An attribute usage is a usage of an attribute definition: a value-carrying feature of its owner. Type it with ':' (attribute capacity : Real) or, for physical quantities, subset a library quantity with ':>' (attribute mass :> ISQ::mass) to get the right quantity kind and units. A value given with '=' fixes it; 'default' gives a starting value that can be overridden.",
		example: `part def Battery {
    attribute mass :> ISQ::mass = 1.6 [SI::kg];
    attribute cells : ScalarValues::Integer default 6;
}`,
		related: ['attribute def', 'enum', 'part def']
	},
	{
		key: 'enum def',
		title: 'Enumeration definition',
		keyword: 'enum def',
		summary:
			'An enumeration definition is a fixed list of allowed values, like low, medium and high.',
		explanation:
			'An enumeration definition is an attribute definition whose values are exactly the listed enumerated values and nothing else. Usages typed by it must take one of those values. Use it for status, levels, modes and any other closed set of choices.',
		analogy:
			'Like a drop-down list in a form: you pick one of the options, you cannot type your own.',
		example: `enum def RiskLevel {
    enum low;
    enum medium;
    enum high;
}
attribute risk : RiskLevel = RiskLevel::medium;`,
		related: ['enum', 'attribute def', 'variation']
	},
	{
		key: 'enum',
		title: 'Enumeration usage',
		keyword: 'enum',
		summary:
			'An enum is one value in an enumeration list, or a property whose value must come from that list.',
		explanation:
			"Inside an enumeration definition, each 'enum' member declares one allowed value (the keyword may be left out). Elsewhere, an enumeration usage is an attribute usage defined by an enumeration definition, so its value must be one of the listed values.",
		example: `enum def LightColor {
    enum red;
    enum green;
}
part def StatusLed {
    enum color : LightColor;
}`,
		related: ['enum def', 'attribute']
	},
	{
		key: 'port def',
		title: 'Port definition',
		keyword: 'port def',
		summary:
			'A port definition describes a kind of connection point and what can pass through it, like a connector standard.',
		explanation:
			"A port definition lists the features that can be exchanged at any port of that kind, each with a direction (in, out, inout). Port usages on parts are defined by it. Every port definition has a conjugate, written '~PowerPort', that flips all directions, so the mating side of a connection uses the conjugated type.",
		analogy:
			'Like a connector specification (USB-C, M12): the pinout is defined once and reused on many devices.',
		example: `port def PowerPort {
    out item power : ElectricalPower;
    attribute voltage :> ISQ::voltage;
}`,
		related: ['port', 'interface def', 'item def']
	},
	{
		key: 'port',
		title: 'Port usage',
		keyword: 'port',
		summary:
			'A port is a connection point on a part, where things like power, data or fluid go in or out.',
		explanation:
			"A port usage is a feature of a part (or of another port), defined by a port definition. Connections and interfaces attach to ports, so a part's insides stay hidden behind well-defined boundaries. Type the receiving side with the conjugated definition ('~PowerPort') so outputs meet inputs.",
		analogy: 'Like a physical connector or pin on a board: the place where you plug something in.',
		example: `part def Battery {
    port powerOut : PowerPort;
}
part def Motor {
    port powerIn : ~PowerPort;
}`,
		related: ['port def', 'interface', 'connection', 'flow']
	},
	{
		key: 'connection def',
		title: 'Connection definition',
		keyword: 'connection def',
		summary:
			'A connection definition describes a kind of link between things, such as a cable, a pipe or a weld.',
		explanation:
			'A connection definition declares its ends (what kinds of things it links) and may have its own features, such as length or resistance. Connection usages defined by it link specific parts. Formally it is a part definition that is also an association, so a connection can be a real object with properties of its own.',
		analogy:
			'Like a harness or cable assembly drawing: it says what it plugs into and what it is made of.',
		example: `connection def PowerCable {
    end part source : Battery;
    end part target : Motor;
    attribute length :> ISQ::length;
}`,
		related: ['connection', 'interface def', 'allocation def']
	},
	{
		key: 'connection',
		title: 'Connection usage',
		keyword: 'connection … connect … to',
		summary:
			'A connection is a specific link between two parts in context, like the cable from this battery to this motor.',
		explanation:
			"A connection usage links features in its context, written 'connect a to b'. It may be defined by a connection definition, or left untyped when a plain link is enough. Connect ports with an interface when the exchange matters; use a connection for general structural links.",
		example: `part def Drone {
    part battery : Battery;
    part motor : Motor;
    connection cable : PowerCable connect battery to motor;
}`,
		related: ['connection def', 'interface', 'part', 'flow']
	},
	{
		key: 'interface def',
		title: 'Interface definition',
		keyword: 'interface def',
		summary:
			'An interface definition describes an agreed port-to-port link and what crosses it, like an interface control document.',
		explanation:
			'An interface definition is a connection definition whose ends are ports. It captures the agreement between two sides once: the port types on each end and, optionally, the flows that cross. Interface usages defined by it then connect specific ports wherever the two sides meet.',
		analogy: 'Like an ICD: both teams design to it, and it is reviewed and changed as one thing.',
		example: `interface def PowerInterface {
    end supply : PowerPort;
    end load : ~PowerPort;
}`,
		related: ['interface', 'port def', 'connection def', 'flow']
	},
	{
		key: 'interface',
		title: 'Interface usage',
		keyword: 'interface … connect … to',
		summary:
			'An interface is a specific port-to-port link between two parts, following an agreed interface definition.',
		explanation:
			"An interface usage connects two ports in its context, written 'connect a.port to b.port'. It is defined by an interface definition, whose end types the connected ports must match. Flows inside it show what actually crosses the interface.",
		example: `part def Drone {
    part battery : Battery;
    part motor : Motor;
    interface power : PowerInterface
        connect battery.powerOut to motor.powerIn;
}`,
		related: ['interface def', 'port', 'connection', 'flow']
	},
	{
		key: 'flow def',
		title: 'Flow definition',
		keyword: 'flow def',
		summary:
			'A flow definition describes a kind of transfer, of energy, material or data, from a source to a target.',
		explanation:
			"A flow definition is a kind of action definition (an interaction) that transfers a payload, the item being moved. Flow usages defined by it say what moves between which features. Define one when the same kind of transfer recurs and deserves properties of its own; otherwise a flow usage with 'of' is enough.",
		example: `item def Heat;
flow def HeatTransfer {
    ref item heat : Heat :>> payload;
}`,
		related: ['flow', 'item def', 'interface def']
	},
	{
		key: 'flow',
		title: 'Flow usage',
		keyword: 'flow … from … to',
		summary:
			'A flow shows something actually moving from one part to another, like fuel from the tank to the engine.',
		explanation:
			"A flow usage transfers a payload from a source output feature to a target input feature, usually through ports. It can be defined by a flow definition or simply name what flows with 'of'. Flows say what moves; connections and interfaces say along which path it can move.",
		example: `part def Vehicle {
    part tank : FuelTank;
    part engine : Engine;
    flow of Fuel from tank.fuelOut.fuel to engine.fuelIn.fuel;
}`,
		related: ['flow def', 'port', 'interface', 'succession']
	},
	{
		key: 'occurrence def',
		title: 'Occurrence definition',
		keyword: 'occurrence def',
		summary:
			'An occurrence definition describes anything that exists or happens over a span of time, such as a mission or project.',
		explanation:
			'An occurrence definition is the general definition for things with a lifetime: they begin, change and end. Items, parts, actions and states are all specialized kinds of occurrence. Use it directly for things that are none of those, such as projects, missions or test campaigns, and as the basis for snapshots, time slices and events.',
		example: `occurrence def Mission {
    attribute missionId : ScalarValues::String;
    part drone : Drone;
}`,
		related: ['occurrence', 'individual', 'item def', 'action def']
	},
	{
		key: 'occurrence',
		title: 'Occurrence usage',
		keyword: 'occurrence',
		summary:
			'An occurrence is a specific thing with a lifetime in context, such as this test campaign or an event in a sequence.',
		explanation:
			"An occurrence usage is a usage of an occurrence definition within its owner. Prefixed with 'event', it marks a moment of interest in another occurrence's life, such as a message being received.",
		example: `occurrence def DroneProject {
    occurrence engineWork : EngineSubproject;
    event occurrence firstFlight;
}`,
		related: ['occurrence def', 'individual', 'succession']
	},
	{
		key: 'individual',
		title: 'Individual',
		keyword: 'individual',
		summary:
			'An individual is one specific real-world thing, like the drone with serial number 0042, rather than a type.',
		explanation:
			"'individual part def' (or 'individual occurrence def', and so on) defines a class with exactly one instance: a particular physical object or event, usually specializing a general definition. Individual usages then describe that one thing in a context, for example its role in a test or a snapshot of it at a point in time.",
		analogy: 'Like a serial number, as opposed to the part number it was built to.',
		example: `part def Drone;
individual part def Drone0042 :> Drone;
occurrence def AcceptanceTest {
    individual part unitUnderTest : Drone0042;
}`,
		related: ['part def', 'occurrence def', 'part']
	},

	// ── Behavior ──────────────────────────────────────────────────────────────────────────────
	{
		key: 'action def',
		title: 'Action definition',
		keyword: 'action def',
		summary:
			'An action definition describes a kind of task or function, with what goes in and what comes out.',
		explanation:
			"An action definition is a reusable behavior with input and output parameters ('in', 'out'). It can be broken down into sub-actions ordered by successions and linked by flows. Action usages perform it in a context. Use action definitions to build a functional architecture before deciding which part does the work.",
		analogy: 'Like a block in a functional flow diagram or a function signature in code.',
		example: `action def ProduceThrust {
    in item power : ElectricalPower;
    out attribute thrust :> ISQ::force;
}`,
		related: ['action', 'perform', 'succession', 'calc def', 'state def']
	},
	{
		key: 'action',
		title: 'Action usage',
		keyword: 'action',
		summary:
			"An action is a specific step in a behavior, like 'take off' within a delivery mission.",
		explanation:
			"An action usage is a usage of an action definition within a larger behavior, or directly owned by a part. Successions ('first … then …') put actions in order, and flows pass items between their parameters. A part carries out an action through 'perform'.",
		example: `action def DeliverParcel {
    action takeOff : TakeOff;
    action cruise : Cruise;
    action land : Land;
    first takeOff then cruise;
    first cruise then land;
}`,
		related: ['action def', 'succession', 'perform', 'flow']
	},
	{
		key: 'succession',
		title: 'Succession',
		keyword: 'first … then',
		summary: 'A succession says one step must finish before the next one starts.',
		explanation:
			"A succession orders two occurrences in time: the first must end before the second begins. In actions it is written 'first a then b;' or, more compactly, 'then' in front of the next step. Successions express order only; to pass data between steps use flows or bindings.",
		example: `action def Delivery {
    action load;
    action fly;
    action drop;
    first load then fly;
    succession flyBeforeDrop first fly then drop;
}`,
		related: ['action', 'transition', 'flow']
	},
	{
		key: 'perform',
		title: 'Perform action',
		keyword: 'perform',
		summary:
			'Perform says that a part carries out an action described elsewhere, linking structure to behavior.',
		explanation:
			'A perform action usage inside a part (or an action) says that this part performs the referenced action; it refers to the action rather than owning a new copy. Use it to map functions from your functional breakdown onto the components that execute them.',
		example: `action deliver {
    action navigate;
}
part drone {
    part flightComputer {
        perform deliver.navigate;
    }
}`,
		related: ['action', 'exhibit', 'allocation']
	},
	{
		key: 'state def',
		title: 'State definition',
		keyword: 'state def',
		summary:
			'A state definition describes the modes something can be in, like off, idle and flying, and how it switches between them.',
		explanation:
			'A state definition is a kind of action definition whose behavior is organized as states and the transitions between them, triggered by events. States can be nested, and parallel states can run at the same time. A part exhibits a state usage to say that it behaves this way.',
		analogy: 'Like a mode diagram or a state machine in embedded software.',
		example: `state def DroneModes {
    entry; then off;
    state off;
    state on;
    transition first off accept TurnOn then on;
    transition first on accept TurnOff then off;
}`,
		related: ['state', 'transition', 'exhibit', 'action def']
	},
	{
		key: 'state',
		title: 'State usage',
		keyword: 'state',
		summary:
			"A state is one specific mode within a behavior, like 'charging', where certain actions run.",
		explanation:
			"A state usage is a usage of a state definition (or an untyped state) inside a state machine. While in the state, its 'do' action runs; 'entry' and 'exit' actions run on the way in and out. A whole state machine owned by a part is declared with 'exhibit state'.",
		example: `state def ChargerModes {
    entry; then idle;
    state idle;
    state charging {
        do action chargeBattery;
    }
    transition first idle accept PlugIn then charging;
}`,
		related: ['state def', 'transition', 'exhibit']
	},
	{
		key: 'transition',
		title: 'Transition',
		keyword: 'transition … first … then',
		summary:
			'A transition is a change from one state to another, triggered by an event and optionally guarded by a condition.',
		explanation:
			"A transition usage leads from a source state ('first') to a target state ('then'). It may have a trigger ('accept'), a guard ('if') that must be true, and an effect ('do') that runs while switching. Written directly after its source state, the 'transition' and 'first' parts may be left out.",
		example: `state def Charger {
    in attribute level : ScalarValues::Real;
    state idle;
    state charging;
    transition plugIn first idle
        accept PlugIn if level < 90 then charging;
}`,
		related: ['state', 'state def', 'succession']
	},
	{
		key: 'exhibit',
		title: 'Exhibit state',
		keyword: 'exhibit',
		summary:
			'Exhibit says that a part shows a certain state behavior, such as the drone exhibiting its operating modes.',
		explanation:
			"An exhibit state usage says that the owning part behaves according to the given state machine. It is the state counterpart of 'perform': it can declare a new state usage defined by a state definition, or refer to a state that is described elsewhere.",
		example: `part def Drone {
    exhibit state modes : DroneModes;
}`,
		related: ['state', 'state def', 'perform']
	},
	{
		key: 'constraint def',
		title: 'Constraint definition',
		keyword: 'constraint def',
		summary:
			"A constraint definition is a reusable rule or equation, like Ohm's law, that is either true or false.",
		explanation:
			'A constraint definition is a Boolean expression with parameters. Constraint usages apply it in a context by giving its parameters real values. Use constraints to capture physics, budgets and design rules that a tool can check or solve.',
		example: `constraint def OhmsLaw {
    in attribute v :> ISQ::voltage;
    in attribute i :> ISQ::electricCurrent;
    in attribute r :> ISQ::resistance;
    v == i * r
}`,
		related: ['constraint', 'calc def', 'requirement def']
	},
	{
		key: 'constraint',
		title: 'Constraint usage',
		keyword: 'constraint / assert constraint',
		summary:
			"A constraint is a rule applied in a specific place, like 'total mass at most 25 kg' for this drone.",
		explanation:
			"A constraint usage applies a constraint definition, or writes its expression inline, in a context. Plain 'constraint' just evaluates to true or false; 'assert constraint' states that it must always hold, so a violation is an error in the model. Requirements use 'require constraint' for the conditions they impose.",
		example: `part def Drone {
    attribute totalMass :> ISQ::mass;
    assert constraint massLimit {
        totalMass <= 25 [SI::kg]
    }
}`,
		related: ['constraint def', 'requirement', 'attribute']
	},
	{
		key: 'calc def',
		title: 'Calculation definition',
		keyword: 'calc def',
		summary:
			'A calculation definition is a reusable formula that takes inputs and returns one result, like estimating flight time.',
		explanation:
			"A calculation definition is an action definition that is also a function: 'in' parameters go in and one 'return' result comes out, given by the final expression in its body. Calculation usages apply it in a context. Use a calc for derived values and a constraint when you need a true/false rule.",
		analogy: 'Like a named spreadsheet formula or a function in a script.',
		example: `calc def FlightTime {
    in energy :> ISQ::energy;
    in power :> ISQ::power;
    return time :> ISQ::duration;
    energy / power
}`,
		related: ['calc', 'constraint def', 'analysis def']
	},
	{
		key: 'calc',
		title: 'Calculation usage',
		keyword: 'calc',
		summary:
			"A calc is a calculation used in a specific place, wired to that place's values to produce a result.",
		explanation:
			'A calculation usage is a usage of a calculation definition in a context, with its inputs bound to values available there. You can also call a calculation definition inline like a function, for example FlightTime(energy, power).',
		example: `part def Drone {
    attribute batteryEnergy :> ISQ::energy;
    attribute hoverPower :> ISQ::power;
    calc endurance : FlightTime {
        in energy = batteryEnergy;
        in power = hoverPower;
    }
}`,
		related: ['calc def', 'attribute', 'analysis']
	},

	// ── Requirements and cases ────────────────────────────────────────────────────────────────
	{
		key: 'requirement def',
		title: 'Requirement definition',
		keyword: 'requirement def',
		summary:
			"A requirement definition is a reusable template for a 'shall' statement, with a subject and a checkable condition.",
		explanation:
			"A requirement definition is a kind of constraint definition. It has a subject (what the requirement is about), optional attributes such as limits, and 'require constraint' conditions the subject must meet. Put the 'shall' text in a doc comment and the checkable condition in the constraint; requirement usages then apply the template to specific cases.",
		analogy:
			'Like a requirement template in a spec, with blanks for the limits that each use fills in.',
		example: `requirement def MassRequirement {
    doc /* The system mass shall not exceed the limit. */
    subject system : Drone;
    attribute massLimit :> ISQ::mass;
    require constraint { system.mass <= massLimit }
}`,
		related: ['requirement', 'subject', 'constraint def', 'concern def']
	},
	{
		key: 'requirement',
		title: 'Requirement usage',
		keyword: 'requirement',
		summary:
			"A requirement is a specific 'shall' statement in your model, like 'the drone shall weigh at most 25 kg'.",
		explanation:
			"A requirement usage is a usage of a requirement definition (or a stand-alone requirement) in a context, with its own id, text and values. Design elements 'satisfy' it, verification cases 'verify' it, and derived requirements trace back to it. Group usages inside a requirement to build a specification tree.",
		analogy:
			'Like a numbered line in a requirements specification, but linked to the design and the tests.',
		example: `requirement <'REQ-12'> droneMass : MassRequirement {
    doc /* The drone shall weigh at most 25 kg. */
    attribute :>> massLimit = 25 [SI::kg];
}
satisfy droneMass by prototype;`,
		related: ['requirement def', 'subject', 'verification', 'concern']
	},
	{
		key: 'subject',
		title: 'Subject',
		keyword: 'subject',
		summary:
			'The subject is the thing a requirement, use case, test or analysis is about, usually your system.',
		explanation:
			"The subject is a special first parameter of a requirement or a case (use case, verification, analysis). When a design element satisfies a requirement, it is bound to the requirement's subject; in a verification, the subject is the unit under test.",
		example: `requirement def MaxMass {
    subject drone : Drone;
    require constraint { drone.mass <= 25 [SI::kg] }
}`,
		related: ['requirement def', 'use case def', 'verification def', 'actor']
	},
	{
		key: 'concern def',
		title: 'Concern definition',
		keyword: 'concern def',
		summary:
			'A concern definition captures a worry or interest that stakeholders have, such as airspace safety or noise.',
		explanation:
			"A concern definition is a kind of requirement definition that names the stakeholders who hold it. Requirements and viewpoints 'frame' concerns, which records why something matters and who cares. Concern usages apply it in a specific context.",
		example: `concern def AirspaceSafety {
    stakeholder authority : AviationAuthority;
    require constraint {
        doc /* Keep separation from crewed aircraft. */
    }
}`,
		related: ['concern', 'stakeholder', 'viewpoint def', 'requirement def']
	},
	{
		key: 'concern',
		title: 'Concern usage',
		keyword: 'concern / frame concern',
		summary:
			'A concern is a specific stakeholder interest in context, framed by requirements or viewpoints to show who cares and why.',
		explanation:
			"A concern usage is a usage of a concern definition. Inside a requirement or viewpoint, 'frame concern' declares that this requirement or viewpoint addresses that concern, giving a traceable line from stakeholder to requirement.",
		example: `requirement def NoiseLimit {
    subject drone : Drone;
    frame concern neighbours : NoiseNuisance;
}`,
		related: ['concern def', 'stakeholder', 'requirement']
	},
	{
		key: 'stakeholder',
		title: 'Stakeholder',
		keyword: 'stakeholder',
		summary:
			'A stakeholder is a person or organization with an interest in the system, such as a regulator or a customer.',
		explanation:
			'A stakeholder is a part usage declared in a requirement, concern or viewpoint to say whose interest it represents. It records who cares, and is the starting point for tracing concerns into requirements and views.',
		example: `part def AviationAuthority;
concern def AirspaceSafety {
    stakeholder authority : AviationAuthority;
}`,
		related: ['concern def', 'viewpoint def', 'actor']
	},
	{
		key: 'use case def',
		title: 'Use case definition',
		keyword: 'use case def',
		summary:
			"A use case definition describes a goal-driven interaction between the system and its users, like 'deliver a parcel'.",
		explanation:
			'A use case definition is a kind of case. It names a subject (the system), the actors who interact with it, and an objective (what the actors want to achieve); its steps can be actions and included use cases. Use case usages apply it in a context. Use cases capture what the system is for before you decide how it is built.',
		example: `use case def DeliverParcel {
    subject drone : Drone;
    actor customer : Person;
    objective {
        doc /* The parcel arrives intact at the address. */
    }
}`,
		related: ['use case', 'actor', 'objective', 'subject']
	},
	{
		key: 'use case',
		title: 'Use case usage',
		keyword: 'use case / include',
		summary:
			'A use case is a specific scenario of use in context, which can include other use cases as steps.',
		explanation:
			"A use case usage is a usage of a use case definition, for example in a system context where its subject and actors are bound to real parts. A use case can 'include' another as one of its steps, just like performing an action.",
		example: `part def DeliveryService {
    use case deliver : DeliverParcel;
    use case dailyRound {
        first start;
        then include deliver;
        then done;
    }
}`,
		related: ['use case def', 'actor', 'action']
	},
	{
		key: 'actor',
		title: 'Actor',
		keyword: 'actor',
		summary:
			'An actor is someone or something outside the system that interacts with it, like an operator or a ground station.',
		explanation:
			'An actor is a part usage declared as a parameter of a use case or requirement, standing for an external entity that interacts with the subject. Because actors are parts, they can be defined by part definitions and bound to real parts in a system context.',
		example: `use case def InspectBridge {
    subject drone : Drone;
    actor pilot : Operator;
    actor station : GroundStation;
}`,
		related: ['use case def', 'subject', 'stakeholder']
	},
	{
		key: 'objective',
		title: 'Objective',
		keyword: 'objective',
		summary: 'An objective states what a use case, test or analysis is trying to achieve.',
		explanation:
			"An objective is a requirement owned by a case. In a use case it states the actors' goal; in a verification case it lists the requirements being verified ('verify'); in an analysis case it says what the result must tell you, and under what assumptions.",
		example: `use case def SurveyField {
    subject drone : Drone;
    objective {
        doc /* Map the whole field in a single flight. */
    }
}`,
		related: ['use case def', 'verification def', 'analysis def', 'requirement']
	},
	{
		key: 'verification def',
		title: 'Verification definition',
		keyword: 'verification def',
		summary:
			'A verification definition describes a reusable test or inspection procedure that checks requirements and returns a pass/fail verdict.',
		explanation:
			'A verification case definition is a kind of case. Its subject is the thing under test, its objective names the requirements it verifies, its steps are actions, and its result is a verdict (pass, fail, inconclusive or error). Verification usages apply it to a specific test article or campaign.',
		analogy: 'Like a test procedure document, linked to the requirements it closes.',
		example: `verification def MassTest {
    subject testDrone : Drone;
    objective {
        verify droneMass;
    }
    action weigh;
    return verdict : VerdictKind;
}`,
		related: ['verification', 'objective', 'requirement', 'subject']
	},
	{
		key: 'verification',
		title: 'Verification usage',
		keyword: 'verification',
		summary:
			'A verification is a specific planned or executed test, such as weighing prototype two against the mass requirement.',
		explanation:
			'A verification case usage is a usage of a verification case definition in a context, with its subject bound to the actual test article. The requirements in its objective show as verified by it in traceability views.',
		example: `part def TestCampaign {
    part prototype : Drone;
    verification massCheck : MassTest {
        subject :>> testDrone = prototype;
    }
}`,
		related: ['verification def', 'requirement', 'individual']
	},
	{
		key: 'analysis def',
		title: 'Analysis definition',
		keyword: 'analysis def',
		summary:
			'An analysis definition describes a reusable study, like a trade study or endurance estimate, that computes a result.',
		explanation:
			'An analysis case definition is a kind of case with a subject (what is analyzed), an objective, input parameters and a returned result; its body can use calculations and constraints. Analysis usages run it on a specific design. It keeps engineering analyses inside the model instead of in a disconnected spreadsheet.',
		example: `analysis def EnduranceAnalysis {
    subject drone : Drone;
    objective {
        doc /* Estimate hover endurance on a full battery. */
    }
    return endurance :> ISQ::duration = drone.energy / drone.hoverPower;
}`,
		related: ['analysis', 'calc def', 'constraint def', 'objective']
	},
	{
		key: 'analysis',
		title: 'Analysis usage',
		keyword: 'analysis',
		summary:
			'An analysis is a specific study run on a specific design, like the endurance estimate for this drone variant.',
		explanation:
			'An analysis case usage is a usage of an analysis case definition in a context, with its subject and inputs bound to a particular design. Its result can feed requirements checks or trade-off decisions.',
		example: `part def DesignReview {
    part candidate : Drone;
    analysis endurance : EnduranceAnalysis {
        subject :>> drone = candidate;
    }
}`,
		related: ['analysis def', 'calc', 'variation']
	},
	{
		key: 'allocation def',
		title: 'Allocation definition',
		keyword: 'allocation def',
		summary:
			"An allocation definition describes a kind of responsibility assignment, like 'logical function to physical component'.",
		explanation:
			'An allocation definition is a kind of connection definition stating that some or all of the responsibility of one element (the source) is assigned to another (the target). Typical uses: functions to components, software to hardware, logical to physical architecture. Allocation usages make the specific assignments.',
		example: `allocation def LogicalToPhysical {
    end part logical;
    end part physical;
}`,
		related: ['allocation', 'connection def', 'perform']
	},
	{
		key: 'allocation',
		title: 'Allocation usage',
		keyword: 'allocate … to',
		summary:
			"An allocation says 'this element takes responsibility for that one', such as running navigation on the flight computer.",
		explanation:
			"An allocation usage assigns a source element to a target element, written 'allocate a to b'. It can be defined by an allocation definition and may contain finer-grained allocations. Allocations keep logical and physical architectures separate while recording how they map.",
		analogy: 'Like a row in a function-to-component mapping matrix.',
		example: `part def System {
    part logical { action navigate; }
    part physical { part flightComputer; }
    allocation : LogicalToPhysical
        allocate logical.navigate to physical.flightComputer;
}`,
		related: ['allocation def', 'perform', 'action']
	},

	// ── Views ─────────────────────────────────────────────────────────────────────────────────
	{
		key: 'viewpoint def',
		title: 'Viewpoint definition',
		keyword: 'viewpoint def',
		summary:
			'A viewpoint definition states what a group of stakeholders needs to see, so that views can be built to serve them.',
		explanation:
			'A viewpoint definition is a kind of requirement definition that frames one or more stakeholder concerns. Views satisfy viewpoints, so every diagram or report stays traceable to the question it answers and the people who asked it.',
		example: `viewpoint def ArchitecturePerspective {
    frame concern overview : ArchitectureOverview;
    require constraint {
        doc /* Show the top-level parts and how they connect. */
    }
}`,
		related: ['viewpoint', 'view def', 'concern def', 'stakeholder']
	},
	{
		key: 'viewpoint',
		title: 'Viewpoint usage',
		keyword: 'viewpoint',
		summary:
			'A viewpoint is a specific stakeholder perspective used in context, typically one that a view must satisfy.',
		explanation:
			'A viewpoint usage is a usage of a viewpoint definition. Declared inside a view definition or view, it is a viewpoint that the view satisfies.',
		example: `view def RequirementList {
    viewpoint reqPerspective : RequirementPerspective;
    render Views::asElementTable;
}`,
		related: ['viewpoint def', 'view def', 'view']
	},
	{
		key: 'view def',
		title: 'View definition',
		keyword: 'view def',
		summary:
			'A view definition describes a kind of diagram or report: which model content to show and how to show it.',
		explanation:
			"A view definition is a kind of part definition that specifies how to build a view artifact: the viewpoints it satisfies, filter conditions that select elements, and a rendering (tree, table, interconnection diagram). View usages defined by it 'expose' the actual model content. Views are generated from the model, never maintained as separate copies.",
		analogy: 'Like a saved report template: same layout every time, always fed from live data.',
		example: `view def PartsTree {
    satisfy vp : ArchitecturePerspective;
    filter @SysML::PartUsage;
    render Views::asTreeDiagram;
}`,
		related: ['view', 'viewpoint def', 'rendering def']
	},
	{
		key: 'view',
		title: 'View usage',
		keyword: 'view / expose',
		summary:
			'A view is a specific diagram or report generated from the model, like the parts tree of the drone.',
		explanation:
			"A view usage is a usage of a view definition that 'expose's the model elements to show. Its definition's filter and rendering then decide what appears and how. A view can also add its own filter or rendering.",
		example: `view dronePartsTree : PartsTree {
    expose DroneModel::Structure::**;
}`,
		related: ['view def', 'viewpoint', 'rendering']
	},
	{
		key: 'rendering def',
		title: 'Rendering definition',
		keyword: 'rendering def',
		summary:
			'A rendering definition describes a way of drawing a view, such as a tree diagram or a table.',
		explanation:
			"A rendering definition is a kind of part definition that specifies how a view's exposed elements are presented. The standard Views library already provides asTreeDiagram, asInterconnectionDiagram, asElementTable and asTextualNotation; define your own when you need a house style.",
		example: `rendering def CompanyTable {
    doc /* Element table with our standard columns. */
}
view def ComponentList {
    render rendering table : CompanyTable;
}`,
		related: ['rendering', 'view def']
	},
	{
		key: 'rendering',
		title: 'Rendering usage',
		keyword: 'rendering / render',
		summary:
			'A rendering is a specific drawing style used by a view, such as the standard tree diagram.',
		explanation:
			"A rendering usage is a usage of a rendering definition. Inside a view, 'render' names the rendering to use, either one from the Views library or one of your own.",
		example: `rendering companyTable : CompanyTable;
view def ComponentList {
    render companyTable;
}`,
		related: ['rendering def', 'view']
	},

	// ── Product lines and extension ───────────────────────────────────────────────────────────
	{
		key: 'variation',
		title: 'Variation',
		keyword: 'variation',
		summary:
			'A variation marks a choice point in a product line: an element whose possible options are listed as variants.',
		explanation:
			"Prefixing a definition or usage with 'variation' means that anything it describes must be exactly one of its listed variants. Variations, together with constraints between choices, model product-line options and trade spaces. A configuration picks a variant by redefining the variation usage.",
		analogy: 'Like an option code on a configurable product: one choice from a fixed list.',
		example: `part def Drone {
    variation part battery : Battery {
        variant part standard : StandardPack;
        variant part extended : HighCapacityPack;
    }
}`,
		related: ['variant', 'enum def', 'part']
	},
	{
		key: 'variant',
		title: 'Variant',
		keyword: 'variant',
		summary:
			'A variant is one allowed option within a variation, like the standard or the extended battery.',
		explanation:
			'A variant is a usage owned by a variation; each one is a complete alternative for it. A specific configuration selects a variant by redefining the variation usage and binding it to that variant.',
		example: `part def Drone {
    variation part battery : Battery {
        variant part standard : StandardPack;
        variant part extended : HighCapacityPack;
    }
}
part longRangeDrone : Drone { part :>> battery = battery::extended; }`,
		related: ['variation', 'part']
	},
	{
		key: 'metadata def',
		title: 'Metadata definition',
		keyword: 'metadata def',
		summary:
			'A metadata definition creates your own tag type, like Status or Risk, that you can attach to any model element.',
		explanation:
			'A metadata definition is a kind of item definition (and a KerML metaclass) whose attributes are the fields of the tag. Metadata usages attach it to elements with values, without changing what those elements mean. Use it for process data such as status, owner or risk, or, as semantic metadata, to create your own domain keywords.',
		analogy: 'Like custom properties or a stamp on a drawing: extra information, same drawing.',
		example: `enum def StatusKind { draft; review; approved; }
metadata def Status {
    attribute status : StatusKind;
    attribute owner : ScalarValues::String;
}`,
		related: ['metadata', 'doc', 'enum def']
	},
	{
		key: 'metadata',
		title: 'Metadata usage',
		keyword: '@ / metadata … about',
		summary:
			"A metadata usage attaches a tag with values to a model element, such as marking a part as 'in review'.",
		explanation:
			"A metadata usage is a usage of a metadata definition that annotates one or more elements. Inside an element, write '@Status { … }'; elsewhere, write 'metadata Status about Battery { … }'. Tools can filter, colour and report on metadata values.",
		example: `part def Battery {
    @Status {
        status = StatusKind::review;
        owner = "Vince";
    }
}`,
		related: ['metadata def', 'doc', 'view def']
	}
];

export const CONCEPTS: Record<string, Concept> = Object.fromEntries(LIST.map((c) => [c.key, c]));

/** Look up the concept for an engine element kind, e.g. ('part', true) → part definition. */
export function conceptFor(kind: string, isDefinition: boolean): Concept | undefined {
	const base = kind
		.trim()
		.toLowerCase()
		.replace(/[_\s]+/g, ' ')
		.replace(/ def$/, '');
	const keys = isDefinition ? [`${base} def`, base] : [base];
	for (const key of keys) {
		if (Object.prototype.hasOwnProperty.call(CONCEPTS, key)) return CONCEPTS[key];
	}
	return undefined;
}

/** Plain-language explanation of a relationship keyword ('satisfy', 'verify', 'specializes', …). */
export const RELATIONSHIPS: Record<string, { title: string; summary: string; example: string }> = {
	specialization: {
		title: 'Specialization (:> / specializes)',
		summary:
			"Says that one definition is a more specific kind of another: it inherits all of its features and can add or refine them. Between usages, ':>' means subsetting.",
		example: `part def Drone {
    attribute mass :> ISQ::mass;
}
part def Quadcopter specializes Drone {
    part rotors : Rotor[4];
}`
	},
	redefinition: {
		title: 'Redefinition (:>> / redefines)',
		summary:
			'Replaces an inherited feature in a more specific context, for example to give it a value, narrow its type or tighten its multiplicity.',
		example: `part def Drone {
    attribute maxSpeed :> ISQ::speed;
}
part def RacingDrone :> Drone {
    attribute :>> maxSpeed = 40 [SI::'m/s'];
}`
	},
	subsetting: {
		title: 'Subsetting (:> / subsets)',
		summary:
			"Says that every value of one feature is also a value of another: the front wheels are some of the wheels. Writing 'attribute mass :> ISQ::mass' subsets a library quantity.",
		example: `part def Car {
    part wheels : Wheel[4];
    part frontWheels : Wheel[2] :> wheels;
}`
	},
	typing: {
		title: 'Typing (: / defined by)',
		summary:
			'Says which definition a usage is defined by, so the usage gets all the features that the definition declares.',
		example: `part def Drone {
    part battery : Battery;
    part spare defined by Battery;
}`
	},
	composition: {
		title: 'Composition (part ownership)',
		summary:
			'A part usage nested in a definition or usage is composite: it belongs to its owner and does not outlive it. This builds the system breakdown.',
		example: `part def Drone {
    part battery : Battery;
    part frame : Airframe;
}`
	},
	reference: {
		title: 'Reference (ref)',
		summary:
			'Points to something without owning it: the drone refers to the parcel it carries, but the parcel exists before and after the flight.',
		example: `part def Drone {
    ref item cargo : Parcel[0..1];
    ref part operator : Person;
}`
	},
	connect: {
		title: 'Connect',
		summary:
			'Links two features, usually ports of parts, so they can interact. A connection or interface usage gives the link a name and a type.',
		example: `part def Drone {
    part battery : Battery;
    part motor : Motor;
    connect battery.powerOut to motor.powerIn;
}`
	},
	bind: {
		title: 'Bind (=)',
		summary:
			"Says that two features always have the same value or are the same thing, such as an outer port being the battery's charging port.",
		example: `part def Drone {
    port chargePort : ~ChargePort;
    part battery : Battery;
    bind chargePort = battery.chargeIn;
}`
	},
	flow: {
		title: 'Flow',
		summary:
			'Shows something being transferred, such as energy, material or data, from an output of one feature to an input of another.',
		example: `part def Drone {
    part battery : Battery;
    part motor : Motor;
    flow of ElectricalPower from battery.powerOut.power to motor.powerIn.power;
}`
	},
	satisfy: {
		title: 'Satisfy',
		summary:
			'Claims that a design element meets a requirement; the element is bound to the requirement as its subject.',
		example: `requirement droneMass : MassRequirement;
part prototype : Drone;
satisfy droneMass by prototype;`
	},
	verify: {
		title: 'Verify',
		summary:
			"Declares, inside a verification case's objective, which requirement the test checks; the case's verdict says whether it passed.",
		example: `verification def MassTest {
    subject testDrone : Drone;
    objective {
        verify droneMass;
    }
}`
	},
	derive: {
		title: 'Derive (#derivation)',
		summary:
			'Records that a lower-level requirement was derived from a higher-level one, using the derivation connection from the RequirementDerivation library.',
		example: `private import RequirementDerivation::*;
requirement systemMass : MassRequirement;
requirement batteryMass : MassRequirement;
#derivation connection {
    end #original ::> systemMass;
    end #derive ::> batteryMass;
}`
	},
	allocate: {
		title: 'Allocate',
		summary:
			'Assigns responsibility for one element to another, typically a function to the component that will carry it out.',
		example: `part def System {
    action navigate;
    part flightComputer;
    allocate navigate to flightComputer;
}`
	},
	perform: {
		title: 'Perform',
		summary:
			'Says that a part carries out an action, connecting the functional and the physical view.',
		example: `action deliver {
    action navigate;
}
part flightComputer {
    perform deliver.navigate;
}`
	},
	exhibit: {
		title: 'Exhibit',
		summary:
			'Says that a part behaves according to a state machine, being in those states over its life.',
		example: `part def Drone {
    exhibit state modes : DroneModes;
}`
	},
	include: {
		title: 'Include (use case)',
		summary:
			'Makes one use case a step of another, so a common scenario such as take-off is described once and reused.',
		example: `use case def DailyRound {
    use case deliver : DeliverParcel;
    first start;
    then include deliver;
    then done;
}`
	},
	expose: {
		title: 'Expose (views)',
		summary:
			"Selects which part of the model a view shows; the view's filter and rendering then decide what appears and how.",
		example: `view dronePartsTree : PartsTree {
    expose DroneModel::Structure::**;
}`
	},
	dependency: {
		title: 'Dependency',
		summary:
			'A general "relies on" link: a change to the supplier may affect the client. Use it when no more specific relationship fits.',
		example: `package Requirements;
package Architecture;
dependency from Requirements to Architecture;`
	}
};
