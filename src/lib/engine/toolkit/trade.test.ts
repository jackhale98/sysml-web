/**
 * Trade studies (`trade.ts`) on the demo and on small models: criteria,
 * scores, weights, the ranking, the selection by a maximize or minimize
 * objective, ties, and the alternative the design uses; and the trade
 * study table.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { SourceFile } from '../protocol';
import { tradeExport } from '../tradeExport';
import type { TradeStudy } from '../types';
import { fromJson } from './evaluation';
import type { ToolkitHost } from './host';
import { demoFiles, loadHost } from './testing';

let host: ToolkitHost;
const files = demoFiles();
const TRADE = 'analysis/BatteryTrade.sysml';
const edit = (from: string, to: string): SourceFile[] =>
	files.map((f) => {
		if (f.path !== TRADE) return f;
		expect(f.text).toContain(from);
		return { ...f, text: f.text.replace(from, to) };
	});

beforeAll(async () => {
	host = await loadHost();
}, 60_000);

const numbers = (study: TradeStudy) =>
	study.alternatives.map((a) =>
		a.score.kind === 'number' ? Number(a.score.value.toFixed(4)) : null
	);
const criterion = (study: TradeStudy, name: string) => study.criteria.find((c) => c.name === name)!;

describe('the demo’s battery trade study', () => {
	it('compares today’s battery with three candidate packs', () => {
		host.analyzeProject(files);
		const [study, ...others] = host.tradeStudies(files);
		expect(others).toEqual([]);
		expect(study).toMatchObject({
			name: 'batteryTradeStudy',
			qualifiedName: 'BatteryTrade::batteryTradeStudy',
			file: TRADE,
			objective: 'maximize',
			note: null
		});
		expect(study!.alternatives.map((a) => [a.label, a.name, a.qualifiedName])).toEqual([
			['drone.battery', 'drone.battery', 'DroneArchitecture::drone::battery'],
			[
				'batteryOptions::lithiumPolymer',
				'lithiumPolymer',
				'BatteryTrade::batteryOptions::lithiumPolymer'
			],
			[
				'batteryOptions::lithiumIon3P',
				'lithiumIon3P',
				'BatteryTrade::batteryOptions::lithiumIon3P'
			],
			[
				'batteryOptions::semiSolidState',
				'semiSolidState',
				'BatteryTrade::batteryOptions::semiSolidState'
			]
		]);
		// Today's battery is a part of the design.
		expect(study!.current).toBe(0);
	});

	it('works out each criterion for each pack, with units', () => {
		const [study] = host.tradeStudies(files);
		expect(study!.criteria.map((c) => c.name)).toEqual([
			'takeOffMass',
			'hoverPower',
			'endurance',
			'massMargin',
			'price'
		]);
		// 2.67 kg without a battery + the pack + 1 kg payload.
		expect(criterion(study!, 'takeOffMass').shown).toEqual([
			'3.77 kg',
			'3.92 kg',
			'4.15 kg',
			'3.67 kg'
		]);
		// 400 W × (m / 3.77 kg)^1.5.
		expect(criterion(study!, 'hoverPower').shown).toEqual(['400 W', '424.1 W', '462 W', '384.2 W']);
		// Usable energy (the variant's capacity × its usable fraction) / hover power.
		expect(criterion(study!, 'endurance').shown).toEqual([
			'27.54 min',
			'25.13 min',
			'35.77 min',
			'36.54 min'
		]);
		expect(criterion(study!, 'massMargin').shown).toEqual(['230 g', '80 g', '-150 g', '330 g']);
		expect(criterion(study!, 'price').shown).toEqual(['420', '260', '560', '1150']);
		expect(study!.criteria.every((c) => c.values.every((v) => v.kind === 'number'))).toBe(true);
	});

	it('weighs the criteria the score reads, and knows which way each is better', () => {
		const [study] = host.tradeStudies(files);
		const of = (name: string) => {
			const c = criterion(study!, name);
			return [
				c.weight,
				c.better,
				c.best,
				c.scores?.map((s) => (s === null ? null : Number(s.toFixed(3))))
			];
		};
		expect(of('endurance')).toEqual([0.5, 'higher', [3], [0.169, 0.008, 0.718, 0.77]]);
		expect(of('massMargin')).toEqual([0.2, 'higher', [3], [0.46, 0.16, -0.3, 0.66]]);
		expect(of('price')).toEqual([0.3, 'lower', [1], [0.72, 0.827, 0.627, 0.233]]);
		// Values the score doesn't read directly are shown without a verdict.
		expect(of('takeOffMass')).toEqual([null, null, [], undefined]);
		expect(of('hoverPower')).toEqual([null, null, [], undefined]);
	});

	it('selects the semi-solid-state pack, ahead of today’s', () => {
		const [study] = host.tradeStudies(files);
		// The three-cell pack puts the drone over 4 kg: it scores 0.
		expect(numbers(study!)).toEqual([0.3927, 0.2842, 0, 0.5868]);
		expect(study!.alternatives.map((a) => a.rank)).toEqual([2, 3, 4, 1]);
		expect(study!.best).toEqual([3]);
		expect(study!.selected).toBe(3);
		// The toolkit can't evaluate the evaluation function's attributes nor select: the app does.
		expect(study!.byApp).toMatch(/attributes.*scores.*selected/);
	});

	it('changes its choice when a pack’s values change', () => {
		// At 2500 euros the semi-solid-state pack falls behind today's.
		const edited = edit('attribute :>> price = 1150.0;', 'attribute :>> price = 2500.0;');
		host.analyzeProject(edited);
		const [study] = host.tradeStudies(edited);
		expect(numbers(study!)).toEqual([0.3927, 0.2842, 0, 0.3168]);
		expect(study!.selected).toBe(0);
		expect(study!.selected).toBe(study!.current);
		host.analyzeProject(files);
	});

	it('exports as data: the objective, the packs’ own values, every digit', () => {
		const [study] = host.tradeStudies(files);
		const { header, rows } = tradeExport(study!);
		expect(header).toEqual([
			'Kind',
			'Name',
			'Unit',
			'Weight',
			'Better',
			'drone.battery',
			'lithiumPolymer',
			'lithiumIon3P',
			'semiSolidState'
		]);
		const row = (name: string) => rows.find((r) => r[1] === name)!;
		expect(rows[0]).toEqual([
			'objective',
			'maximize score = BatteryScore(endurance, massMargin, price)',
			'',
			'',
			'higher',
			'',
			'',
			'',
			''
		]);
		// The table shows 25.13 min, 35.77 min…; the export has every digit (15 significant).
		expect(row('endurance')).toEqual([
			'criterion',
			'endurance',
			'min',
			'0.5',
			'higher',
			'27.54',
			'25.1256407152485',
			'35.768034455437',
			'36.5443334848328'
		]);
		expect(row('score').slice(5)).toEqual([
			'0.392666666666667',
			'0.284188023841617',
			'0',
			'0.586811116161092'
		]);
		expect(row('rank')).toEqual(['rank', 'rank', '', '', '', '2', '3', '4', '1']);
		expect(row('selected')).toEqual([
			'selection',
			'selected',
			'',
			'',
			'',
			'in the design',
			'',
			'',
			'selected'
		]);
		// The inputs: each pack's own values, as its definition orders them.
		expect(rows.filter((r) => r[0] === 'input')).toEqual([
			['input', 'mass', 'g', '', '', '1100', '1250', '1480', '1000'],
			['input', 'nominalVoltage', 'V', '', '', '21.6', '22.2', '21.6', '21.6'],
			['input', 'capacity', 'W·h', '', '', '216', '222', '324', '260'],
			['input', 'usableFraction', '', '', '', '0.85', '0.8', '0.85', '0.9'],
			['input', 'usableEnergy', 'W·h', '', '', '183.6', '177.6', '275.4', '234'],
			['input', 'price', '', '', '', '420', '260', '560', '1150']
		]);
	});

	it('renders as a table: a row per criterion, a column per alternative', () => {
		host.analyzeProject(files);
		const table = host.renderView(files, 'batteryTrade');
		expect(table.columns).toEqual([
			'criterion',
			'weight',
			'drone.battery',
			'lithiumPolymer',
			'lithiumIon3P',
			'semiSolidState'
		]);
		expect(table.rows.map((r) => r[0])).toEqual([
			'takeOffMass',
			'hoverPower',
			'endurance',
			'massMargin',
			'price',
			'score',
			'rank'
		]);
		expect(table.rows[2]).toEqual([
			'endurance',
			'50 %',
			'27.54 min',
			'25.13 min',
			'35.77 min',
			'36.54 min'
		]);
		expect(table.rows.at(-2)).toEqual(['score', '', '0.3927', '0.2842', '0', '0.5868']);
		expect(table.rows.at(-1)).toEqual(['rank', '', '2', '3', '4', '1']);
		expect(table.sources[2]).toEqual({
			element: 'BatteryTrade::batteryTradeStudy::evaluationFunction::endurance',
			file: TRADE,
			line: 86
		});
		expect(table.rowInfo?.at(-1)).toEqual({ role: 'total' });
		expect(table.trade?.selected).toBe(3);
		expect(table.warnings).toEqual([]);
	});
});

// ---- Small models ----------------------------------------------------------------

/** The specification's engine trade study, with values: the engines are variants. */
const ENGINES = (objective: string, cost6 = '4200.0') => `package Engines {
    private import ScalarValues::Real;
    private import ISQ::*;
    private import SI::*;
    private import TradeStudies::*;

    part def Engine {
        attribute mass :> ISQ::mass;
        attribute power :> ISQ::power;
        attribute cost : Real;
    }
    variation part engineChoice : Engine {
        variant part engine4cyl : Engine {
            attribute :>> mass = 120 [kg];
            attribute :>> power = 90 [kW];
            attribute :>> cost = 3000.0;
        }
        variant part engine6cyl : Engine {
            attribute :>> mass = 160 [kg];
            attribute :>> power = 135 [kW];
            attribute :>> cost = ${cost6};
        }
    }
    part vehicle {
        part wheels;
    }

    analysis engineTradeStudy : TradeStudy {
        subject : Engine[2] = (engineChoice::engine4cyl, engineChoice::engine6cyl);
        objective : ${objective};
        calc :>> evaluationFunction {
            in part anEngine :>> alternative : Engine;
            attribute specificPower = anEngine.power / anEngine.mass;
            attribute cost : Real = anEngine.cost;
            return :>> result : Real = cost / 1000;
        }
        return part :>> selectedAlternative : Engine;
    }
}
`;

