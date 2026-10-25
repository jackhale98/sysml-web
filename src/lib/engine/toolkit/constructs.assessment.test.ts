/**
 * Assessment (docs/assessment/01-language.md): the supported-construct
 * matrix, from evidence. One model with each construct the checklist names
 * (1.1), run through what Fairtide does with it: parse and resolve (the
 * toolkit), the model adapter (what the explorer, inspector and tables
 * see), the standard diagrams, an inspector edit, evaluation and the state
 * machine simulator.
 *
 * Parsing, resolution and editing are asserted for every construct. Which
 * constructs a diagram, the evaluator or the simulator covers is recorded
 * as the matrix (`MATRIX`): a change there is a change in coverage, to be
 * reflected in the assessment.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Analysis, DiagramGraph, DiagramView, Definition, Usage } from '../types';
import { editFiles } from './edit-testing';
import type { ToolkitHost } from './host';
import { loadHost } from './testing';

const PATH = 'model/Constructs.sysml';
const MODEL = `package Constructs {
    doc /* One of each construct the assessment checklist names. */
    private import ScalarValues::*;
    private import SI::*;

    package Defs {
        item def Power;
        enum def Mode { enum off; enum on; }
        port def PowerPort { out item power : Power; }
        interface def PowerLink {
            end supplier : PowerPort;
            end consumer : ~PowerPort;
        }
        abstract part def Component;
        part def Battery :> Component {
            port supply : PowerPort;
            attribute capacity : Real = 50.0;
        }
        part def Motor :> Component { port feed : ~PowerPort; }
        part def Wheel :> Component { attribute radius : Real = 0.3; }
        connection def Wiring {
            end a : Battery;
            end b : Motor;
        }
        part def Vehicle {
            attribute mass :> ISQ::mass;
            attribute mode : Mode;
        }
        action def Drive {
            in item command : Power;
            out item torque : Power;
        }
        state def Modes {
            entry; then off;
            state off;
            state on;
            transition first off accept Start then on;
            transition first on accept Stop then off;
        }
        attribute def Start;
        attribute def Stop;
        constraint def MassLimit {
            in m :> ISQ::mass;
            m <= 2000 [kg]
        }
        requirement def MassRequirement {
            subject v : Vehicle;
            require constraint { v.mass <= 2000 [kg] }
        }
        metadata def Reviewed { attribute reviewer : String; }
    }
    alias Car for Defs::Vehicle;

    package Design {
        private import Defs::*;
        part car : Car {
            attribute :>> mass default 1500 [kg];
            part battery : Battery;
            part motor : Motor;
            part wheels : Wheel[4];
            part spare : Wheel[0..1];
            interface link : PowerLink connect supplier ::> battery.supply to consumer ::> motor.feed;
            connection wiring : Wiring connect a ::> battery to b ::> motor;
            flow of Power from battery.supply.power to motor.feed.power;
            action drive : Drive;
            exhibit state modes : Modes;
            assert constraint massOk : MassLimit { in m = mass; }
            attribute total = battery.capacity * 2;
            @Reviewed { reviewer = "QA"; }
        }
        part sportsCar :> car {
            attribute :>> mass = 1200 [kg];
        }
        requirement massReq : MassRequirement { subject v = car; }
        satisfy massReq by car;
        comment about car /* An annotation about the car. */
    }
}
`;

let host: ToolkitHost;
let analysis: Analysis;
const files = [{ path: PATH, text: MODEL }];
const graphs: Partial<Record<DiagramView, DiagramGraph[]>> = {};

beforeAll(async () => {
	host = await loadHost();
	analysis = host.analyzeProject(files)[0]!;
	const draw = (view: DiagramView, scope: string | null) =>
		(graphs[view] ??= []).push(host.diagram(view, files, scope));
	draw('general', null);
	draw('general', 'Constructs::Design::car');
	draw('interconnection', 'Constructs::Design::car');
	draw('states', 'Constructs::Defs::Modes');
	draw('actions', 'Constructs::Defs::Drive');
	draw('requirements', null);
	draw('packages', null);
	draw('trace', null);
}, 60_000);

const elements = () => [...analysis.model.definitions, ...analysis.model.usages];
const byName = (qualified: string): Definition | Usage | undefined =>
	elements().find((e) => e.qualified_name === qualified);

type Drawn = (g: DiagramGraph) => boolean;
const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = (t: string) => new RegExp(`(^|[^\\w])${escape(t)}($|[^\\w])`);
/** A node labelled `name` (or a compartment row naming it). */
const node =
	(name: string): Drawn =>
	(g) =>
		g.nodes.some(
			(n) => word(name).test(n.label) || n.attributes.some(([, r]) => word(name).test(r))
		);
/** A compartment row (or node label) containing `text`. */
const row =
	(text: string): Drawn =>
	(g) =>
		g.nodes.some((n) => n.label.includes(text) || n.attributes.some(([, r]) => r.includes(text)));
/** An edge of `kind`, optionally with a label containing `label`. */
const edge =
	(kind: string, label?: string): Drawn =>
	(g) =>
		g.edges.some((e) => e.kind === kind && (!label || (e.label ?? '').includes(label)));
/** An edge of `kind` between nodes labelled `a` and `b`. */
const between =
	(kind: string, a: string, b: string): Drawn =>
	(g) => {
		const id = (l: string) =>
			g.nodes
				.filter(
					(n) =>
						n.label.replace(/^«[^»]*»\s*/, '') === l || n.label.endsWith(` ${l}`) || n.label === l
				)
				.map((n) => n.id);
		return g.edges.some(
			(e) => e.kind === kind && id(a).includes(e.source) && id(b).includes(e.target)
		);
	};

/** The views (of those drawn) where `drawn` holds. */
const viewsWhere = (drawn: Drawn): DiagramView[] =>
	(Object.keys(graphs) as DiagramView[]).filter((v) => graphs[v]!.some(drawn));

/** The construct, how to find it, and how a diagram would show it. */
const CONSTRUCTS: { construct: string; element?: string; drawn?: Drawn; rename?: false }[] = [
	{ construct: 'package', element: 'Constructs::Defs', drawn: node('Defs') },
	{ construct: 'part definition', element: 'Constructs::Defs::Battery', drawn: node('Battery') },
	{
		construct: 'abstract definition',
		element: 'Constructs::Defs::Component',
		drawn: node('Component')
	},
	{ construct: 'part usage', element: 'Constructs::Design::car', drawn: node('car') },
	{
		construct: 'specialization (:>)',
		element: 'Constructs::Defs::Wheel',
		drawn: between('specialization', 'Wheel', 'Component')
	},
	{ construct: 'inheritance (inherited feature)', drawn: row('battery') },
	{
		construct: 'redefinition (:>>)',
		element: 'Constructs::Design::sportsCar::mass',
		drawn: row('1200'),
		rename: false
	},
	{
		construct: 'attribute',
		element: 'Constructs::Defs::Battery::capacity',
		drawn: node('capacity')
	},
	{ construct: 'enumeration', element: 'Constructs::Defs::Mode', drawn: node('Mode') },
	{
		construct: 'port (and ~conjugate)',
		element: 'Constructs::Defs::Motor::feed',
		drawn: row('~PowerPort')
	},
	{
		construct: 'interface',
		element: 'Constructs::Design::car::link',
		drawn: edge('connection', 'link')
	},
	{
		construct: 'connection',
		element: 'Constructs::Design::car::wiring',
		drawn: edge('connection', 'wiring')
	},
	{ construct: 'flow', drawn: edge('flow') },
	{ construct: 'action', element: 'Constructs::Defs::Drive', drawn: node('Drive') },
	{
		construct: 'state',
		element: 'Constructs::Defs::Modes::on',
		drawn: (g) => g.nodes.some((n) => n.kind === 'state' && n.label === 'on')
	},
	{ construct: 'transition', drawn: edge('transition', 'Start') },
	{ construct: 'requirement', element: 'Constructs::Design::massReq', drawn: node('massReq') },
	{ construct: 'satisfy', drawn: edge('satisfy') },
	{
		construct: 'constraint (assert)',
		element: 'Constructs::Design::car::massOk',
		drawn: node('massOk')
	},
	{ construct: 'nested part', element: 'Constructs::Design::car::battery', drawn: node('battery') },
	{ construct: 'multiplicity [4]', element: 'Constructs::Design::car::wheels', drawn: row('[4]') },
	{ construct: 'optional [0..1]', element: 'Constructs::Design::car::spare', drawn: row('[0..1]') },
	{
		construct: 'metadata (@)',
		element: 'Constructs::Defs::Reviewed',
		// The annotation on `car`, not the metadata definition's own node.
		drawn: (g) =>
			g.nodes.some(
				(n) =>
					/\bcar\b/.test(n.label) &&
					(/Reviewed/.test(n.stereotype ?? '') ||
						n.attributes.some(([k, r]) => /Reviewed/.test(k) || /Reviewed/.test(r)))
			)
	},
	{ construct: 'comment about (annotation)', drawn: row('An annotation about the car') },
	{ construct: 'doc', drawn: row('One of each construct') },
	{ construct: 'import' },
	{ construct: 'alias', drawn: node('Car') },
	{ construct: 'qualified name reference' }
];

describe('the construct model', () => {
	it('parses and resolves with no problems', () => {
		expect(analysis.model.syntax_errors).toEqual([]);
		expect(analysis.diagnostics).toEqual([]);
	});

	it('the adapter lists every named construct with its kind', () => {
		const kinds = Object.fromEntries(
			CONSTRUCTS.filter((c) => c.element).map((c) => [c.construct, byName(c.element!)?.kind])
		);
		expect(kinds).toEqual({
			package: 'package',
			'part definition': 'part',
			'abstract definition': 'part',
			'part usage': 'part',
			'specialization (:>)': 'part',
			'redefinition (:>>)': 'attribute',
			attribute: 'attribute',
			enumeration: 'enum',
			'port (and ~conjugate)': 'port',
			interface: 'interface',
			connection: 'connection',
			action: 'action',
			state: 'state',
			requirement: 'requirement',
			'constraint (assert)': 'constraint',
			'nested part': 'part',
			'multiplicity [4]': 'part',
			'optional [0..1]': 'part',
			'metadata (@)': 'metadata'
		});
	});

	it('the adapter reads relationships as resolved', () => {
		const wheel = byName('Constructs::Defs::Wheel') as Definition;
		expect(wheel.super_type).toBe('Component');
		expect(byName('Constructs::Design::sportsCar::mass')).toMatchObject({ redefinition: 'mass' });
		// Typed through the alias `Car`: the adapter names the aliased definition.
		expect(byName('Constructs::Design::car')).toMatchObject({ type_ref: 'Vehicle' });
		expect(byName('Constructs::Design::car::wheels')).toMatchObject({ multiplicity: '4' });
		expect(byName('Constructs::Design::car::spare')).toMatchObject({ multiplicity: '0..1' });
		expect(byName('Constructs::Defs::Motor::feed')).toMatchObject({ is_conjugated: true });
		expect(analysis.model.satisfactions).toMatchObject([{ requirement: 'massReq', by: 'car' }]);
		expect(analysis.model.annotations).toMatchObject([
			{ metadata_type: 'Reviewed', values: [['reviewer', '"QA"']] }
		]);
		expect(byName('Constructs')).toMatchObject({
			doc: 'One of each construct the assessment checklist names.'
		});
	});

	it('an inherited feature resolves and evaluates through the specialization', () => {
		const edited = [
			{
				path: PATH,
				text: MODEL.replace(
					'part sportsCar :> car {',
					'part sportsCar :> car {\n            attribute c = battery.capacity;'
				)
			}
		];
		const result = host.analyzeProject(edited)[0]!;
		expect(result.diagnostics).toEqual([]);
		const c = result.model.usages.find(
			(u) => u.qualified_name === 'Constructs::Design::sportsCar::c'
		)!;
		expect(host.evaluate(edited, [c.id!])[c.id!]).toMatchObject({ kind: 'number', value: 50 });
	});

	it('the inspector edits every named construct without touching the rest of the file', () => {
		const failures: string[] = [];
		for (const c of CONSTRUCTS.filter((x) => x.element)) {
			const element = byName(c.element!)!;
			const ops = [
				{
					op: 'setDeclaration',
					element: c.element!,
					line: element.span.start_row,
					id: element.id,
					set: { doc: 'Edited.' }
				},
				{
					op: 'rename',
					from: element.name,
					to: `${element.name}2`,
					line: element.span.start_row,
					id: element.id
				}
			] as const;
			// An unnamed redefinition has no name of its own to rename.
			for (const op of c.rename === false ? ops.slice(0, 1) : ops) {
				const out = editFiles(host, { [PATH]: MODEL }, { path: PATH, ...op });
				if ('error' in out) {
					failures.push(`${c.construct} ${op.op}: ${out.error}`);
					continue;
				}
				const after = out.files[PATH]!;
				const problems = host.analyzeProject([{ path: PATH, text: after }])[0]!;
				if (problems.diagnostics.length || problems.model.syntax_errors.length)
					failures.push(`${c.construct} ${op.op}: problems after the edit`);
				if (op.op === 'setDeclaration') {
					// Only the element's own declaration changed.
					if (
						out.result.changes.some((x) => x.from < element.span.from! || x.to > element.span.to!)
					)
						failures.push(`${c.construct}: changed text outside its declaration`);
				}
			}
		}
		expect(failures).toEqual([]);
	});
});

/**
 * Where each construct shows beyond the text: the diagrams that draw it
 * (node, compartment row or edge label), whether its value or verdict is
 * evaluated, and whether the simulator runs it.
 */
const MATRIX: Record<string, { diagrams: DiagramView[]; evaluated: string; simulated: boolean }> =
	{};

describe('coverage beyond the text', () => {
	it('records which views, evaluations and simulations cover each construct', () => {
		const machines = host.stateMachines(files);
		const checks = host.checks(files).checks;
		const values = host.evaluate(
			files,
			elements()
				.filter((e) => e.kind === 'attribute')
				.map((e) => e.id!)
		);
		for (const c of CONSTRUCTS) {
			const element = c.element ? byName(c.element) : undefined;
			let evaluated = '-';
			if (element?.kind === 'attribute') evaluated = values[element.id!]?.kind ?? '-';
			if (c.construct === 'constraint (assert)')
				evaluated = checks.find((k) => k.name === 'massOk')?.status ?? '-';
			if (c.construct === 'satisfy')
				evaluated = checks.find((k) => k.kind === 'satisfy')?.status ?? '-';
			const simulated =
				(c.construct === 'state' && machines.some((m) => m.states.some((s) => s.name === 'on'))) ||
				(c.construct === 'transition' &&
					machines.some((m) => m.transitions.some((t) => t.trigger === 'Start')));
			MATRIX[c.construct] = {
				diagrams: c.drawn ? viewsWhere(c.drawn) : [],
				evaluated,
				simulated
			};
		}
		expect(MATRIX).toMatchInlineSnapshot(`
			{
			  "abstract definition": {
			    "diagrams": [
			      "general",
			      "packages",
			    ],
			    "evaluated": "-",
			    "simulated": false,
			  },
			  "action": {
			    "diagrams": [
			      "general",
			      "packages",
			    ],
			    "evaluated": "-",
			    "simulated": false,
			  },
			  "alias": {
			    "diagrams": [],
			    "evaluated": "-",
			    "simulated": false,
			  },
			  "attribute": {
			    "diagrams": [
			      "general",
			    ],
			    "evaluated": "number",
			    "simulated": false,
			  },
			  "comment about (annotation)": {
			    "diagrams": [],
			    "evaluated": "-",
			    "simulated": false,
			  },
			  "connection": {
			    "diagrams": [
			      "interconnection",
			    ],
			    "evaluated": "-",
			    "simulated": false,
			  },
			  "constraint (assert)": {
			    "diagrams": [
			      "general",
			    ],
			    "evaluated": "satisfied",
			    "simulated": false,
			  },
			  "doc": {
			    "diagrams": [],
			    "evaluated": "-",
			    "simulated": false,
			  },
			  "enumeration": {
			    "diagrams": [
			      "general",
			      "packages",
			    ],
			    "evaluated": "-",
			    "simulated": false,
			  },
			  "flow": {
			    "diagrams": [
			      "interconnection",
			    ],
			    "evaluated": "-",
			    "simulated": false,
			  },
			  "import": {
			    "diagrams": [],
			    "evaluated": "-",
			    "simulated": false,
			  },
			  "inheritance (inherited feature)": {
			    "diagrams": [
			      "general",
			      "interconnection",
			    ],
			    "evaluated": "-",
			    "simulated": false,
			  },
			  "interface": {
			    "diagrams": [
			      "interconnection",
			    ],
			    "evaluated": "-",
			    "simulated": false,
			  },
			  "metadata (@)": {
			    "diagrams": [],
			    "evaluated": "-",
			    "simulated": false,
			  },
			  "multiplicity [4]": {
			    "diagrams": [
			      "general",
			      "interconnection",
			    ],
			    "evaluated": "-",
			    "simulated": false,
			  },
			  "nested part": {
			    "diagrams": [
			      "general",
			      "interconnection",
			    ],
			    "evaluated": "-",
			    "simulated": false,
			  },
			  "optional [0..1]": {
			    "diagrams": [
			      "general",
			      "interconnection",
			    ],
			    "evaluated": "-",
			    "simulated": false,
			  },
			  "package": {
			    "diagrams": [
			      "packages",
			    ],
			    "evaluated": "-",
			    "simulated": false,
			  },
			  "part definition": {
			    "diagrams": [
			      "general",
			      "interconnection",
			      "packages",
			    ],
			    "evaluated": "-",
			    "simulated": false,
			  },
			  "part usage": {
			    "diagrams": [
			      "general",
			      "requirements",
			      "trace",
			    ],
			    "evaluated": "-",
			    "simulated": false,
			  },
			  "port (and ~conjugate)": {
			    "diagrams": [
			      "general",
			      "interconnection",
			    ],
			    "evaluated": "-",
			    "simulated": false,
			  },
			  "qualified name reference": {
			    "diagrams": [],
			    "evaluated": "-",
			    "simulated": false,
			  },
			  "redefinition (:>>)": {
			    "diagrams": [],
			    "evaluated": "number",
			    "simulated": false,
			  },
			  "requirement": {
			    "diagrams": [
			      "requirements",
			      "trace",
			    ],
			    "evaluated": "-",
			    "simulated": false,
			  },
			  "satisfy": {
			    "diagrams": [
			      "requirements",
			      "trace",
			    ],
			    "evaluated": "satisfied",
			    "simulated": false,
			  },
			  "specialization (:>)": {
			    "diagrams": [
			      "general",
			    ],
			    "evaluated": "-",
			    "simulated": false,
			  },
			  "state": {
			    "diagrams": [
			      "states",
			    ],
			    "evaluated": "-",
			    "simulated": true,
			  },
			  "transition": {
			    "diagrams": [
			      "states",
			    ],
			    "evaluated": "-",
			    "simulated": true,
			  },
			}
		`);
	});
});
