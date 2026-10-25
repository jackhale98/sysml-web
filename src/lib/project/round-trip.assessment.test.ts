/**
 * Assessment (§2 round-trip fidelity): every kind of model edit the app
 * makes — inspector and explorer actions, table cells, diagram drawing and
 * deleting, behaviour drawing, view edits, guided forms, Duplicate, the
 * formatter, file operations — applied the way the app applies it (the
 * real engine behind a `Workspace`, one undoable step) to a fixture full of
 * comments, odd formatting, metadata and constructs no editor shows
 * (`fixtures/round-trip/`). For each edit:
 *
 * - every comment marker (`KEEP-nn`) is still there, byte for byte, unless
 *   the case says the edit removes the statement it sits on;
 * - files the edit is not about are byte-identical;
 * - the semantic diff (`#lib/review/semantic.ts`) names only the elements
 *   the edit is about (`touches`), and no new problems appear unless the
 *   case expects them (`breaks`);
 * - the changed lines and the semantic diff are pinned in the snapshot,
 *   so any other change to the text shows up;
 * - one undo puts every file back byte for byte.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { analysed, openWorkspace, problemsOf } from '#lib/create/testing.ts';
import { write } from '#lib/create/apply.ts';
import { planLimit } from '#lib/create/plans.ts';
import { limitStatement, limitTitle } from '#lib/create/limit.ts';
import {
	planAddFlowNode,
	planAddState,
	planEditTransition,
	planRemoveEdge,
	planRemoveNode,
	planSetStart,
	planStateAction,
	planSuccession,
	planTransition,
	type EdgeSource
} from '#lib/diagram/behaviorEdits.ts';
import { modelContext } from '#lib/diagram/modelContext.ts';
import {
	planEdgeRemoval,
	planRelation,
	type Plan,
	type RelationKind
} from '#lib/diagram/relationships.ts';
import { planExpose, planViewAs } from '#lib/diagram/viewEdits.ts';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import { loadHost } from '#lib/engine/toolkit/testing.ts';
import type { DeclarationSet } from '#lib/engine/types.ts';
import type { ModelDiff } from '#lib/review/types.ts';
import {
	addElement,
	applySteps,
	deleteElement,
	duplicateElement,
	renameElement,
	setField,
	type WriteStep
} from '#lib/workbench/actions.ts';
import type { ModelElement } from './elements.ts';
import { applyChanges, type ProjectFile, type Workspace } from './workspace.svelte.ts';

/**
 * A known gap: expected to fail until it is fixed (then it fails here, to
 * be turned into a plain test). ASSESS_SHOW_GAPS=1 runs it as a plain test,
 * to see why it fails.
 */
const gap = process.env.ASSESS_SHOW_GAPS ? it : it.fails;

const DIR = join(import.meta.dirname, 'fixtures/round-trip');
const H = 'model/Hostile.sysml';
const U = 'model/Uses.sysml';
const V = 'views/HostileViews.sysml';
const read = (name: string) => readFileSync(join(DIR, name), 'utf8');
const FILES: Record<string, string> = {
	[H]: read('Hostile.sysml'),
	[U]: read('Uses.sysml'),
	[V]: read('HostileViews.sysml')
};

let host: ToolkitHost;
beforeAll(async () => {
	host = await loadHost();
}, 60_000);

const list = (files: Record<string, string>): ProjectFile[] =>
	Object.entries(files).map(([path, text]) => ({ path, text }));

/**
 * The comments with a marker, by marker: from the comment's `//` or `/*`
 * (or `doc /*`) to the end of its line, as written.
 */
function markers(files: Record<string, string>): Map<string, string> {
	const out = new Map<string, string>();
	for (const text of Object.values(files))
		for (const line of text.split(/\r?\n/)) {
			const m = /KEEP-\d+/.exec(line);
			if (!m) continue;
			const before = line.slice(0, m.index);
			const start = Math.max(before.lastIndexOf('//'), before.lastIndexOf('/*'));
			out.set(m[0], line.slice(start).trimEnd());
		}
	return out;
}

/** A line diff (longest common subsequence): `-n text` / `+n text`, n the line in its version. */
export function lineDiff(before: string, after: string): string[] {
	const a = before.split('\n');
	const b = after.split('\n');
	const n = a.length;
	const m = b.length;
	const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i--)
		for (let j = m - 1; j >= 0; j--)
			lcs[i]![j] =
				a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
	const out: string[] = [];
	let i = 0;
	let j = 0;
	while (i < n || j < m) {
		if (i < n && j < m && a[i] === b[j]) {
			i++;
			j++;
		} else if (j < m && (i === n || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) {
			out.push(`+${j + 1} ${b[j]}`);
			j++;
		} else {
			out.push(`-${i + 1} ${a[i]}`);
			i++;
		}
	}
	return out;
}

/** The semantic diff as lines people can read in a snapshot. */
export function semanticLines(diff: ModelDiff): string[] {
	const out: string[] = [];
	for (const e of diff.elements) {
		const name =
			e.change === 'renamed' || e.change === 'moved'
				? `${e.before?.qualifiedName} -> ${e.after?.qualifiedName}`
				: (e.after?.qualifiedName ?? e.before?.qualifiedName);
		const props = e.properties
			.map((p) => `${p.property}: ${p.before ?? '-'} -> ${p.after ?? '-'}`)
			.join('; ');
		out.push(
			`${e.change} ${e.kind}${e.isDefinition ? ' def' : ''} ${name}${props ? ` {${props}}` : ''}`
		);
	}
	for (const r of diff.relations) out.push(`${r.change} ${r.relation} ${r.text} (in ${r.owner})`);
	for (const v of diff.values) out.push(`value ${v.label}: ${v.before} -> ${v.after}`);
	return out.sort();
}

