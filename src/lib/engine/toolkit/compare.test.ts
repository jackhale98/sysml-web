/**
 * The semantic diff on the demo, through the same code the worker runs:
 * scripted edits (a mass, a new requirement, a rename, a deleted
 * connection, an FMEA rating), what the review says about them, and how
 * stable the toolkit's element ids are.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { commitMessage, summarize, type ReviewSummary } from '#lib/review/summary.ts';
import type { SourceFile } from '../protocol';
import { editFiles } from './edit-testing';
import type { ToolkitHost } from './host';
import { extractModel, type UnitInfo } from './model';
import { demoFiles, loadHost } from './testing';

let host: ToolkitHost;
const demo = demoFiles();
const C = 'system/Components.sysml';
const R = 'requirements/SystemRequirements.sysml';

beforeAll(async () => {
	host = await loadHost();
	host.analyzeProject(demo);
}, 60_000);

const asMap = (files: SourceFile[]) => Object.fromEntries(files.map((f) => [f.path, f.text]));
const asList = (files: Record<string, string>) =>
	demo.map((f) => ({ path: f.path, text: files[f.path] ?? f.text }));
function replace(files: Record<string, string>, path: string, from: string, to: string) {
	const text = files[path]!;
	if (!text.includes(from)) throw new Error(`${path} has no ${from}`);
	return { ...files, [path]: text.replace(from, to) };
}

const texts = (s: ReviewSummary) => [
	...s.impact.map((i) => i.text),
	...s.groups.flatMap((g) => g.items.map((i) => `${g.title}: ${i.text}`))
];

/** The demo after a morning's work: heavier motors, a new requirement, a rename, a removed wire. */
function edited(): SourceFile[] {
	let files = asMap(demo);
	files = replace(files, C, 'attribute :>> mass = 120 [g];', 'attribute :>> mass = 190 [g];');
	files = replace(
		files,
		R,
		'    // ---- Environment ----',
		[
			"    requirement <'SYS-012'> 'Noise at night' : DroneRequirement {",
			'        doc /* The drone shall be no louder than 55 dB(A) at 30 m between 22:00 and 06:00. */',
			'        :>> priority = Priority::low;',
			'    }',
			'',
			'    // ---- Environment ----'
		].join('\n')
	);
	// A rename through the engine, as the app makes it: every reference follows.
	const line = files[C]!.split('\n').findIndex((l) => l.includes('part motor : Motor;')) + 1;
	const renamed = editFiles(host, files, {
		op: 'rename',
		path: C,
		from: 'motor',
		to: 'engine',
		line
	});
	if ('error' in renamed) throw new Error(renamed.error);
	files = renamed.files;
	files = replace(files, C, '        connect engine to propeller;     // shaft and hub\n', '');
	files = replace(
		files,
		'risk/DesignFmea.sysml',
		'severity = 8; likelihood = 3; detection = 6;',
		'severity = 8; likelihood = 2; detection = 6;'
	);
	return asList(files);
}

