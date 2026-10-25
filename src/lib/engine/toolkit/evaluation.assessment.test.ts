/**
 * Assessment §6.1–6.2 (calculations and roll-ups): known-answer tests on the
 * real engine, each answer worked out by hand in the comment beside it.
 * Expressions (operators, precedence, units, missing values, cycles,
 * division by zero), mass budgets over nested parts (multiplicities,
 * inheritance, redefinition, references, definitions, repeated parts,
 * subsets, ranges, mixed and unknown units, inherited expressions) and
 * constraint checks in their scope (`satisfy … by …`, `assert`).
 *
 * A test kept as `it.fails` is a known gap: it flips when fixed.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { analysed, openWorkspace } from '#lib/create/testing.ts';
import type { Evaluated, RenderedTable } from '../types';
import type { ToolkitHost } from './host';
import { loadHost } from './testing';

let host: ToolkitHost;
beforeAll(async () => {
	host = await loadHost();
}, 60_000);

const project = (text: string) => [{ path: 'm.sysml', text }];

/** Wait for a workspace's first checks (after its first analysis). */
async function checked(workspace: { checks: unknown }) {
	for (let i = 0; i < 800 && !workspace.checks; i++) await new Promise((r) => setTimeout(r, 25));
	expect(workspace.checks).not.toBeNull();
}

/** Analyse a one-file model; it must have no problems. */
function analyse(text: string) {
	const files = project(text);
	const analyses = host.analyzeProject(files);
	expect(analyses.flatMap((a) => [...a.model.syntax_errors, ...a.diagnostics])).toEqual([]);
	return files;
}

/** Values of attributes by qualified name. */
function values(text: string, names: string[]): Record<string, Evaluated | undefined> {
	const files = project(text);
	host.analyzeProject(files);
	const records = (
		host as unknown as {
			built: { extracted: { elements: { id: string; qualifiedName: string | null }[] } };
		}
	).built.extracted.elements;
	const ids = names.map((n) => records.find((r) => r.qualifiedName === n)?.id ?? `missing:${n}`);
	const evaluated = host.evaluate(files, ids);
	return Object.fromEntries(names.map((n, i) => [n, evaluated[ids[i]!]]));
}

/** A budget table as `path → [quantity, each, total, share]`, with each row's notes. */
function budget(table: RenderedTable) {
	const col = (name: string) => table.columns.indexOf(name);
	const rows = new Map<string, string[]>();
	const notes = new Map<string, string>();
	table.rows.forEach((r, i) => {
		rows.set(r[col('path')]!, [
			r[col('quantity')]!,
			r[col('each')]!,
			r[col('total')]!,
			r[col('share')]!
		]);
		const n = table.rowInfo?.[i]?.notes;
		if (n) notes.set(r[col('path')]!, Object.values(n).join(' | '));
	});
	return { rows, notes, paths: [...rows.keys()] };
}

// ---- 6.1 Expressions ----------------------------------------------------------------

const EXPRESSIONS = `package E {
  private import SI::*;
  part p {
    attribute prec = 2 + 3 * 4;
    attribute paren = (2 + 3) * 4;
    attribute powRight = 2 ** 3 ** 2;
    attribute negPow = -2 ** 2;
    attribute div = 7 / 2;
    attribute modulo = 7 % 3;
    attribute cond = if 1 > 2 ? 10 else 20;
    attribute logic = true and not false;
    attribute divZero = 1 / 0;
    attribute divZeroReal = 1.0 / 0.0;
    attribute modZero = 7 % 0;
    attribute gkg :> ISQ::mass = 1 [kg] + 500 [g];
    attribute whj :> ISQ::energy = 1 [W*h] + 3600 [J];
    attribute lbkg :> ISQ::mass = 1 [USCustomaryUnits::lb] + 1 [kg];
    attribute ratio = 3 [m] / 2 [s];
    attribute cmp = 1 [kg] > 500 [g];
    attribute missing :> ISQ::mass;
    attribute usesMissing :> ISQ::mass = missing + 1 [kg];
    attribute a = b + 1;
    attribute b = a + 1;
  }
}
`;

