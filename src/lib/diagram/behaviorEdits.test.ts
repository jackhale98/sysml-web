/**
 * The SysML that drawing on state and action diagrams writes, checked the
 * way the app uses it: each plan's patch is applied, the result analysed
 * by the toolkit (no problems), drawn (the edges the canvas would show)
 * and, for state machines, run in the emulator.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import { loadHost } from '#lib/engine/toolkit/testing.ts';
import type { DiagramGraph, StateMachine } from '#lib/engine/types.ts';
import { buildTree, collectElements, type ModelElement } from '#lib/project/elements.ts';
import { start, step } from '#lib/sim/emulator.ts';
import {
	branchGuard,
	effectClause,
	effectDisplay,
	planAddFlowNode,
	planAddState,
	planAddValue,
	planEditBranch,
	planEditTransition,
	planRemoveEdge,
	planRemoveNode,
	planSetStart,
	planStateAction,
	planSuccession,
	planTransition,
	readTransition,
	referenceWithin,
	signalName,
	specOf,
	startOf,
	stateActions,
	type TransitionSpec
} from './behaviorEdits.ts';
import { ownersOf } from './model.ts';
import type { ModelContext, Plan } from './relationships.ts';

let host: ToolkitHost;
beforeAll(async () => {
	host = await loadHost();
}, 60_000);

const PATH = 'model/Home.sysml';

/** A project of one file, analysed: its context, problems, machines and diagrams. */
class Project {
	text: string;
	ctx!: ModelContext;
	constructor(text: string) {
		this.text = text;
		this.analyse();
	}
	private analyse() {
		const files = [{ path: PATH, text: this.text }];
		const analyses = host.analyzeProject(files);
		const elements = collectElements(analyses);
		this.ctx = {
			elements,
			owners: ownersOf(buildTree(elements)),
			textOf: (path) => (path === PATH ? this.text : undefined),
			analyses
		};
	}
	get problems(): string[] {
		return this.ctx.analyses.flatMap((a) =>
			[...a.model.syntax_errors, ...a.diagnostics].map((d) => d.message)
		);
	}
	/** Apply a plan as the workbench does, and check the text still has no problems. */
	apply(plan: Plan | string): this {
		if (typeof plan === 'string') throw new Error(plan);
		expect(plan.steps).toHaveLength(1);
		const step = plan.steps[0]!;
		if (step.kind !== 'patch') throw new Error(`unexpected ${step.kind}`);
		expect(step.before).toBe(this.text);
		this.text = step.after;
		this.analyse();
		expect(this.problems, this.text).toEqual([]);
		return this;
	}
	el(name: string, parent?: string): ModelElement {
		const found = this.ctx.elements.find(
			(e) => e.label === name && (!parent || this.ctx.owners.get(e.key)?.label === parent)
		);
		if (!found) throw new Error(`no ${name} in\n${this.text}`);
		return found;
	}
	machine(name: string): StateMachine {
		const m = host.stateMachines([{ path: PATH, text: this.text }]).find((x) => x.name === name);
		if (!m) throw new Error(`no machine ${name}`);
		return m;
	}
	diagram(view: 'states' | 'actions', scope: string): DiagramGraph {
		return host.diagram(view, [{ path: PATH, text: this.text }], scope);
	}
	edges(view: 'states' | 'actions', scope: string): string[] {
		return this.diagram(view, scope)
			.edges.filter((e) => e.kind !== 'containment')
			.map((e) => `${e.source} -> ${e.target}${e.label ? ` ${e.label}` : ''}`);
	}
	/** The source of the edge drawn from `source` to `target`. */
	edge(view: 'states' | 'actions', scope: string, source: string, target: string) {
		const e = this.diagram(view, scope).edges.find(
			(x) => x.source === source && x.target === target
		);
		if (!e?.element) throw new Error(`no edge ${source} -> ${target}`);
		return e.element;
	}
}

const starter = (body = '') => `package Home {
    private import ScalarValues::*;

    part def Lamp;
${body}}
`;

