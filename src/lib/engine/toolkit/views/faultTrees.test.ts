/**
 * Fault trees and the reliability budget read from SysML, in Node against
 * the real toolkit: the libraries (`FaultTreeAnalysis`, `Reliability`)
 * parse cleanly, the demo's fault tree and reliability budget come to the
 * numbers worked out by hand below, a textbook tree with a repeated event
 * gives its exact probability, and a top event or a system that fails too
 * often is a problem.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SourceFile } from '../../protocol';
import type { RenderedTable } from '../../types';
import type { ToolkitHost } from '../host';
import { demoFiles, loadHost } from '../testing';

let host: ToolkitHost;
beforeAll(async () => {
	host = await loadHost();
});

const LIBRARIES = resolve(import.meta.dirname, '../../../../demo/drone/libraries');
const library = (name: string): SourceFile => ({
	path: `libraries/${name}.sysml`,
	text: readFileSync(join(LIBRARIES, `${name}.sysml`), 'utf8')
});
const risk = () => ['HazardAnalysis', 'Reliability', 'FaultTreeAnalysis', 'Reporting'].map(library);

const col = (t: RenderedTable, name: string) => {
	const i = t.columns.indexOf(name);
	if (i < 0) throw new Error(`no column ${name} in ${t.columns.join(', ')}`);
	return t.rows.map((r) => r[i]!);
};
const record = (t: RenderedTable, row: number) =>
	Object.fromEntries(t.columns.map((c, i) => [c, t.rows[row]![i]!]));

/** The demo with one file's text changed. */
function demoWith(path: string, from: string, to: string): SourceFile[] {
	return demoFiles().map((f) => {
		if (f.path !== path) return f;
		if (!f.text.includes(from)) throw new Error(`${path} has no ${from}`);
		return { ...f, text: f.text.replace(from, to) };
	});
}

describe('the libraries', () => {
	it('parse and resolve without errors', () => {
		const analyses = host.analyzeProject(risk());
		for (const a of analyses) {
			expect(a.model.syntax_errors, a.model.file).toEqual([]);
			expect(
				a.diagnostics.filter((d) => d.severity === 'error'),
				a.model.file
			).toEqual([]);
		}
		const views = host.listViews(risk()).map((v) => v.name);
		expect(views).toEqual(
			expect.arrayContaining([
				'ReliabilityBudget',
				'FaultTreeDiagram',
				'FaultTreeSummary',
				'MinimalCutSets',
				'BasicEventImportance'
			])
		);
	});
});