describe('6.1 expressions, as the engine evaluates them', () => {
	it('follows the documented precedence and operators', () => {
		const v = values(
			EXPRESSIONS,
			['prec', 'paren', 'powRight', 'negPow', 'div', 'modulo', 'cond', 'logic'].map(
				(n) => `E::p::${n}`
			)
		);
		// 2 + (3 × 4) = 14; (2 + 3) × 4 = 20; ** is right-associative: 2 ** (3 ** 2) = 2 ** 9 = 512;
		// KerML's unary minus binds tighter than **: (-2) ** 2 = 4; 7 / 2 = 3.5 (real division);
		// 7 mod 3 = 1; 1 > 2 is false, so 20; true and (not false) = true.
		expect(v['E::p::prec']).toEqual({ kind: 'number', value: 14, unit: null });
		expect(v['E::p::paren']).toEqual({ kind: 'number', value: 20, unit: null });
		expect(v['E::p::powRight']).toEqual({ kind: 'number', value: 512, unit: null });
		expect(v['E::p::negPow']).toEqual({ kind: 'number', value: 4, unit: null });
		expect(v['E::p::div']).toEqual({ kind: 'number', value: 3.5, unit: null });
		expect(v['E::p::modulo']).toEqual({ kind: 'number', value: 1, unit: null });
		expect(v['E::p::cond']).toEqual({ kind: 'number', value: 20, unit: null });
		expect(v['E::p::logic']).toEqual({ kind: 'text', text: 'true' });
	});

	it('converts units of one dimension and refuses to mix dimensions', () => {
		const text = EXPRESSIONS.replace(
			'    attribute missing',
			'    attribute kgm = 1 [kg] + 1 [m];\n    attribute cmpBad = 1 [kg] > 1 [m];\n    attribute missing'
		);
		const files = project(text);
		const diagnostics = host.analyzeProject(files).flatMap((a) => a.diagnostics);
		// The incompatible sum and comparison are flagged in the text, at their lines.
		expect(diagnostics.map((d) => [d.severity, d.span.start_row, d.message]).toSorted()).toEqual([
			['warning', 20, 'expression combines incompatible quantity dimensions `M` and `L`'],
			['warning', 21, 'expression combines incompatible quantity dimensions `M` and `L`']
		]);
		const v = values(
			text,
			['gkg', 'whj', 'lbkg', 'ratio', 'cmp', 'kgm', 'cmpBad'].map((n) => `E::p::${n}`)
		);
		// 1 kg + 500 g = 1.5 kg; 1 W·h + 3600 J = 1 W·h + 1 W·h = 2 W·h;
		// 1 lb + 1 kg = 1 lb + 1/0.45359237 lb = 3.204622 lb (the library's pound is 0.4535924 kg, so the
		// engine gives 3.20462248: within 7e-8 of the exact factor); 3 m / 2 s = 1.5 m/s; 1 kg > 0.5 kg.
		expect(v['E::p::gkg']).toEqual({ kind: 'number', value: 1.5, unit: 'kg' });
		expect(v['E::p::whj']).toEqual({ kind: 'number', value: 2, unit: 'W*h' });
		expect(v['E::p::lbkg']).toMatchObject({ kind: 'number', unit: 'lb' });
		expect((v['E::p::lbkg'] as { value: number }).value).toBeCloseTo(1 + 1 / 0.45359237, 6);
		expect(v['E::p::ratio']).toEqual({ kind: 'number', value: 1.5, unit: 'm/s' });
		expect(v['E::p::cmp']).toEqual({ kind: 'text', text: 'true' });
		// kg + m and kg > m have no value: the reason is given, no number is made up.
		expect(v['E::p::kgm']).toEqual({
			kind: 'undecided',
			reason: 'type error: cannot combine quantities in `kg` and `m`'
		});
		expect(v['E::p::cmpBad']).toEqual({
			kind: 'undecided',
			reason: 'type error: cannot compare quantities in `kg` and `m`'
		});
	});

	it('says why there is no value: division by zero, a missing value, a cycle', () => {
		const v = values(
			EXPRESSIONS,
			['divZero', 'divZeroReal', 'modZero', 'missing', 'usesMissing', 'a', 'b'].map(
				(n) => `E::p::${n}`
			)
		);
		expect(v['E::p::divZero']).toEqual({ kind: 'undecided', reason: 'division by zero' });
		expect(v['E::p::divZeroReal']).toEqual({ kind: 'undecided', reason: 'division by zero' });
		expect(v['E::p::modZero']).toEqual({ kind: 'undecided', reason: 'division by zero' });
		expect(v['E::p::missing']).toEqual({ kind: 'none' });
		expect(v['E::p::usesMissing']).toEqual({
			kind: 'undecided',
			reason: '`missing` has no value in `p`'
		});
		expect(v['E::p::a']).toEqual({
			kind: 'undecided',
			reason: 'cyclic feature value involving `a`'
		});
		expect(v['E::p::b']).toEqual({
			kind: 'undecided',
			reason: 'cyclic feature value involving `b`'
		});
	});

	it('gives the same values in a fresh analysis (reproducible)', () => {
		const names = ['prec', 'third', 'gkg', 'lbkg', 'divZero'].map((n) => `E::p::${n}`);
		const text = EXPRESSIONS.replace(
			'    attribute div',
			'    attribute third = 1 / 3;\n    attribute div'
		);
		const first = JSON.stringify(values(text, names));
		host.analyzeProject(project('package Other { part x; }'));
		expect(JSON.stringify(values(text, names))).toBe(first);
		// 1 / 3 is an exact fraction, read as its nearest double.
		expect(JSON.parse(first)['E::p::third']).toEqual({ kind: 'number', value: 1 / 3, unit: null });
	});
});