const signal = (name: string): TransitionSpec['trigger'] => ({ kind: 'signal', signal: name });
const spec = (trigger: TransitionSpec['trigger'], guard = '', effect = ''): TransitionSpec => ({
	trigger,
	guard,
	effect
});

describe('state machines, drawn', () => {
	it('builds a machine state by state and transition by transition, and runs it', () => {
		const p = new Project(starter('    state def Lights {\n    }\n'));
		const lights = () => p.el('Lights');

		p.apply(planAddValue(lights(), 'presses', 'Integer', '0', p.ctx));
		p.apply(planAddState(lights(), 'off', true, p.ctx));
		p.apply(planAddState(lights(), 'on', false, p.ctx));
		p.apply(planAddState(lights(), 'broken', false, p.ctx));
		expect(startOf(lights(), p.ctx)).toBe('off');

		// A signal the model doesn't have yet is declared in the machine's package.
		p.apply(planTransition(p.el('off'), p.el('on'), spec(signal('switch on')), p.ctx));
		p.apply(planTransition(p.el('on'), p.el('off'), spec(signal('SwitchOff')), p.ctx));
		p.apply(
			planTransition(
				p.el('on'),
				p.el('broken'),
				spec({ kind: 'change', condition: 'presses > 2' }, '', 'callTechnician'),
				p.ctx
			)
		);
		p.apply(planStateAction(p.el('on'), 'entry', 'presses := presses + 1', p.ctx));
		p.apply(planStateAction(p.el('broken'), 'do', 'blink', p.ctx));

		expect(p.text).toBe(
			starter(`    state def Lights {
        attribute presses : Integer = 0;
        entry; then off;
        state off;
        state on {
            entry assign presses := presses + 1;
        }
        state broken {
            do action blink;
        }
        transition off_to_on first off accept SwitchOn then on;
        transition on_to_off first on accept SwitchOff then off;
        transition on_to_broken first on accept when presses > 2 do action callTechnician then broken;
    }
    item def SwitchOn;
    item def SwitchOff;
`)
		);
		expect(p.edges('states', 'Lights')).toEqual([
			'__initial__ -> off',
			'off -> on SwitchOn',
			'on -> off SwitchOff',
			'on -> broken when presses > 2 / callTechnician'
		]);

		const machine = p.machine('Lights');
		let session = start(machine);
		expect(session.current).toEqual(['off']);
		session = step(machine, session, { event: 'SwitchOn' });
		expect(session.current).toEqual(['on']);
		expect(session.variables.presses).toBe(1);
		session = step(machine, session, { event: 'SwitchOff' });
		session = step(machine, session, { event: 'SwitchOn' });
		session = step(machine, session, { event: 'SwitchOff' });
		session = step(machine, session, { event: 'SwitchOn' });
		expect(session.variables.presses).toBe(3);
		// The change trigger fires on its own once its condition holds.
		session = step(machine, session, { event: null });
		expect(session.current).toEqual(['broken']);
	});

	it('edits a transition: trigger, guard and effect, keeping its name and ends', () => {
		const p = new Project(
			starter(`    item def Go;
    state def M {
        attribute ready : Boolean = true;
        entry; then a;
        state a;
        state b;
        accept Go then a;
        transition a_to_b first a accept Go then b;
    }
`)
		);
		const at = p.edge('states', 'M', 'a', 'b');
		expect(readTransition(at, p.ctx)?.spec).toEqual(spec(signal('Go')));
		p.apply(
			planEditTransition(
				at,
				p.el('a'),
				spec(signal('Go'), 'ready', 'ready := false; ready := true'),
				'a_to_b',
				p.ctx
			)
		);
		expect(p.text).toContain(
			'transition a_to_b first a accept Go if ready do action { assign ready := false; assign ready := true; } then b;'
		);
		expect(specOf('transition t first a accept after 5 [SI::s] then b;').trigger).toEqual({
			kind: 'after',
			seconds: '5'
		});

		// The shorthand form is written out in full, from the state it follows.
		const back = new Project(
			p.text.replace('do action { assign ready := false; assign ready := true; } ', '')
		);
		const short = back.edge('states', 'M', 'b', 'a');
		back.apply(
			planEditTransition(
				short,
				back.el('b'),
				spec({ kind: 'after', seconds: '5' }, 'ready'),
				null,
				back.ctx
			)
		);
		expect(back.text).toContain('transition first b accept after 5 [SI::s] if ready then a;');
		const machine = back.machine('M');
		expect(machine.transitions.find((t) => t.from === 'b')).toMatchObject({
			to: 'a',
			trigger: 'after 5 [SI::s]',
			guard: 'ready'
		});
	});

	it('changes and removes where a machine starts, and removes transitions and states', () => {
		const p = new Project(
			starter(`    item def Go;
    state def M {
        entry; then a;
        state a;
        state b;
        transition a_to_b first a accept Go then b;
        transition b_to_a first b accept Go then a;
    }
`)
		);
		p.apply(planSetStart(p.el('b'), p.ctx));
		expect(startOf(p.el('M'), p.ctx)).toBe('b');
		expect(start(p.machine('M')).current).toEqual(['b']);

		p.apply(planRemoveEdge(p.edge('states', 'M', 'a', 'b'), 'Removed', p.ctx));
		expect(p.text).not.toContain('a_to_b');
		const incident = p
			.diagram('states', 'M')
			.edges.filter((e) => e.source === 'a' || e.target === 'a')
			.flatMap((e) => (e.element ? [e.element] : []));
		p.apply(planRemoveNode(p.el('a'), incident, p.ctx));
		expect(p.text).toContain(`    state def M {
        entry; then b;
        state b;
    }`);
		p.apply(planRemoveEdge(p.edge('states', 'M', '__initial__', 'b'), 'Removed', p.ctx));
		expect(p.text).toContain(`    state def M {
        state b;
    }`);
	});

	it('nests states, and writes transitions in the region of their source', () => {
		const p = new Project(
			starter(`    item def Go;
    item def Stop;
    state def M {
        entry; then off;
        state off;
        state on;
    }
`)
		);
		p.apply(planAddState(p.el('on'), 'idle', true, p.ctx));
		p.apply(planAddState(p.el('on'), 'busy', false, p.ctx));
		expect(referenceWithin(p.el('busy'), p.el('M'), p.ctx)).toBe('on.busy');
		p.apply(planTransition(p.el('off'), p.el('busy'), spec(signal('Go')), p.ctx));
		p.apply(planTransition(p.el('idle'), p.el('off'), spec(signal('Stop')), p.ctx));
		p.apply(planTransition(p.el('idle'), p.el('busy'), spec(signal('Go')), p.ctx));
		expect(p.text).toContain(`        state on {
            entry; then idle;
            state idle;
            state busy;
            transition idle_to_off first idle accept Stop then off;
            transition idle_to_busy first idle accept Go then busy;
        }
        transition off_to_busy first off accept Go then on.busy;`);
		expect(p.edges('states', 'M')).toEqual(
			expect.arrayContaining(['off -> on.busy Go', 'on.idle -> off Stop', 'on.idle -> on.busy Go'])
		);
		const machine = p.machine('M');
		let session = start(machine);
		session = step(machine, session, { event: 'Go' });
		expect(session.current).toEqual(['on.busy']);
	});

	it('adds, changes and removes what a state does', () => {
		const p = new Project(
			starter(`    state def M {
        entry; then a;
        state a { doc /* The first. */ }
        state b {
            doc /* The second. */
            state inner;
        }
    }
`)
		);
		p.apply(planStateAction(p.el('a'), 'exit', 'wave', p.ctx));
		p.apply(planStateAction(p.el('a'), 'entry', 'greet', p.ctx));
		expect(p.text).toContain(
			'state a { doc /* The first. */ entry action greet; exit action wave; }'
		);
		p.apply(planStateAction(p.el('b'), 'do', 'hum', p.ctx));
		expect(p.text).toContain(`            doc /* The second. */
            do action hum;
            state inner;`);
		expect(stateActions(p.el('a'), p.ctx)).toEqual({ entry: 'greet', do: '', exit: 'wave' });
		p.apply(planStateAction(p.el('a'), 'entry', 'smile', p.ctx));
		p.apply(planStateAction(p.el('a'), 'exit', '', p.ctx));
		expect(p.text).toContain('state a { doc /* The first. */ entry action smile; }');
		const machine = p.machine('M');
		expect(machine.states.find((s) => s.name === 'a')).toMatchObject({ entry: 'smile' });
		expect(machine.states.find((s) => s.name === 'b')).toMatchObject({ do: 'hum' });
	});

	it('writes seconds the short way where SI is imported', () => {
		const p = new Project(
			starter(
				'    state def T {\n        entry; then a;\n        state a;\n        state b;\n    }\n'
			).replace(
				'private import ScalarValues::*;',
				'private import ScalarValues::*;\n    private import SI::*;'
			)
		);
		p.apply(planTransition(p.el('a'), p.el('b'), spec({ kind: 'after', seconds: '5' }), p.ctx));
		expect(p.text).toContain('transition a_to_b first a accept after 5 [s] then b;');
		expect(p.machine('T').transitions.at(-1)).toMatchObject({ trigger: 'after 5 [s]' });
		const machine = p.machine('T');
		const session = step(machine, start(machine), { event: null });
		expect(session.current).toEqual(['b']);
	});

	it('refuses what it cannot write', () => {
		const p = new Project(starter('    state def M {\n        state a;\n    }\n'));
		expect(planAddState(p.el('M'), 'a', false, p.ctx)).toBe('M already has a.');
		expect(planAddState(p.el('M'), ' ', false, p.ctx)).toMatch(/name/);
		expect(
			planTransition(p.el('a'), p.el('a'), spec({ kind: 'change', condition: 'x >' }), p.ctx)
		).toMatch(/not an expression/);
		expect(
			planTransition(p.el('a'), p.el('a'), spec({ kind: 'after', seconds: 'soon' }), p.ctx)
		).toMatch(/seconds/);
		expect(planStateAction(p.el('a'), 'do', '', p.ctx)).toMatch(/does nothing/);
	});
});