describe('a textbook tree with a repeated event', () => {
	// TOP = (A + B)·(A + C) = A + B·C, every p = 0.1: exactly 0.109, where multiplying
	// through the gates gives 0.19² = 0.0361.
	const tree = (extra = '') => [
		...risk(),
		{
			path: 't.sysml',
			text: `package T {
	private import HazardAnalysis::*;
	private import FaultTreeAnalysis::*;
	occurrence top : TopEvent { :>> gate = GateKind::'and'; :>> tolerableProbability = 0.2; }
	occurrence g1 : IntermediateEvent { :>> gate = GateKind::'or'; }
	occurrence g2 : IntermediateEvent { :>> gate = GateKind::'or'; }
	occurrence a : BasicEvent { :>> probability = 0.1; }
	occurrence b : BasicEvent { :>> probability = 0.1; }
	occurrence c : BasicEvent { :>> probability = 0.1; }
	connection : Causation connect g1 to top;
	connection : Causation connect g2 to top;
	connection : Causation connect a to g1;
	connection : Causation connect b to g1;
	connection : Causation connect a to g2;
	connection : Causation connect c to g2;
	${extra}
	view summary : FaultTreeSummary;
	view cuts : MinimalCutSets;
	view importance : BasicEventImportance;
}`
		}
	];

	it('has the cut sets {a} and {b, c} and the exact probability', () => {
		const files = tree();
		const summary = host.renderView(files, 'summary');
		expect(record(summary, 0)).toMatchObject({
			topEvent: 'top',
			probability: '0.109',
			upperBound: '0.109',
			tolerable: '0.2',
			check: 'satisfied',
			cutSets: '2',
			smallestCutSet: '1'
		});
		const cuts = host.renderView(files, 'cuts');
		expect(col(cuts, 'events')).toEqual(['a', 'b and c']);
		expect(col(cuts, 'probability')).toEqual(['0.1', '0.01']);
		// Shares of 0.109: 0.1 / 0.109 and 0.01 / 0.109.
		expect(col(cuts, 'share')).toEqual(['92 %', '9.2 %']);
		const importance = host.renderView(files, 'importance');
		expect(col(importance, 'event')).toEqual(['a', 'b', 'c']);
		// Birnbaum: 1 − 0.01 for a, 0.19 − 0.1 for b and c.
		expect(col(importance, 'birnbaum')).toEqual(['0.99', '0.09', '0.09']);
		expect(col(importance, 'fussellVesely')).toEqual(['92 %', '9.2 %', '9.2 %']);
	});

	it('is a problem when more likely than it may be', () => {
		const files = tree().map((f) =>
			f.path === 't.sysml'
				? { ...f, text: f.text.replace('tolerableProbability = 0.2', 'tolerableProbability = 0.1') }
				: f
		);
		expect(record(host.renderView(files, 'summary'), 0)).toMatchObject({
			check: 'violated',
			margin: '-0.009 (-9 %)'
		});
		const violated = host.checks(files).checks.filter((c) => c.status === 'violated');
		expect(violated.map((c) => c.problem)).toEqual([
			'The top event top has a probability of 0.109, more than the 0.1 it may have (its tolerableProbability).'
		]);
		expect(violated[0]).toMatchObject({ file: 't.sysml', span: { start_row: 4 } });
	});

	it('says why it cannot be worked out', () => {
		const files = tree('occurrence d : BasicEvent;\n\tconnection : Causation connect d to g2;');
		expect(record(host.renderView(files, 'summary'), 0)).toMatchObject({
			probability: '',
			check: 'undecided'
		});
		const undecided = host.checks(files).checks.filter((c) => c.name === 'the fault tree of top');
		expect(undecided).toHaveLength(1);
		expect(undecided[0]).toMatchObject({ status: 'undecided', undecided: 'open' });
		expect(undecided[0]!.explanation).toBe(
			'`d` has no probability and no failure rate (nor a component with one).'
		);
	});

	it('takes k of n, and a probability from a failure rate over the exposure time', () => {
		const files = [
			...risk(),
			{
				path: 'v.sysml',
				text: `package V {
	private import SI::*;
	private import HazardAnalysis::*;
	private import FaultTreeAnalysis::*;
	private import Reliability::FIT;
	occurrence top : TopEvent { :>> gate = GateKind::atLeast; :>> k = 2; :>> exposureTime = 1000 [h]; }
	occurrence a : BasicEvent { :>> failureRate = 100000 [FIT]; }
	occurrence b : BasicEvent { :>> failureRate = 1E-4 [h^-1]; }
	occurrence c : BasicEvent { :>> failureRate = 100000 [FIT]; :>> exposureTime = 1000 [h]; }
	connection : Causation connect a to top;
	connection : Causation connect b to top;
	connection : Causation connect c to top;
	view summary : FaultTreeSummary;
	view importance : BasicEventImportance;
}`
			}
		];
		// Each p = 1 − e^(−10⁻⁴ · 1000) = 0.0951626; two of three: 3p²(1 − p) + p³ = 0.0254.
		expect(record(host.renderView(files, 'summary'), 0)).toMatchObject({
			probability: '0.0254',
			cutSets: '3'
		});
		const importance = host.renderView(files, 'importance');
		expect(col(importance, 'probability')).toEqual(['0.0952', '0.0952', '0.0952']);
	});
});