const study = (text: string) => {
	const project = [{ path: 'Engines.sysml', text }];
	const analyses = host.analyzeProject(project);
	expect(analyses.flatMap((a) => [...a.model.syntax_errors, ...a.diagnostics])).toEqual([]);
	return { study: host.tradeStudies(project)[0]!, project };
};

describe('small trade studies', () => {
	it('selects the lowest score for a MinimizeObjective, as the toolkit evaluates it', () => {
		const { study: s } = study(ENGINES('MinimizeObjective'));
		expect(s.objective).toBe('minimize');
		expect(s.alternatives.map((a) => a.name)).toEqual(['engine4cyl', 'engine6cyl']);
		expect(numbers(s)).toEqual([3, 4.2]);
		expect(s.alternatives.map((a) => a.rank)).toEqual([1, 2]);
		expect(s.selected).toBe(0);
		expect(s.current).toBeNull();
		// The toolkit evaluates `engineTradeStudy.evaluationFunction(engineChoice::engine4cyl)` itself.
		expect(s.byApp).not.toMatch(/scores/);
		// `specificPower`: kW / kg, in the unit it comes in.
		expect(criterion(s, 'specificPower').values[0]).toMatchObject({ kind: 'number' });
		expect(criterion(s, 'cost')).toMatchObject({
			shown: ['3000', '4200'],
			better: 'lower',
			best: [0]
		});
	});

	it('selects the highest score for a MaximizeObjective', () => {
		const { study: s } = study(ENGINES('MaximizeObjective'));
		expect(s.objective).toBe('maximize');
		expect(s.selected).toBe(1);
		expect(s.alternatives.map((a) => a.rank)).toEqual([2, 1]);
		expect(criterion(s, 'cost')).toMatchObject({ better: 'higher', best: [1] });
	});

	it('finds the alternative a part of the design is bound to', () => {
		const { study: s } = study(
			ENGINES('MaximizeObjective').replace(
				'part wheels;',
				'part wheels;\n        ref part engine : Engine = engineChoice::engine6cyl;'
			)
		);
		expect(s.current).toBe(1);
	});

	it('scores alternatives declared in a package, which the toolkit leaves undecided', () => {
		// As the specification's training example writes them. The toolkit 0.10 doesn't evaluate a
		// part declared directly in a package from elsewhere (docs/engine.md): the app does.
		const text = ENGINES('MinimizeObjective')
			.replace('variation part engineChoice : Engine {', '')
			.replace('variant part engine4cyl', 'part engine4cyl')
			.replace('variant part engine6cyl', 'part engine6cyl')
			.replace(/(attribute :>> cost = 4200.0;\n {8}\})\n {4}\}/, '$1')
			.replace('(engineChoice::engine4cyl, engineChoice::engine6cyl)', '(engine4cyl, engine6cyl)');
		const { study: s } = study(text);
		expect(numbers(s)).toEqual([3, 4.2]);
		expect(s.selected).toBe(0);
		expect(s.byApp).toMatch(/scores/);
	});

	it('selects nothing on a tie', () => {
		const { study: s } = study(ENGINES('MaximizeObjective', '3000.0'));
		expect(numbers(s)).toEqual([3, 3]);
		expect(s.alternatives.map((a) => a.rank)).toEqual([1, 1]);
		expect(s.best).toEqual([0, 1]);
		expect(s.selected).toBeNull();
		expect(s.note).toBe(
			'engine4cyl and engine6cyl have the same score: the objective doesn’t decide between them.'
		);
		expect(criterion(s, 'cost').best).toEqual([]);
	});

	it('reads weights from a weighted sum in the result', () => {
		const text = ENGINES('MaximizeObjective').replace(
			'return :>> result : Real = cost / 1000;',
			'attribute powerScore : Real = anEngine.power / 150 [kW];\n' +
				'            attribute costScore : Real = (5000 - cost) / 5000;\n' +
				'            return :>> result : Real = 0.7 * powerScore + 0.3 * costScore;'
		);
		const { study: s } = study(text);
		// 0.7 × 90/150 + 0.3 × 2000/5000 = 0.54; 0.7 × 135/150 + 0.3 × 800/5000 = 0.678.
		expect(numbers(s)).toEqual([0.54, 0.678]);
		expect(s.selected).toBe(1);
		expect(criterion(s, 'powerScore')).toMatchObject({ weight: 0.7, better: 'higher' });
		expect(criterion(s, 'costScore')).toMatchObject({ weight: 0.3, better: 'higher' });
		expect(criterion(s, 'cost')).toMatchObject({ weight: null, better: null });
	});

	it('says why nothing is selected without an objective of a known kind', () => {
		const { study: s } = study(
			ENGINES('MaximizeObjective').replace('objective : MaximizeObjective;', '')
		);
		expect(s.objective).toBeNull();
		expect(s.selected).toBeNull();
		expect(s.note).toMatch(/MaximizeObjective or a MinimizeObjective/);
	});

	it('leaves the selection to the app while the toolkit doesn’t evaluate selectedAlternative', () => {
		// When this fails, the toolkit evaluates `TradeStudy::selectedAlternative` (a `selectOne`
		// over the objective invoked as a predicate): take the selection from it.
		const { study: s, project } = study(ENGINES('MinimizeObjective'));
		const records = host.analyzeProject(project)[0]!.model.usages;
		const selected = records.find((u) => u.name === 'selectedAlternative');
		const id = selected?.id;
		if (id)
			expect(host.evaluate(project, [id])[id]).not.toMatchObject({
				kind: 'text',
				text: 'engine4cyl'
			});
		expect(s.byApp).toMatch(/selected alternative/);
	});
});

describe('the toolkit’s values', () => {
	it('reads an exact fraction as its number', () => {
		const fraction = { '@rational': '6393600/4241', approx: 1507.5689695826457 };
		expect(fromJson(JSON.stringify({ unit: 's', value: fraction }), 'x')).toEqual({
			kind: 'number',
			value: 1507.5689695826457,
			unit: 's'
		});
		expect(fromJson(JSON.stringify(fraction), 'x')).toMatchObject({ kind: 'number', unit: null });
	});
});