describe('words for the forms', () => {
	it('turns what people type into names and actions', () => {
		expect(signalName('switch on')).toBe('SwitchOn');
		expect(signalName('TakeOff')).toBe('TakeOff');
		expect(effectClause('turn on lamp')).toBe('action turnOnLamp');
		expect(effectClause('count := count + 1')).toBe('assign count := count + 1');
		expect(effectClause('a := 1; b := 2')).toBe('action { assign a := 1; assign b := 2; }');
		expect(effectClause('')).toBe('');
		expect(effectClause('x := (')).toMatchObject({ error: expect.stringMatching(/expression/) });
		expect(effectDisplay('action { assign a := 1; assign b := 2; }')).toBe('a := 1; b := 2');
		expect(effectDisplay('assign a := 1')).toBe('a := 1');
		expect(effectDisplay('action greet')).toBe('greet');
		expect(effectDisplay('send Ping() to p')).toBe('send Ping() to p');
	});
});

describe('action flows, drawn', () => {
	it('builds a flow with a decision, a merge, a fork and a join', () => {
		const p = new Project(
			starter('    action def MakeTea {\n        in attribute hot : Boolean;\n    }\n')
		);
		const tea = () => p.el('MakeTea');
		p.apply(planAddFlowNode(tea(), 'action', 'boil', true, p.ctx));
		p.apply(planAddFlowNode(tea(), 'decide', 'isHot', false, p.ctx));
		p.apply(planAddFlowNode(tea(), 'action', 'pour', false, p.ctx));
		p.apply(planAddFlowNode(tea(), 'action', 'wait', false, p.ctx));
		p.apply(planAddFlowNode(tea(), 'merge', 'ready', false, p.ctx));
		p.apply(planSuccession(p.el('boil'), p.el('isHot'), null, p.ctx));
		p.apply(planSuccession(p.el('isHot'), p.el('pour'), 'hot', p.ctx));
		p.apply(planSuccession(p.el('isHot'), p.el('wait'), '', p.ctx));
		p.apply(planSuccession(p.el('pour'), p.el('ready'), null, p.ctx));
		p.apply(planSuccession(p.el('wait'), p.el('ready'), null, p.ctx));
		p.apply(planSuccession(p.el('ready'), 'done', null, p.ctx));
		expect(planSuccession(p.el('isHot'), p.el('boil'), '', p.ctx)).toMatch(/otherwise/);
		// A guarded branch goes before the "otherwise" one.
		p.apply(planSuccession(p.el('isHot'), p.el('boil'), 'not hot and false', p.ctx));
		expect(p.text).toBe(
			starter(`    action def MakeTea {
        in attribute hot : Boolean;
        action boil;
        decide isHot;
            if hot then pour;
            if not hot and false then boil;
            else wait;
        action pour;
        action wait;
        merge ready;
        first start then boil;
        first boil then isHot;
        first pour then ready;
        first wait then ready;
        first ready then done;
    }
`)
		);
		expect(p.edges('actions', 'MakeTea')).toEqual(
			expect.arrayContaining([
				'__initial__ -> boil',
				'boil -> isHot',
				'isHot -> pour [hot]',
				'isHot -> wait [else]',
				'isHot -> boil [not hot and false]',
				'pour -> ready',
				'ready -> __final__'
			])
		);

		const branch = p.edge('actions', 'MakeTea', 'isHot', 'boil');
		expect(branchGuard(branch, p.ctx)).toBe('not hot and false');
		p.apply(planEditBranch(branch, 'not hot', p.ctx));
		expect(p.text).toContain('if not hot then boil;');
		p.apply(planRemoveEdge(p.edge('actions', 'MakeTea', 'isHot', 'boil'), 'Removed', p.ctx));
		expect(p.text).not.toContain('then boil;\n            else');

		// Deleting a node takes the lines to and from it.
		const incident = p
			.diagram('actions', 'MakeTea')
			.edges.filter((e) => e.source === 'isHot' || e.target === 'isHot')
			.flatMap((e) => (e.element ? [e.element] : []));
		p.apply(planRemoveNode(p.el('isHot'), incident, p.ctx));
		expect(p.text).not.toMatch(/isHot|if hot|else wait/);

		p.apply(planAddFlowNode(tea(), 'fork', 'split', false, p.ctx));
		p.apply(planAddFlowNode(tea(), 'join', 'together', false, p.ctx));
		p.apply(planSuccession(p.el('boil'), p.el('split'), null, p.ctx));
		p.apply(planSuccession(p.el('split'), p.el('pour'), null, p.ctx));
		p.apply(planSuccession(p.el('split'), p.el('wait'), null, p.ctx));
		p.apply(planSuccession(p.el('pour'), p.el('together'), null, p.ctx));
		expect(p.diagram('actions', 'MakeTea').nodes.map((n) => `${n.id}:${n.kind}`)).toEqual(
			expect.arrayContaining(['split:fork', 'together:join'])
		);
		expect(planSuccession(p.el('split'), p.el('pour'), null, p.ctx)).toMatch(/already/);
	});

	it('removes a succession written as a chain, keeping its steps', () => {
		const p = new Project(
			starter(`    action def Chain {
        first start;
        then action a;
        then action b { doc /* B. */ }
        then done;
    }
`)
		);
		p.apply(planRemoveEdge(p.edge('actions', 'Chain', 'a', 'b'), 'Removed', p.ctx));
		expect(p.text).toContain(
			'        then action a;\n        action b { doc /* B. */ }\n        then done;'
		);
		// `then done` now follows b, which still ends the flow.
		expect(p.edges('actions', 'Chain')).toEqual(['__initial__ -> a', 'b -> __final__']);
		const incident = p
			.diagram('actions', 'Chain')
			.edges.filter((e) => e.source === 'a' || e.target === 'a')
			.flatMap((e) => (e.element ? [e.element] : []));
		p.apply(planRemoveNode(p.el('a'), incident, p.ctx));
		expect(p.text).toContain(
			'        first start;\n        action b { doc /* B. */ }\n        then done;'
		);
	});
});