describe('the demo', () => {
	// Per 30-minute flight, p ≈ λt: motors 8000 FIT → 4E-6, blades and speed controllers
	// 2000 FIT → 1E-6 each, the board its component's 1000 FIT → 5E-7, the lock-up 1E-6,
	// low charge and no return 0.02 · 5E-5 = 1E-6: 8.5E-6 in all, under the 1E-5 the policy
	// allows for a critical harm (impactInjury).
	it('works out the fault tree of uncontrolled descent', () => {
		const files = demoFiles();
		const summary = host.renderView(files, 'faultTreeSummary');
		expect(summary.rows).toHaveLength(1);
		expect(record(summary, 0)).toEqual({
			topEvent: 'droneFalls',
			hazard: 'uncontrolledDescent',
			probability: '8.5E-6',
			upperBound: '8.5E-6',
			tolerable: '1E-5',
			margin: '1.5E-6 (15 %)',
			check: 'satisfied',
			cutSets: '6',
			smallestCutSet: '1'
		});
		const cuts = host.renderView(files, 'droneFallsCutSets');
		// The board's failure is under two gates: one cut set, not two.
		expect(col(cuts, 'events')).toEqual([
			'motorStops',
			'lowCharge and returnNotTriggered',
			'controllerLockUp',
			'bladeBreaks',
			'escCutsOut',
			'boardFails'
		]);
		expect(col(cuts, 'share')[0]).toBe('47 %');
		const importance = host.renderView(files, 'droneFallsImportance');
		expect(record(importance, 0)).toMatchObject({
			event: 'motorStops',
			component: 'drone.rotors.motor',
			failureMode: 'Motor stops or loses torque',
			probability: '4E-6',
			fussellVesely: '47 %',
			inFmea: 'yes'
		});
		// The board takes its component's failure rate.
		const board = importance.rows.findIndex((r) => r[1] === 'boardFails');
		expect(record(importance, board)).toMatchObject({ probability: '5E-7', inFmea: '' });
		expect(importance.rowInfo?.[board]?.notes?.[4]).toBe(
			'1000 FIT (drone.powerDistribution) over 30 min'
		);
	});

	it('draws the tree of the top event the view exposes', () => {
		const [tree, ...others] = host.faultTrees(demoFiles(), 'droneFallsTree');
		expect(others).toEqual([]);
		expect(tree!.events.map((e) => [e.name, e.kind, e.gate ?? null])).toEqual([
			['droneFalls', 'top', 'or'],
			['lossOfThrust', 'intermediate', 'or'],
			['motorStops', 'basic', null],
			['bladeBreaks', 'basic', null],
			['escCutsOut', 'basic', null],
			['boardFails', 'basic', null],
			['lossOfControl', 'intermediate', 'or'],
			['controllerLockUp', 'basic', null],
			['batteryRunsFlat', 'intermediate', 'and'],
			['lowCharge', 'basic', null],
			['returnNotTriggered', 'basic', null]
		]);
		expect(tree!.probability).toBeCloseTo(8.5e-6, 9);
		const flat = tree!.events.find((e) => e.name === 'batteryRunsFlat')!;
		expect(flat.probability).toBeCloseTo(1e-6, 12);
		expect(tree!.status).toBe('satisfied');
	});

	it('flags the top event when its hazard allows less', () => {
		// The harm made catastrophic: the policy allows 1E-6.
		const files = demoWith(
			'risk/DesignFmea.sysml',
			`occurrence impactInjury : Harm {
        :>> description = "A person on the ground is hit by the falling drone or parcel.";
        :>> severity = SeverityScale::critical;`,
			`occurrence impactInjury : Harm {
        :>> description = "A person on the ground is hit by the falling drone or parcel.";
        :>> severity = SeverityScale::catastrophic;`
		);
		const problems = host
			.checks(files)
			.checks.filter((c) => c.status === 'violated' && c.file === 'risk/FaultTree.sysml');
		expect(problems.map((c) => c.problem)).toEqual([
			'The top event droneFalls has a probability of 8.5E-6 over 30 min, more than the 1E-6 it may have (TolerableProbability for impactInjury, catastrophic (10)).'
		]);
	});

	// 2000 + 50000 + 1000 + 4 × (5000 + 20000 + 10000) + 4000 + 3000 + 3000 + 4000 + 8000
	// = 215000 FIT, so MTBF = 10⁹ / 215000 = 4651 h, 2651 h (133 %) over the 2000 h asked.
	it('adds up the reliability budget against the requirement', () => {
		const files = demoFiles();
		const budget = host.renderView(files, 'droneReliabilityBudget');
		expect(record(budget, 0)).toMatchObject({
			path: 'drone',
			total: '215000 FIT',
			mtbf: '4651 h',
			limit: '≥ 2000 h',
			margin: '2651 h (133 %)',
			check: 'satisfied'
		});
		expect(record(budget, 4)).toMatchObject({
			path: 'drone.frontLeft',
			total: '35000 FIT',
			mtbf: '28571 h'
		});
		// The claim is decided once, by the budget, not left undecided as words.
		const claims = host.checks(files).checks.filter((c) => c.requirement?.id === 'REL-001');
		expect(claims).toHaveLength(1);
		expect(claims[0]).toMatchObject({ kind: 'satisfy', status: 'satisfied', by: 'drone' });
		const requirements = host.renderView(files, 'RequirementsTable');
		const rel = requirements.rows.findIndex((r) => r[0] === 'REL-001');
		expect(record(requirements, rel)).toMatchObject({ check: 'satisfied' });
	});

	it('is a problem when the system fails more often than the requirement allows', () => {
		const files = demoWith(
			'analysis/Reliability.sysml',
			':>> minimumMtbf = 2000 [h];',
			':>> minimumMtbf = 5000 [h]; :>> maximumFailureRate = 3E-4 [h^-1];'
		);
		const budget = host.renderView(files, 'droneReliabilityBudget');
		// 215000 FIT is 2.15E-4 per hour, inside 3E-4 (28 % margin); the MTBF, 4651 h, is
		// 349 h (7 %) short of 5000 h: the tighter of the two shows.
		expect(record(budget, 0)).toMatchObject({
			limit: '≥ 5000 h',
			margin: '-348.8 h (-7 %)',
			check: 'violated'
		});
		const claim = host.checks(files).checks.find((c) => c.requirement?.id === 'REL-001')!;
		expect(claim.problem).toBe(
			"REL-001 Drone reliability is not met by drone: `drone`'s parts' failure rates add up to 215000 FIT in series, an MTBF of 4651 h; it asks for a failure rate ≤ 0.0003 h^-1 and an MTBF ≥ 5000 h."
		);
	});
});