// ---- 6.2 Roll-ups ---------------------------------------------------------------------

const NESTED = `package B {
  private import SI::*;
  part def Screw { attribute mass :> ISQ::mass = 2 [g]; }
  part def Arm { attribute mass :> ISQ::mass default 50 [g]; }
  part def HeavyArm :> Arm { attribute :>> mass default 80 [g]; }
  part def Rotor { attribute mass :> ISQ::mass = 30 [g]; }
  part def Hub { part screws : Screw[6]; part rotors : Rotor[4]; }
  part def Pod { part hub : Hub; }
  part def Body { attribute mass :> ISQ::mass = 0.5 [kg]; }
  part def Camera { attribute mass :> ISQ::mass default 200 [g]; }
  part def Spare { part body : Body; part extra : Body; }
  part def Drone {
    part body : Body;
    part pods : Pod[2];
    part arms : Arm[2];
    part heavy : HeavyArm;
    part light : Arm { attribute :>> mass = 40 [g]; }
    part cam1 : Camera;
    part cam2 : Camera;
    ref part spare : Camera;
  }
  part def BigDrone :> Drone {
    part :>> cam2 { attribute :>> mass = 1 [kg]; }
    part cam3 : Camera;
  }
  part drone : Drone;
  part big : BigDrone;
  view droneBudget : ModelViews::MassBudget { expose drone::**; }
  view bigBudget : ModelViews::MassBudget { expose big::**; }
  view wholeModel : ModelViews::MassBudget;
}
`;