/** Qualified names a semantic diff touches (elements, and the owners of relations). */
function touched(diff: ModelDiff): string[] {
	const names = new Set<string>();
	for (const e of diff.elements) {
		if (e.before) names.add(e.before.qualifiedName);
		if (e.after) names.add(e.after.qualifiedName);
	}
	for (const r of diff.relations) names.add(`relation in ${r.owner ?? '(top)'}`);
	return [...names];
}

interface Tools {
	ws: Workspace;
	/** An element by label, optionally in a parent (its `parent` as written) or a file. */
	el(label: string, parent?: string, file?: string): ModelElement;
	/** Apply a diagram/inspector plan as the canvas does: one undoable step. */
	plan(plan: Plan | { label: string; steps: WriteStep[] } | string): Promise<string | null>;
}

interface Case {
	name: string;
	run(t: Tools): Promise<string | null>;
	/** Qualified names (prefixes) the semantic diff may name; `relation in X` for relations. */
	touches: string[];
	/** Comment markers the edit removes with the statement they are on. */
	drops?: string[];
	/** The edit leaves problems (pinned in the snapshot); `warns`: the toast says what no longer resolves. */
	breaks?: boolean;
	warns?: boolean;
	/** The semantic diff does not report what this edit changes (see "the semantic diff" below). */
	unseen?: boolean;
}

/** Run a case on a fresh workspace and check it (see the module comment). */
async function check(c: Case, files: Record<string, string> = FILES) {
	const ws = await openWorkspace(host, list(files));
	const baseline = problemsOf(ws);
	expect(baseline, 'the fixture has no problems').toEqual([]);
	const tools: Tools = {
		ws,
		el(label, parent, file) {
			const found = ws.elements.filter(
				(e) =>
					e.label === label &&
					e.kind !== 'subject' &&
					(parent === undefined || e.parent === parent) &&
					(file === undefined || e.file === file)
			);
			if (found.length !== 1) throw new Error(`${found.length} elements named ${label}`);
			return found[0]!;
		},
		async plan(p) {
			if (typeof p === 'string') return p;
			return applySteps(ws, p.label, p.steps);
		}
	};
	const error = await analysed(ws, () => c.run(tools));
	expect(error, c.name).toBeNull();
	expect(ws.undoStack, 'one undoable step').toHaveLength(1);
	const after = { ...ws.files };

	// Every comment, as written.
	const kept = markers(after);
	for (const [marker, comment] of markers(files)) {
		if (c.drops?.includes(marker)) continue;
		expect(kept.get(marker), `${marker} is kept as written`).toBe(comment);
	}

	// Only the elements the edit is about.
	const diff = host.compareModels(list(files), list(after)).diff;
	for (const name of touched(diff))
		expect(
			c.touches.some(
				(t) =>
					name === t ||
					name.startsWith(t.endsWith('::') ? t : `${t}::`) ||
					(t === 'relation in' && name.startsWith('relation in '))
			),
			`${name} changed (${c.name})`
		).toBe(true);
	const seen = diff.elements.length + diff.relations.length;
	if (c.unseen) expect(seen, 'the semantic diff does not see this edit').toBe(0);
	else expect(seen, 'the edit changed the model').toBeGreaterThan(0);

	// No new problems, unless the edit says what it broke.
	const problems = problemsOf(ws);
	if (!c.breaks) expect(problems, 'no new problems').toEqual([]);
	else expect(problems.length).toBeGreaterThan(0);
	if (c.warns) expect(ws.warnings.join(' ')).toMatch(/no longer resolve/);

	expect({
		lines: Object.fromEntries(
			Object.keys({ ...files, ...after })
				.filter((p) => files[p] !== after[p])
				.map((p) => [p, lineDiff(files[p] ?? '', after[p] ?? '')])
		),
		semantic: semanticLines(diff),
		problems
	}).toMatchSnapshot();

	// One undo restores every file exactly.
	ws.undo();
	expect(ws.files).toEqual(files);
	return { ws, after, diff };
}

/** The edge of a transition or succession, as the diagram hands it to the planners. */
const edge = (e: ModelElement): EdgeSource => ({
	file: e.file,
	start_byte: e.span.start_byte,
	end_byte: e.span.end_byte
});

/** The inspector's property form: one `setDeclaration`, units imported with it. */
async function inspector(t: Tools, element: ModelElement, set: DeclarationSet) {
	const source = t.ws.text(element.file)!;
	return t.ws.transact('Set a property', async () => {
		const error = await t.ws.edit(element.file, {
			op: 'setDeclaration',
			path: element.file,
			source,
			element: element.name,
			line: element.span.start_row,
			...(element.id ? { id: element.id } : {}),
			set
		});
		if (!error && set.value?.includes('[')) await t.ws.importUnits(element.file, source);
		return error;
	});
}

const relation = (kind: RelationKind, from: ModelElement, to: ModelElement) => ({
	kind,
	label: kind,
	from,
	to
});