describe('comparing two versions of the demo', () => {
	let summary: ReviewSummary;
	let ms: { base: number; current: number; diff: number };

	beforeAll(() => {
		const current = edited();
		host.analyzeProject(current);
		const started = performance.now();
		const comparison = host.compareModels(demo, current);
		console.log(
			`[compare] base ${comparison.ms.base} ms, current ${comparison.ms.current} ms, diff ${comparison.ms.diff} ms, total ${Math.round(performance.now() - started)} ms`
		);
		ms = comparison.ms;
		summary = summarize(comparison.diff);
	}, 60_000);

	it('puts the requirement the change breaks first', () => {
		expect(summary.impact[0]).toMatchObject({
			tone: 'fails',
			text: '`drone.takeOffMass` now violates `SYS-003` ‘Maximum take-off mass’ (4.05 kg > 4 kg)'
		});
		expect(summary.counts.failing).toBe(1);
	});

	it('reports the budget total and the values that follow from the change', () => {
		const impact = summary.impact.map((i) => i.text);
		expect(impact).toContain('Drone mass budget: `drone` adds up to `3.05 kg` (was 2.77 kg)');
		expect(impact).toContain('`Rotor.mass` is now `250 g` (was 180 g)');
		expect(impact).toContain('`drone.emptyMass` is now `3.05 kg` (was 2.77 kg)');
	});

	it('says what changed, grouped, in plain language', () => {
		const all = texts(summary);
		expect(all).toContain('Design: `Motor.mass` changed 120 g → `190 g`');
		expect(all).toContain(
			'Requirements: Added requirement `SYS-012` ‘Noise at night’ to `SystemRequirements`'
		);
		expect(all).toContain('Design: Renamed part `Rotor.motor` to `engine`');
		// What was removed reads as it was written.
		expect(all).toContain('Design: Removed the connection `motor to propeller` in `Rotor`');
		expect(all).toContain('Risk: FMEA of `drone.battery`: likelihood 3 → `2`');
		// The references the rename changed are the same references: not changes.
		expect(
			all.filter((t) => /Rotor\.mass|esc to engine|FMEA of `Rotor/.test(t) && !t.includes('is now'))
		).toEqual([]);
		expect(summary.groups.map((g) => g.title)).toEqual(['Requirements', 'Design', 'Risk']);
	});

	it('suggests a commit message', () => {
		const message = commitMessage(summary);
		expect(message.split('\n')[0]).toBe(
			'Add requirement SYS-012; rename Rotor.motor to engine and 3 more'
		);
		expect(message).toContain(
			'- drone.takeOffMass now violates SYS-003 ‘Maximum take-off mass’ (4.05 kg > 4 kg)'
		);
	});

	it('analyses the base apart, in about the time of an analysis, and caches it', () => {
		expect(ms.base).toBeGreaterThan(0);
		expect(ms.base).toBeLessThan(5_000);
		const again = host.compareModels(demo, edited());
		expect(again.ms.base).toBe(0);
	});

	it('finds nothing to report between a version and itself', () => {
		const same = host.compareModels(demo, demo);
		expect(summarize(same.diff).empty).toBe(true);
	});

	it('leaves the analysed session alone', () => {
		const current = edited();
		host.analyzeProject(current);
		host.compareModels(demo, current);
		// Still the analysed build: no rebuild (a rebuild would take far longer than this).
		const started = performance.now();
		host.analyzeProject(current);
		expect(performance.now() - started).toBeLessThan(20);
	});

	it('compares a version that has a syntax error, leaving the broken part out', () => {
		const broken = asList(
			replace(asMap(demo), C, 'attribute :>> mass = 120 [g];', 'attribute :>> mass = 120 [g]')
		);
		const diff = host.compareModels(demo, broken).diff;
		expect(diff.brokenFiles).toEqual([C]);
	});
});

describe('the toolkit’s element ids', () => {
	const ids = (files: SourceFile[]) => {
		const { session, units } = host.session(files);
		const byIndex = new Map<number, UnitInfo>();
		for (const u of JSON.parse(session!.units()) as { unit: number; name: string }[]) {
			const unit = units.get(u.name);
			if (unit) byIndex.set(u.unit, unit);
		}
		const records = extractModel(host.tk, session!, byIndex).elements;
		return new Map(
			records.map((r) => [r.qualifiedName ?? `${r.metaclass}@${r.path}:${r.span.start_row}`, r.id])
		);
	};
	const before = () => ids(demo);

	it('are the same for named elements wherever their text moves', () => {
		const was = before();
		const now = ids(
			asList(
				replace(
					asMap(demo),
					C,
					'package DroneComponents {',
					'// moved down\n\n\npackage DroneComponents {\n    attribute def Spare;\n'
				)
			)
		);
		for (const [name, id] of was) if (!name.includes('@')) expect(now.get(name), name).toBe(id);
	});

	it('change when the name or the owner changes (they derive from the qualified name)', () => {
		const was = before();
		const now = ids(
			asList(replace(asMap(demo), C, 'part def Motor :>', 'part def BrushlessMotor :>'))
		);
		expect(now.get('DroneComponents::BrushlessMotor')).toBeDefined();
		expect(now.get('DroneComponents::BrushlessMotor')).not.toBe(was.get('DroneComponents::Motor'));
		// Its members' ids change with it.
		expect(now.get('DroneComponents::BrushlessMotor::mass')).not.toBe(
			was.get('DroneComponents::Motor::mass')
		);
		// Elsewhere nothing changes.
		expect(now.get('DroneComponents::Battery')).toBe(was.get('DroneComponents::Battery'));
	});

	// Keyed by file and line: the claims of Satisfaction.sysml only (keyed by line alone, the first
	// claim in the model was another file's, which the edit doesn't move).
	it('of unnamed elements stay with their statements when one is added before them', () => {
		const S = 'system/Satisfaction.sysml';
		const satisfyIds = (files: SourceFile[]) =>
			[...ids(files)]
				.filter(([k]) => k.startsWith(`SatisfyRequirementUsage@${S}:`))
				.map(([, id]) => id);
		const was = satisfyIds(demo);
		const now = satisfyIds(
			asList(
				replace(
					asMap(demo),
					S,
					"    satisfy 'Flight endurance' by drone;",
					"    satisfy 'Acoustic noise' by drone;\n    satisfy 'Flight endurance' by drone;"
				)
			)
		);
		// The new first claim has an id of its own; the others keep theirs.
		expect(was).not.toContain(now[0]);
		expect(now.slice(1)).toEqual(was);
	});
});

describe('what the semantic diff sees', () => {
	const P = 'model/P.sysml';
	/** The diff between two versions of one file, as `kind name {property: before -> after}` lines. */
	const diffOf = (before: string, after: string) => {
		const { diff } = host.compareModels([{ path: P, text: before }], [{ path: P, text: after }]);
		return [
			...diff.elements.map(
				(e) =>
					`${e.change} ${(e.after ?? e.before)!.qualifiedName} {${e.properties
						.map((p) => `${p.property}: ${p.before ?? '-'} -> ${p.after ?? '-'}`)
						.join('; ')}}`
			),
			...diff.relations.map((r) => `${r.change} ${r.relation} ${r.text}`)
		];
	};
	const model = (body: string) =>
		`package P {\n\tprivate import ScalarValues::*;\n\tprivate import SI::*;\n${body}\n}\n`;

	it('a value made a default, or bound again', () => {
		const bound = model('\tpart def E { attribute rpm : Real = 3000.0; }');
		const fallback = model('\tpart def E { attribute rpm : Real default = 3000.0; }');
		expect(diffOf(bound, fallback)).toEqual(['changed P::E::rpm {valueKind: - -> default}']);
		expect(diffOf(fallback, bound)).toEqual(['changed P::E::rpm {valueKind: default -> -}']);
		// `default 3000.0` and `default = 3000.0` are the same.
		expect(diffOf(fallback, fallback.replace('default =', 'default'))).toEqual([]);
	});

	it('a value made derived', () => {
		const plain = model('\tpart def E { attribute m : Real; attribute t : Real = m * 2; }');
		const derived = plain.replace('attribute t', 'derived attribute t');
		expect(diffOf(plain, derived)).toEqual(['changed P::E::t {derived: - -> derived}']);
	});

	it('what a view exposes', () => {
		const view = model('\tpart a;\n\tpart b;\n\tview v { expose a; }');
		expect(diffOf(view, view.replace('expose a;', 'expose a; expose b;'))).toEqual([
			'changed P::v {exposes: a -> a; b}'
		]);
	});

	it('a unit in brackets is not a multiplicity, however it is spaced', () => {
		const spaced = model('\tpart def T { attribute mass :> ISQ::mass = 40 [kg]; }');
		const tight = model('\tpart def T{attribute mass:>ISQ::mass=40[kg];}');
		expect(diffOf(spaced, tight)).toEqual([]);
	});

	it('a dependency written with or without `from` is the same', () => {
		const from = model('\tpart def A;\n\tpart def B;\n\tdependency from A to B;');
		expect(diffOf(from, from.replace('dependency from A to B;', 'dependency  A  to B ;'))).toEqual(
			[]
		);
	});

	it('a transition’s trigger, written either way', () => {
		const machine = model(
			'\titem def Go;\n\tstate def S {\n\t\tentry; then off;\n\t\tstate off;\n\t\tstate on;\n\t\ttransition t first off accept Go then on;\n\t}'
		);
		expect(diffOf(machine, machine.replace('accept Go', 'accept after 5 [s]'))).toEqual([
			'changed P::S::t {trigger: Go -> after 5 s}'
		]);
		expect(diffOf(machine, machine.replace('accept Go', 'accept : Go'))).toEqual([]);
	});

	it('a comment about an element is not its description', () => {
		const text = model(
			'\tpart def E { doc /* The engine. */ }\n\tcomment note about E /* Check the mounts. */'
		);
		expect(diffOf(text, text.replace('Check the mounts.', 'Check the bolts.'))).toEqual([
			'changed P::E {comments: Check the mounts. -> Check the bolts.}'
		]);
		expect(diffOf(text, text.replace('The engine.', 'The motor.'))).toEqual([
			'changed P::E {doc: The engine. -> The motor.}'
		]);
	});
});