describe('6.2 a mass budget over nested parts (known answers)', () => {
	it('adds up nested parts, multiplicities, inherited and redefined values, and leaves references out', () => {
		const files = analyse(NESTED);
		const { rows, paths } = budget(host.renderView(files, 'B::droneBudget'));
		// body 0.5 kg = 500 g (given in kg)
		// pods: 2 × hub; hub = 6 screws × 2 g + 4 rotors × 30 g = 12 + 120 = 132 g; 2 × 132 = 264 g
		// arms: 2 × 50 g (Arm's value, inherited by the usage) = 100 g
		// heavy: 80 g (HeavyArm redefines Arm's mass)
		// light: 40 g (the usage redefines it)
		// cam1 + cam2: 2 × 200 g = 400 g (two usages of one definition both count)
		// spare: a `ref part`, not a part of the drone: 0
		// drone = 500 + 264 + 100 + 80 + 40 + 400 = 1384 g
		expect(rows.get('drone')).toEqual(['1', '1384 g', '1384 g', '100 %']);
		expect(rows.get('drone.body')).toEqual(['1', '500 g', '500 g', '36 %']);
		expect(rows.get('drone.pods')).toEqual(['2', '132 g', '264 g', '19 %']);
		// The 8 rotors in the 2 pods: 8 × 30 g = 240 g; the 12 screws: 12 × 2 g = 24 g.
		expect(rows.get('drone.pods.hub.rotors')).toEqual(['4', '30 g', '240 g', '17 %']);
		expect(rows.get('drone.pods.hub.screws')).toEqual(['6', '2 g', '24 g', '1.7 %']);
		expect(rows.get('drone.arms')).toEqual(['2', '50 g', '100 g', '7.2 %']);
		expect(rows.get('drone.heavy')).toEqual(['1', '80 g', '80 g', '5.8 %']);
		expect(rows.get('drone.light')).toEqual(['1', '40 g', '40 g', '2.9 %']);
		expect(rows.get('drone.cam1')?.[2]).toBe('200 g');
		expect(rows.get('drone.cam2')?.[2]).toBe('200 g');
		expect(paths).not.toContain('drone.spare');
	});

	it('takes a specialization’s parts, with its redefinitions, once each', () => {
		const files = analyse(NESTED);
		const { rows, paths } = budget(host.renderView(files, 'B::bigBudget'));
		// BigDrone inherits Drone's parts (1384 g), redefines cam2 as 1 kg (+800 g) and adds cam3 (+200 g):
		// 1384 + 800 + 200 = 2384 g.
		expect(rows.get('big')?.slice(1, 3)).toEqual(['2384 g', '2384 g']);
		expect(rows.get('big.cam2')?.[2]).toBe('1000 g');
		expect(paths.filter((p) => p === 'big.cam2')).toHaveLength(1);
		expect(rows.get('big.cam3')?.[2]).toBe('200 g');
	});

	it('does not count a definition in a part that does not use it', () => {
		const files = analyse(NESTED);
		const { rows, paths } = budget(host.renderView(files, 'B::wholeModel'));
		// Over the whole model: the same totals; `Spare` (never used) is not in either.
		expect(rows.get('drone')?.[2]).toBe('1384 g');
		expect(rows.get('big')?.[2]).toBe('2384 g');
		expect(
			paths
				.filter((p) => p.startsWith('drone.') || p.startsWith('big.'))
				.some((p) => /extra/.test(p))
		).toBe(false);
	});

	it('gives the same table in a fresh analysis (reproducible)', () => {
		const first = JSON.stringify(host.renderView(analyse(NESTED), 'B::droneBudget'));
		analyse('package Other { part x; }');
		expect(JSON.stringify(host.renderView(analyse(NESTED), 'B::droneBudget'))).toBe(first);
	});
});

const UNITS = `package U {
  private import SI::*;
  private import USCustomaryUnits::*;
  part def G { attribute mass :> ISQ::mass = 500 [g]; }
  part def Kg { attribute mass :> ISQ::mass = 1.5 [kg]; }
  part def Lb { attribute mass :> ISQ::mass = 2 [lb]; }
  part def Missing { attribute mass :> ISQ::mass; }
  part def Bare { attribute mass = 3; }
  part def Len { attribute mass = 5 [m]; }
  part def Box { part g : G; part k : Kg; }
  part def BoxLb { part g : G; part l : Lb; }
  part def BoxMissing { part g : G; part m : Missing; }
  part def BoxBare { part g : G; part b : Bare; }
  part def BoxLen { part g : G; part l : Len; }
  part sys {
    part box : Box;
    part boxLb : BoxLb;
    part boxMissing : BoxMissing;
    part boxBare : BoxBare;
    part boxLen : BoxLen;
  }
  view unitsBudget : ModelViews::MassBudget { expose sys::**; }
}
`;