const CASES: Case[] = [
	// ---- Explorer and inspector actions (workbench/actions.ts) ----
	{
		name: 'add a part to a definition',
		run: (t) => addElement(t.ws, t.el('Vehicle'), 'part', 'spare', 'Base'),
		touches: ['Hostile::Vehicle::spare']
	},
	{
		name: 'add an attribute to a body that ends in blank lines and a comment',
		run: (t) => addElement(t.ws, t.el('Engine'), 'attribute', 'torque', 'Real'),
		touches: ['Hostile::Engine::torque']
	},
	{
		name: 'add a port to a one-line body',
		run: (t) => addElement(t.ws, t.el('Tank'), 'port', 'vent', 'FuelPort'),
		touches: ['Hostile::Tank::vent']
	},
	{
		name: 'add a definition to a package with a trailing comment after it',
		run: (t) => addElement(t.ws, t.el('Hostile'), 'part def', 'Trailer'),
		touches: ['Hostile::Trailer']
	},
	{
		name: 'rename a definition used across files, by an alias, a comment and a dependency',
		run: (t) => renameElement(t.ws, t.el('Engine'), 'PowerUnit'),
		// Relations that refer to it are written with the new name: allowed in any owner.
		touches: ['Hostile::Engine', 'Hostile::PowerUnit', 'relation in']
	},
	{
		name: 'rename a requirement satisfied and verified elsewhere',
		run: (t) => renameElement(t.ws, t.el('Mass limit'), 'Mass cap'),
		touches: ["Hostile::'Mass limit'", "Hostile::'Mass cap'", 'relation in']
	},
	{
		name: 'rename an attribute redefined in another file',
		run: (t) => renameElement(t.ws, t.el('rpmLimit', 'Vehicle'), 'maxRpm'),
		touches: ['Hostile::Vehicle::rpmLimit', 'Hostile::Vehicle::maxRpm', 'Uses::fleet']
	},
	{
		name: 'rename a compact one-line definition',
		run: (t) => renameElement(t.ws, t.el('Tank'), 'Reservoir'),
		touches: ['Hostile::Tank', 'Hostile::Reservoir', 'relation in']
	},
	{
		name: 'delete an attribute nothing refers to',
		run: (t) => deleteElement(t.ws, t.el('rpm')),
		touches: ['Hostile::Engine::rpm']
	},
	{
		name: 'delete a definition something refers to (with a warning)',
		run: (t) => deleteElement(t.ws, t.el('Gearbox')),
		touches: ['Hostile::Gearbox', 'Hostile::Vehicle::gearbox'],
		breaks: true,
		warns: true
	},
	{
		name: 'delete a definition with a textual representation in it',
		run: (t) => deleteElement(t.ws, t.el('Annotated')),
		touches: ['Hostile::Annotated'],
		drops: ['KEEP-13']
	},
	{
		name: 'duplicate a definition with metadata, comments and blank lines',
		run: async (t) => (await duplicateElement(t.ws, t.el('Engine'))).error,
		touches: ['Hostile::Engine2']
	},
	{
		name: 'duplicate a compact definition with a comment after it on its line',
		run: async (t) => (await duplicateElement(t.ws, t.el('Tank'))).error,
		touches: ['Hostile::Tank2']
	},
	{
		name: 'duplicate a usage with a body',
		run: async (t) => (await duplicateElement(t.ws, t.el('car'))).error,
		touches: ['Hostile::car2']
	},

	// ---- Inspector properties (setDeclaration) ----
	{
		name: 'make an oddly spaced definition abstract',
		run: (t) => inspector(t, t.el('Engine'), { abstract: true }),
		touches: ['Hostile::Engine']
	},
	{
		name: 'remove an oddly spaced specialization',
		run: (t) => inspector(t, t.el('Engine'), { specializes: [] }),
		// Engine's `:>> mass` no longer has Base's mass to redefine; nothing reports it (see
		// "a redefinition left without its feature" below).
		touches: ['Hostile::Engine']
	},
	{
		name: 'give a definition a short name, beside a trailing comment',
		run: (t) => inspector(t, t.el('Engine'), { shortName: 'E1' }),
		touches: ['Hostile::Engine']
	},
	{
		name: 'give a definition a doc comment',
		run: (t) => inspector(t, t.el('Engine'), { doc: 'The engine.' }),
		touches: ['Hostile::Engine']
	},
	{
		name: 'give a compact definition a doc comment',
		run: (t) => inspector(t, t.el('Tank'), { doc: 'The tank.' }),
		touches: ['Hostile::Tank']
	},
	{
		name: 'change a doc comment that has tabs and unicode',
		run: (t) => inspector(t, t.el('Hostile'), { doc: 'Replaced µ doc.' }),
		touches: ['Hostile'],
		drops: ['KEEP-03']
	},
	{
		name: 'change a multiplicity written before ordered nonunique',
		run: (t) => inspector(t, t.el('wheels'), { multiplicity: '6' }),
		touches: ['Hostile::Vehicle::wheels']
	},
	{
		name: 'remove a multiplicity',
		run: (t) => inspector(t, t.el('gearbox'), { multiplicity: null }),
		touches: ['Hostile::Vehicle::gearbox']
	},
	{
		name: 'change a value',
		run: (t) => inspector(t, t.el('rpm'), { value: '3500.0' }),
		touches: ['Hostile::Engine::rpm']
	},
	{
		name: 'change a value to a default',
		run: (t) => inspector(t, t.el('rpm'), { valueKind: 'default' }),
		touches: ['Hostile::Engine::rpm'],
		unseen: true
	},
	{
		name: 'change a type',
		run: (t) => inspector(t, t.el('rpm'), { type: 'Integer' }),
		touches: ['Hostile::Engine::rpm']
	},
	{
		name: 'change a value in a compact body',
		run: (t) => inspector(t, t.el('mass', 'Tank'), { value: '45 [kg]' }),
		touches: ['Hostile::Tank::mass']
	},
	{
		name: 'un-conjugate a port',
		run: (t) => inspector(t, t.el('fuelIn'), { conjugated: false }),
		touches: ['Hostile::Engine::fuelIn']
	},
	{
		name: 'change a direction',
		run: (t) => inspector(t, t.el('fuel'), { direction: 'in' }),
		touches: ['Hostile::FuelPort::fuel']
	},
	{
		name: 'make a value derived',
		run: (t) => inspector(t, t.el('totalMass', 'Vehicle'), { derived: true }),
		touches: ['Hostile::Vehicle::totalMass'],
		unseen: true
	},
	{
		name: 'change a redefinition’s value in another file',
		run: (t) => inspector(t, t.el('rpmLimit', 'fleet'), { value: '7500.0' }),
		touches: ['Uses::fleet::rpmLimit']
	},
	{
		name: 'give a value with a unit its file does not import (imports SI with it)',
		run: (t) => inspector(t, t.el('payload'), { value: '500 [kg]' }),
		touches: ['Uses::fleet::payload', 'Uses']
	},

	// ---- Table cells (setField) ----
	{
		name: 'change a metadata field in a table cell',
		run: (t) =>
			setField(t.ws, srcOf(t.el('Engine')), 'metadata:Review.reviewer', 'B. Someone', 'Set'),
		touches: ['Hostile::Engine']
	},
	{
		name: 'change a requirement’s id in a table cell',
		run: (t) => setField(t.ws, srcOf(t.el('Mass limit')), 'shortName', 'R-2', 'Set'),
		touches: ["Hostile::'Mass limit'"]
	},
	{
		name: 'change a requirement’s statement in a table cell',
		run: (t) => setField(t.ws, srcOf(t.el('Mass limit')), 'doc', 'At most 2.5 t.', 'Set'),
		touches: ["Hostile::'Mass limit'"],
		drops: ['KEEP-12']
	},
	{
		name: 'change an enum value in a table cell',
		run: (t) => setField(t.ws, srcOf(t.el('car')), 'feature:colour', 'green', 'Set'),
		touches: ['Hostile::car']
	},

	// ---- Diagram drawing (diagram/relationships.ts) ----
	{
		name: 'draw composition: a new part',
		run: (t) =>
			t.plan(
				planRelation(
					relation('compose', t.el('Vehicle'), t.el('Fuel')),
					{ name: 'reserve' },
					modelContext(t.ws)
				)
			),
		touches: ['Hostile::Vehicle::reserve']
	},
	{
		name: 'draw specialization on an individual definition',
		run: (t) =>
			t.plan(
				planRelation(relation('specialize', t.el('TestCar'), t.el('Base')), {}, modelContext(t.ws))
			),
		touches: ['Hostile::TestCar']
	},
	{
		name: 'draw a satisfy from a part in another file',
		run: (t) =>
			t.plan(
				planRelation(relation('satisfy', t.el('fleet'), t.el('Rev limit')), {}, modelContext(t.ws))
			),
		touches: ['relation in Hostile']
	},
	{
		name: 'draw a verify into a one-line objective',
		run: (t) =>
			t.plan(
				planRelation(
					relation('verify', t.el('MassCheck'), t.el('Rev limit')),
					{},
					modelContext(t.ws)
				)
			),
		touches: ['relation in MassCheck', 'relation in null', 'relation in (top)']
	},
	{
		name: 'draw an allocation',
		run: (t) =>
			t.plan(
				planRelation(relation('allocate', t.el('car'), t.el('fleet')), {}, modelContext(t.ws))
			),
		touches: ['relation in Uses']
	},
	{
		name: 'draw a connection between parts without ports',
		run: (t) =>
			t.plan(
				planRelation(relation('connect', t.el('wheels'), t.el('gearbox')), {}, modelContext(t.ws))
			),
		touches: ['relation in Vehicle']
	},
	{
		name: 'delete a connection line that has a comment after it',
		run: (t) =>
			t.plan(planEdgeRemoval('connection', null, t.el('tank'), t.el('engine'), modelContext(t.ws))),
		touches: ['relation in Vehicle'],
		drops: ['KEEP-09']
	},
	{
		name: 'delete a satisfy line',
		run: (t) =>
			t.plan(planEdgeRemoval('satisfy', null, t.el('car'), t.el('Mass limit'), modelContext(t.ws))),
		touches: ['relation in Hostile']
	},

	// ---- Behaviour drawing (diagram/behaviorEdits.ts) ----
	{
		name: 'add a state',
		run: (t) => t.plan(planAddState(t.el('Power'), 'standby', false, modelContext(t.ws))),
		touches: ['Hostile::Power::standby']
	},
	{
		name: 'draw a transition',
		run: (t) =>
			t.plan(
				planTransition(
					t.el('on'),
					t.el('off'),
					{ trigger: { kind: 'signal', signal: 'Go' }, guard: '', effect: '' },
					modelContext(t.ws)
				)
			),
		touches: ['Hostile::Power::on_to_off', 'Hostile::Power']
	},
	{
		name: 'change a transition’s trigger',
		run: (t) =>
			t.plan(
				planEditTransition(
					edge(t.el('off_on')),
					t.el('off'),
					{ trigger: { kind: 'after', seconds: '5' }, guard: '', effect: '' },
					'off_on',
					modelContext(t.ws)
				)
			),
		touches: ['Hostile::Power::off_on', 'Hostile::Power', 'Hostile']
	},
	{
		name: 'give a state an entry action',
		run: (t) => t.plan(planStateAction(t.el('on'), 'entry', 'greet', modelContext(t.ws))),
		touches: ['Hostile::Power::on']
	},
	{
		name: 'make another state the start',
		run: (t) => t.plan(planSetStart(t.el('on'), modelContext(t.ws))),
		touches: ['Hostile::Power', 'relation in Power']
	},
	{
		name: 'delete a transition',
		run: (t) => t.plan(planRemoveEdge(edge(t.el('off_on')), 'Deleted', modelContext(t.ws))),
		touches: ['Hostile::Power::off_on', 'Hostile::Power']
	},
	{
		name: 'delete a state and the transition to it',
		run: (t) => t.plan(planRemoveNode(t.el('on'), [edge(t.el('off_on'))], modelContext(t.ws))),
		touches: ['Hostile::Power::on', 'Hostile::Power::off_on', 'Hostile::Power']
	},
	{
		name: 'add a step to an action flow',
		run: (t) => t.plan(planAddFlowNode(t.el('Drive'), 'action', 'park', false, modelContext(t.ws))),
		touches: ['Hostile::Drive::park']
	},
	{
		name: 'draw a step to done',
		run: (t) => t.plan(planSuccession(t.el('cruise'), 'done', null, modelContext(t.ws))),
		touches: ['Hostile::Drive', 'relation in Drive']
	},

	// ---- View edits (diagram/viewEdits.ts) ----
	{
		name: 'add an element to a view (expose)',
		run: (t) => {
			const p = planExpose(t.el('vehicleParts'), [t.el('car')], modelContext(t.ws));
			return p ? applySteps(t.ws, 'Exposed', p.steps) : Promise.resolve('nothing to expose');
		},
		touches: ['HostileViews::vehicleParts'],
		unseen: true
	},
	{
		name: 'show a view as another kind',
		run: (t) => t.plan(planViewAs(t.el('vehicleParts'), 'InterconnectionView', modelContext(t.ws))),
		touches: ['HostileViews::vehicleParts']
	},

	// ---- Guided forms (create/) ----
	{
		name: 'new requirement from the limit form, in a package with comments',
		run: async (t) => {
			const limit = { kind: 'atMost' as const, value: 7000, unit: '' };
			const plan = planLimit(t.ws, {
				attribute: 'rpmLimit',
				limit,
				subject: { name: 'v', type: 'Vehicle', add: true },
				create: {
					id: 'R-9',
					title: limitTitle('rpmLimit', limit),
					statement: limitStatement('v', 'rpmLimit', limit),
					pkg: t.el('Hostile')
				}
			});
			return write(t.ws, plan.label, plan.write);
		},
		touches: ['Hostile::']
	}
];

/** How a table row addresses its element. */
function srcOf(e: ModelElement) {
	return { element: e.name, file: e.file, line: e.span.start_row, ...(e.id ? { id: e.id } : {}) };
}

describe('every kind of edit changes only what it is about', { timeout: 60_000 }, () => {
	it.each(CASES.map((c) => [c.name, c]))('%s', async (_, c) => {
		await check(c as Case);
	});
});

describe('the formatter', () => {
	const format = () => {
		const formatted: Record<string, string> = {};
		for (const [path, text] of Object.entries(FILES))
			formatted[path] = applyChanges(text, host.format(text).changes);
		return formatted;
	};

	it('keeps every comment, is idempotent, and its changes are pinned', async () => {
		const formatted = format();
		// Comment text survives (indentation and spacing before it may change).
		for (const [marker, comment] of markers(FILES))
			expect(Object.values(formatted).join('\n'), marker).toContain(comment);
		// Formatting twice changes nothing more.
		for (const text of Object.values(formatted)) expect(host.format(text).changes).toEqual([]);
		const ws = await openWorkspace(host, list(formatted));
		expect(problemsOf(ws)).toEqual([]);
		expect({
			lines: Object.fromEntries(
				Object.keys(FILES).map((p) => [p, lineDiff(FILES[p]!, formatted[p]!)])
			),
			semantic: semanticLines(host.compareModels(list(FILES), list(formatted)).diff)
		}).toMatchSnapshot();
	});

	// Known gap: the review's semantic diff reports a reformatted model as changed (`40[kg]` read as a multiplicity, a `dependency` matched by its text).
	gap('the semantic diff sees no change in a reformatted model', () => {
		expect(semanticLines(host.compareModels(list(FILES), list(format())).diff)).toEqual([]);
	});
});