describe('6.2 missing values and mixed, unknown or incompatible units', () => {
	it('adds grams and kilograms, and never adds what does not convert', () => {
		const files = analyse(UNITS);
		const { rows, notes } = budget(host.renderView(files, 'U::unitsBudget'));
		// 500 g + 1.5 kg = 2000 g.
		expect(rows.get('sys.box')?.slice(1, 3)).toEqual(['2000 g', '2000 g']);
		// 500 g + 2 lb: the table doesn't convert pounds, so no total (not 502 g).
		expect(rows.get('sys.boxLb')?.[1]).toBe('');
		// 500 g + 3 (no unit), 500 g + 5 m: no total.
		expect(rows.get('sys.boxBare')?.[1]).toBe('');
		expect(rows.get('sys.boxLen')?.[1]).toBe('');
		// A part without a value: its parent adds the others, and says one is missing.
		expect(rows.get('sys.boxMissing')?.[1]).toBe('500 g');
		expect(notes.get('sys.boxMissing')).toBe('adds up the parts that have a mass; 1 has none');
		expect(notes.get('sys.boxMissing.m')).toBe('no mass is given');
		// The system adds what it can (2000 + 500 = 2500 g) and says 3 parts are left out.
		expect(rows.get('sys')?.[1]).toBe('2500 g');
		expect(notes.get('sys')).toBe('adds up the parts that have a mass; 3 have none');
	});

	// Known gap: a parent whose parts' units don't add up says "no mass is given" instead of why.
	it.fails('says why parts in units that do not add up have no total', () => {
		const files = analyse(UNITS);
		const { notes } = budget(host.renderView(files, 'U::unitsBudget'));
		expect(notes.get('sys.boxLb')).toMatch(/lb/);
		expect(notes.get('sys.boxLen')).toMatch(/\bm\b/);
	});

	// Known gap: a value in a unit the table can't convert (2 lb) shows a share of 0 %; a plain
	// number (3) a share as if it were grams (0.1 %). Neither has a share of the total in grams.
	it.fails('gives no share to a value that is not in the total’s unit', () => {
		const files = analyse(UNITS);
		const { rows } = budget(host.renderView(files, 'U::unitsBudget'));
		expect(rows.get('sys.boxLb.l')?.[3]).toBe('');
		expect(rows.get('sys.boxBare.b')?.[3]).toBe('');
	});
});

const INHERITED = `package I {
  private import SI::*;
  part def Battery {
    attribute cells default 4;
    attribute cellMass :> ISQ::mass default 50 [g];
    attribute mass :> ISQ::mass = cells * cellMass;
  }
  part def Craft {
    part battery : Battery { attribute :>> cells = 6; }
    part spare : Battery;
    attribute total :> ISQ::mass = battery.mass + spare.mass;
  }
  part craft : Craft { part :>> spare { attribute :>> cellMass = 60 [g]; } }
  view inheritedBudget : ModelViews::MassBudget { expose craft::**; }
}
`;

describe('6.2 an expression a part inherits, with the part’s own values', () => {
	it('works the inherited mass out with each part’s values, not the definition’s', () => {
		const files = analyse(INHERITED);
		const { rows } = budget(host.renderView(files, 'I::inheritedBudget'));
		// mass = cells × cellMass, inherited from Battery (4 × 50 g = 200 g there).
		// battery redefines cells = 6: 6 × 50 g = 300 g.
		// spare (in craft) redefines cellMass = 60 g: 4 × 60 g = 240 g.
		// craft = 300 + 240 = 540 g, and craft's own `total` (battery.mass + spare.mass) = 540 g.
		expect(rows.get('craft.battery')?.slice(1, 3)).toEqual(['300 g', '300 g']);
		expect(rows.get('craft.spare')?.slice(1, 3)).toEqual(['240 g', '240 g']);
		expect(rows.get('craft')?.slice(1, 3)).toEqual(['540 g', '540 g']);
		expect(rows.get('craft.total')?.[2]).toBe('540 g');
	});
});

const COLLECTIONS = `package S {
  private import SI::*;
  part def Motor { attribute mass :> ISQ::mass = 10 [g]; }
  part def Opt { attribute mass :> ISQ::mass = 100 [g]; }
  part def Quad { part motors : Motor[4]; part m1 :> motors; part m2 :> motors; }
  part def Kit { part base : Opt; part o : Opt[0..1]; part r : Opt[2..4]; }
  part quad : Quad;
  part kit : Kit;
  view quadBudget : ModelViews::MassBudget { expose quad::**; }
  view kitBudget : ModelViews::MassBudget { expose kit::**; }
}
`;