describe('file operations keep text exactly', () => {
	it('rename, move and delete a file, then undo each', async () => {
		const ws = await openWorkspace(host, list(FILES));
		expect(await ws.renameFile(U, 'other/Uses2.sysml')).toBeNull();
		expect(ws.text('other/Uses2.sysml')).toBe(FILES[U]);
		ws.undo();
		expect(await ws.deleteFile(H)).toBeNull();
		ws.undo();
		expect(ws.files).toEqual(FILES);
	});
});

describe('Windows line endings', { timeout: 60_000 }, () => {
	const crlf = Object.fromEntries(
		Object.entries(FILES).map(([p, t]) => [p, t.replace(/\n/g, '\r\n')])
	);
	const lone = (text: string) => text.replace(/\r\n/g, '').includes('\n');
	const named = (names: string[]) => CASES.filter((c) => names.includes(c.name));

	async function crlfCase(c: Case) {
		const ws = await openWorkspace(host, list(crlf));
		const tools: Tools = {
			ws,
			el(label, parent) {
				const found = ws.elements.filter(
					(e) =>
						e.label === label &&
						e.kind !== 'subject' &&
						(parent === undefined || e.parent === parent)
				);
				if (found.length !== 1) throw new Error(`${found.length} elements named ${label}`);
				return found[0]!;
			},
			plan: async (p) => (typeof p === 'string' ? p : applySteps(ws, p.label, p.steps))
		};
		expect(await analysed(ws, () => c.run(tools))).toBeNull();
		const changed = Object.keys(ws.files).filter((p) => ws.files[p] !== crlf[p]);
		expect(changed.length).toBeGreaterThan(0);
		// The same model change as with Unix line endings.
		const lf = Object.fromEntries(
			Object.entries(ws.files).map(([p, t]) => [p, t.replace(/\r\n/g, '\n')])
		);
		const diff = host.compareModels(list(FILES), list(lf)).diff;
		if (!c.unseen) expect(semanticLines(diff).length).toBeGreaterThan(0);
		const mixed = changed.filter((p) => lone(ws.files[p]!));
		ws.undo();
		expect(ws.files).toEqual(crlf);
		expect(mixed, 'files left with lines ending in LF only').toEqual([]);
	}

	for (const c of named([
		'rename a definition used across files, by an alias, a comment and a dependency',
		'delete an attribute nothing refers to',
		'change a value',
		'change a metadata field in a table cell'
	]))
		it(`${c.name}: the same change, every line ending kept`, () => crlfCase(c));

	for (const c of named([
		'add a part to a definition',
		'give a definition a doc comment',
		'duplicate a definition with metadata, comments and blank lines',
		'draw a transition',
		'add an element to a view (expose)'
	]))
		// Known gap: edits that add lines write them with LF line endings into a CRLF file (mixed line endings).
		gap(`${c.name}: the lines it adds end in CRLF like the rest`, () => crlfCase(c));
});

describe(
	'repeated round trips between text and the graphical editors',
	{ timeout: 120_000 },
	() => {
		it('text edit, diagram edit, inspector edit, rename there and back, delete: no drift over five cycles', async () => {
			const ws = await openWorkspace(host, list(FILES));
			const el = (label: string, parent?: string) =>
				ws.elements.find(
					(e) => e.label === label && (parent === undefined || e.parent === parent)
				)!;
			for (let i = 0; i < 5; i++) {
				// Typed in the text: a line in Vehicle.
				const text = ws.text(H)!;
				const at = text.indexOf('\t\tattribute rpmLimit');
				await analysed(ws, () =>
					ws.setText(H, `${text.slice(0, at)}\t\tpart typed${i} : Base;\n${text.slice(at)}`)
				);
				// Drawn on a diagram: a new part of Vehicle.
				expect(
					await analysed(ws, () =>
						applySteps(
							ws,
							'Composed',
							(
								planRelation(
									relation('compose', el('Vehicle'), el('Fuel')),
									{ name: `drawn${i}` },
									modelContext(ws)
								) as Plan
							).steps
						)
					)
				).toBeNull();
				// The inspector: a multiplicity and a value, and back.
				expect(
					await analysed(ws, () => inspectorOn(ws, el(`typed${i}`), { multiplicity: '2' }))
				).toBeNull();
				expect(await analysed(ws, () => inspectorOn(ws, el('rpm'), { value: '1.0' }))).toBeNull();
				expect(
					await analysed(ws, () => inspectorOn(ws, el('rpm'), { value: '3000.0' }))
				).toBeNull();
				// Renamed there and back, across files.
				expect(await analysed(ws, () => renameElement(ws, el('Engine'), 'PowerUnit'))).toBeNull();
				expect(await analysed(ws, () => renameElement(ws, el('PowerUnit'), 'Engine'))).toBeNull();
				// Both new parts deleted (one from the explorer, one from the diagram).
				expect(await analysed(ws, () => deleteElement(ws, el(`typed${i}`)))).toBeNull();
				expect(await analysed(ws, () => deleteElement(ws, el(`drawn${i}`)))).toBeNull();
				expect(
					semanticLines(host.compareModels(list(FILES), ws.sourceFiles()).diff),
					`cycle ${i}`
				).toEqual([]);
				expect(ws.files, `cycle ${i}: the text is as it was`).toEqual(FILES);
			}
		});

		it('undoing ten edits of many elements, across files, restores every byte', async () => {
			const ws = await openWorkspace(host, list(FILES));
			const el = (label: string, parent?: string) =>
				ws.elements.find(
					(e) => e.label === label && (parent === undefined || e.parent === parent)
				)!;
			const steps: (() => Promise<string | null>)[] = [
				() => renameElement(ws, el('Engine'), 'PowerUnit'),
				() => renameElement(ws, el('Mass limit'), 'Mass cap'),
				() => deleteElement(ws, el('Gearbox')),
				() => addElement(ws, el('Vehicle'), 'part', 'spare', 'Base'),
				async () => (await duplicateElement(ws, el('car'))).error,
				() => setField(ws, srcOf(el('PowerUnit')), 'metadata:Review.reviewer', 'X', 'Set'),
				() =>
					applySteps(
						ws,
						'state',
						(planAddState(el('Power'), 'standby', true, modelContext(ws)) as Plan).steps
					),
				() => inspectorOn(ws, el('payload'), { value: '500 [kg]' }),
				() =>
					applySteps(
						ws,
						'remove',
						(planRemoveNode(el('on'), [edge(el('off_on'))], modelContext(ws)) as Plan).steps
					),
				() => renameElement(ws, el('rpmLimit', 'Vehicle'), 'maxRpm')
			];
			for (const step of steps) expect(await analysed(ws, step)).toBeNull();
			expect(ws.undoStack).toHaveLength(steps.length);
			const changed = new Set(Object.keys(ws.files).filter((p) => ws.files[p] !== FILES[p]));
			expect([...changed].sort()).toEqual([H, U].sort());
			for (let i = 0; i < steps.length; i++) expect(ws.undo()).not.toBeNull();
			expect(ws.files).toEqual(FILES);
			await analysed(ws, async () => null);
			expect(semanticLines(host.compareModels(list(FILES), ws.sourceFiles()).diff)).toEqual([]);
		});

		// Known gap: undo puts back the whole file as it was before the edit, so text typed in that file after the edit (and before Undo) goes with it.
		gap('undoing a model edit keeps what was typed in the same file after it', async () => {
			const ws = await openWorkspace(host, list(FILES));
			const vehicle = ws.elements.find((e) => e.label === 'Vehicle')!;
			await analysed(ws, () => addElement(ws, vehicle, 'part', 'spare', 'Base'));
			const typed = ws.text(H)!.replace('part def Fuel;', 'part def Fuel;\n\titem def Typed;');
			ws.setText(H, typed);
			ws.undo();
			expect(ws.text(H)).toContain('item def Typed;');
			expect(ws.text(H)).not.toContain('part spare');
		});

		// Known gap: a toast's Undo undoes the latest edit, not the one the toast is about, when two toasts are showing.
		gap('a toast’s Undo undoes its own edit', async () => {
			const { toasts } = await import('#lib/ui/toasts.svelte.ts');
			const ws = await openWorkspace(host, list(FILES));
			const el = (label: string) => ws.elements.find((e) => e.label === label)!;
			await analysed(ws, () => addElement(ws, el('Vehicle'), 'part', 'spare', 'Base'));
			const first = toasts.items.at(-1)!;
			await analysed(ws, () => renameElement(ws, el('Tank'), 'Reservoir'));
			first.action!.run();
			expect(ws.text(H)).not.toContain('part spare');
			expect(ws.text(H)).toContain('Reservoir');
		});
	}
);