describe('6.2 parts named out of a collection, and parts of variable number', () => {
	it('counts a part that is one of a collection once, in the collection', () => {
		const files = analyse(COLLECTIONS);
		const { rows } = budget(host.renderView(files, 'S::quadBudget'));
		// `m1 :> motors` and `m2 :> motors` are two of the four motors: 4 × 10 g = 40 g, not 60 g.
		expect(rows.get('quad.motors')?.[2]).toBe('40 g');
		expect(rows.get('quad')?.slice(1, 3)).toEqual(['40 g', '40 g']);
	});

	it('says when it counts parts of variable number at their least', () => {
		const files = analyse(COLLECTIONS);
		const { rows, notes } = budget(host.renderView(files, 'S::kitBudget'));
		// base 100 g + o [0..1] at 0 + r [2..4] at 2 × 100 g = 300 g (its least; at most 100 + 100 + 400 = 600 g).
		expect(rows.get('kit')?.slice(1, 3)).toEqual(['300 g', '300 g']);
		// The total is not presented as simply "the sum of its parts": the note names the variable ones.
		expect(notes.get('kit')).toMatch(/`o` \(0\.\.1\)/);
		expect(notes.get('kit')).toMatch(/`r` \(2\.\.4\)/);
	});
});

// ---- 6.3 Constraints in their scope -----------------------------------------------------

const SCOPE = `package C {
  private import SI::*;
  part def Arm {
    attribute mass :> ISQ::mass default 50 [g];
    assert constraint light { mass <= 60 [g] }
  }
  part def HeavyArm :> Arm { attribute :>> mass default 80 [g]; }
  part def Craft {
    part a : Arm;
    part h : HeavyArm;
    part u : Arm { attribute :>> mass = 70 [g]; }
  }
  part craft : Craft;
  requirement def ArmMass {
    subject arm : Arm;
    require constraint { arm.mass <= 75 [g] }
  }
  requirement armReq : ArmMass;
  satisfy armReq by craft.a;
  satisfy armReq by craft.h;
  satisfy armReq by craft.u;
}
`;

describe('6.3 constraints evaluated for what they are about', () => {
	it('decides each `satisfy` claim with the subject bound to the claimed part', () => {
		const files = analyse(SCOPE);
		const claims = host.checks(files).checks.filter((c) => c.kind === 'satisfy');
		// a: 50 g ≤ 75 g met (margin 25 g); h: 80 g > 75 g not met (−5 g); u: 70 g ≤ 75 g met (5 g).
		expect(claims.map((c) => [c.by, c.status, c.margin?.value, c.span.start_row])).toEqual([
			['craft.a', 'satisfied', 25, 19],
			['craft.h', 'violated', -5, 20],
			['craft.u', 'satisfied', 5, 21]
		]);
		expect(claims[1]!.explanation).toBe('Not met: craft.h.mass = 80 g (needs ≤ 75 g).');
	});

	it('lists a violated claim as a problem at the claim, through the workspace', async () => {
		const workspace = await openWorkspace(host, project(SCOPE));
		await checked(workspace);
		const checks = workspace.problems.filter((p) => p.code === 'check');
		expect(checks.map((p) => [p.file, p.span.start_row, p.severity, p.message])).toEqual([
			['m.sysml', 20, 'warning', 'armReq is not met by craft.h: craft.h.mass = 80 g (needs ≤ 75 g)']
		]);
		// The span covers the claim's text, so Problems jumps to it.
		expect(SCOPE.slice(checks[0]!.span.from, checks[0]!.span.to)).toMatch(/craft\.h/);
		// Make h light enough: the problem goes, recalculated from the edited text.
		await analysed(workspace, () =>
			workspace.setText('m.sysml', SCOPE.replace('mass default 80 [g]', 'mass default 74 [g]'))
		);
		expect(workspace.problems.filter((p) => p.code === 'check')).toEqual([]);
	}, 30_000);

	// Known gap (critical, engine and app): an `assert constraint` in a definition is checked for
	// the definition's own values only. HeavyArm (80 g) and craft.u (70 g) break `mass <= 60 [g]`,
	// yet the one check reads "Met." for Arm and no violation is reported.
	it.fails('checks a definition’s assertion for the parts that redefine its values', () => {
		const files = analyse(SCOPE);
		const asserts = host.checks(files).checks.filter((c) => c.kind === 'assert');
		expect(asserts.some((c) => c.status === 'violated')).toBe(true);
	});
});