/** The inspector's property form on a workspace (see `inspector`). */
function inspectorOn(ws: Workspace, element: ModelElement, set: DeclarationSet) {
	return inspector({ ws } as Tools, element, set);
}

describe('a text edit reaches every view of the model', { timeout: 120_000 }, () => {
	it('a value, a new part and a rename typed in the text show in the tree, the inspector values, a diagram, a table and the checks', async () => {
		const { demoFiles } = await import('#lib/engine/toolkit/testing.ts');
		const demo = Object.fromEntries(demoFiles().map((f) => [f.path, f.text]));
		const C = 'system/Components.sysml';
		const ws = await openWorkspace(host, list(demo));
		const mass = (table: { rows: string[][] }) =>
			table.rows.find((r) => r.some((c) => /^airframe\b/i.test(c)))?.join(' | ');
		const tableBefore = host.renderView(ws.sourceFiles(), 'droneMassBudget');
		const nodeOf = (label: string) =>
			host
				.diagram('general', ws.sourceFiles(), 'DroneComponents')
				.nodes.find((n) => n.id === label);
		expect(JSON.stringify(nodeOf('Airframe')?.attributes)).toContain('650 [g]');
		const takeOff = (r: typeof ws.checks) =>
			JSON.stringify(r?.checks.find((c) => c.requirement?.id === 'SYS-003')?.margin ?? '');
		const reasonBefore = takeOff(ws.checks);

		const typed = demo[C]!.replace('attribute :>> mass = 650 [g];', 'attribute :>> mass = 900 [g];')
			.replace('part def Camera', 'part def Gimbal :> Component;\n\n    part def Camera')
			.replace(/\bPropeller\b/g, 'Prop');
		await analysed(ws, () => ws.setText(C, typed));
		for (let i = 0; i < 200 && !ws.settled; i++) await new Promise((r) => setTimeout(r, 25));

		// The explorer's tree and the inspector's element.
		expect(ws.elements.some((e) => e.label === 'Gimbal' && e.file === C)).toBe(true);
		expect(ws.elements.some((e) => e.label === 'Prop' && e.isDefinition)).toBe(true);
		expect(ws.elements.find((e) => e.label === 'mass' && e.parent === 'Airframe')?.value).toMatch(
			/900/
		);
		// A diagram.
		expect(JSON.stringify(nodeOf('Airframe')?.attributes)).toContain('900 [g]');
		expect(nodeOf('Gimbal')).toBeDefined();
		// A table.
		const tableAfter = host.renderView(ws.sourceFiles(), 'droneMassBudget');
		expect(mass(tableAfter)).not.toEqual(mass(tableBefore));
		expect(mass(tableAfter)).toMatch(/900/);
		// The checks: the take-off mass grew by 250 g.
		expect(reasonBefore).not.toBe('""');
		expect(takeOff(ws.checks)).not.toBe(reasonBefore);
		// And the edit is a minimal text change: only the typed lines differ.
		expect(lineDiff(demo[C]!, ws.text(C)!).length).toBeLessThan(12);
	});
});

describe('quick fixes', { timeout: 60_000 }, () => {
	it('a fix changes only what the problem is about, as one undoable step', async () => {
		const broken: Record<string, string> = {
			...FILES,
			[U]: FILES[U]!.replace(
				'attribute payload :> ISQ::mass;',
				'attribute payload :> ISQ::mass = 500 [kg];'
			)
		};
		const ws = await openWorkspace(host, list(broken));
		expect(problemsOf(ws).join('\n')).toMatch(/unresolved reference `kg`/);
		const actions = host.codeActions(ws.sourceFiles(), U, 0, broken[U]!.length);
		expect(actions.length).toBeGreaterThan(0);
		const fix = actions[0]!;
		await analysed(ws, () => ws.applyFileChanges(fix.title, fix.changes));
		expect(problemsOf(ws)).toEqual([]);
		for (const [marker, line] of markers(broken)) expect(markers(ws.files).get(marker)).toBe(line);
		expect({ title: fix.title, lines: lineDiff(broken[U]!, ws.text(U)!) }).toMatchSnapshot();
		for (const p of [H, V]) expect(ws.text(p)).toBe(broken[p]);
		ws.undo();
		expect(ws.files).toEqual(broken);
	});
});

describe('a redefinition left without its feature', { timeout: 60_000 }, () => {
	/** What `:>> mass` in Engine resolves to, after Engine no longer specializes Base. */
	async function afterUnspecializing() {
		const ws = await openWorkspace(host, list(FILES));
		const engine = ws.elements.find((e) => e.label === 'Engine')!;
		await analysed(ws, () => inspector({ ws } as Tools, engine, { specializes: [] }));
		const text = ws.text(H)!;
		const at = text.indexOf(':>> mass = 120') + 4;
		const before = host.definition(list(FILES), H, FILES[H]!.indexOf(':>> mass = 120') + 4);
		const after = host.definition(ws.sourceFiles(), H, at);
		return { ws, before, after };
	}

	it('resolves to Base::mass before, and is rebound to the library’s ISQ::mass after', async () => {
		const { before, after } = await afterUnspecializing();
		expect(before && 'path' in before ? FILES[H]!.slice(before.from, before.to) : before).toBe(
			'mass'
		);
		expect(before && 'path' in before && FILES[H]!.slice(0, before.from)).toMatch(
			/abstract part def Base \{[^}]*attribute $/
		);
		expect(after && 'library' in after ? after.library.path : after).toMatch(/ISQ/);
	});

	it('on the demo, deleting the Camera → Component line on a diagram rebinds Camera’s `:>> mass` to ISQ::mass without a word', async () => {
		const { demoFiles } = await import('#lib/engine/toolkit/testing.ts');
		const C = 'system/Components.sysml';
		const ws = await openWorkspace(host, demoFiles());
		const camera = ws.elements.find((e) => e.label === 'Camera' && e.isDefinition)!;
		const component = ws.elements.find((e) => e.label === 'Component' && e.isDefinition)!;
		const plan = planEdgeRemoval('specialization', null, camera, component, modelContext(ws));
		expect(
			await analysed(ws, () => applySteps(ws, (plan as Plan).label, (plan as Plan).steps))
		).toBeNull();
		const text = ws.text(C)!;
		const at = text.indexOf(':>> mass = 60 [g]') + 4;
		const target = host.definition(ws.sourceFiles(), C, at);
		expect(target && 'library' in target ? target.library.path : target).toMatch(/ISQ/);
		const problems = problemsOf(ws).filter((p) => p.startsWith(C));
		// `:>> powerDraw` has nothing to redefine and is reported; `:>> mass` is not.
		expect(problems.join('\n')).toMatch(/powerDraw/);
		expect(problems.join('\n')).not.toMatch(/\bmass\b/);
		// What the review shows for it, budgets and computed values included.
		const diff = host.compareModels(demoFiles(), ws.sourceFiles()).diff;
		expect({
			semantic: semanticLines(diff),
			budgets: diff.budgets.map((b) => `${b.title}: ${b.before} -> ${b.after}`)
		}).toMatchSnapshot();
	});

	// `:>> mass` in a definition that no longer inherits a `mass` redefines the imported
	// ISQ::mass; the toolkit doesn't count that as a rebound reference, the app says so.
	it('removing the specialization says that the redefinition now redefines something else', async () => {
		const { ws } = await afterUnspecializing();
		expect(ws.warnings.join(' ')).toMatch(
			/Engine::mass now redefines ISQ\w*::mass instead of [\w:]*Base::mass/
		);
	});
});
