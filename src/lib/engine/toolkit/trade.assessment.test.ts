/**
 * Assessment §6.3 (trade studies): alternatives with different parameter
 * values and units, scores ranked in one unit, values a variant inherits as
 * an expression, recalculation when the model changes through the
 * workspace (as the app edits it), and the same result from a fresh
 * analysis. Answers worked out by hand in the comments.
 *
 * A test kept as `it.fails` is a known gap: it flips when fixed.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { analysed, openWorkspace } from '#lib/create/testing.ts';
import type { TradeStudy } from '../types';
import type { ToolkitHost } from './host';
import { loadHost } from './testing';

let host: ToolkitHost;
beforeAll(async () => {
	host = await loadHost();
}, 60_000);

const project = (text: string) => [{ path: 'T.sysml', text }];

function studyOf(text: string): TradeStudy {
	const files = project(text);
	const analyses = host.analyzeProject(files);
	expect(analyses.flatMap((a) => [...a.model.syntax_errors, ...a.diagnostics])).toEqual([]);
	return host.tradeStudies(files)[0]!;
}

const scores = (s: TradeStudy) =>
	s.alternatives.map((a) => (a.score.kind === 'number' ? [a.score.value, a.score.unit] : null));

/** A study whose score is a mass, minimized; the packs' masses are given in different units. */
const MASSES = (c = '450 [g]') => `package T {
  private import ScalarValues::Real;
  private import SI::*;
  private import TradeStudies::*;
  part def Pack { attribute mass :> ISQ::mass; attribute price : Real; }
  variation part options : Pack {
    variant part a : Pack { attribute :>> mass = 0.6 [kg]; attribute :>> price = 10.0; }
    variant part b : Pack { attribute :>> mass = 500 [g]; attribute :>> price = 20.0; }
    variant part c : Pack { attribute :>> mass = ${c}; attribute :>> price = 30.0; }
  }
  analysis study : TradeStudy {
    subject : Pack[3] = (options::a, options::b, options::c);
    objective : MinimizeObjective;
    calc :>> evaluationFunction {
      in part p :>> alternative : Pack;
      attribute withCase :> ISQ::mass = p.mass + 100 [g];
      attribute price : Real = p.price;
      return :>> result = p.mass;
    }
    return part :>> selectedAlternative : Pack;
  }
}
`;

describe('6.3 alternatives whose values come in different units', () => {
	it('ranks scores in one unit', () => {
		const s = studyOf(MASSES());
		// a = 0.6 kg = 600 g, b = 500 g, c = 450 g; minimize: c (450) < b (500) < a (600).
		expect(scores(s)).toEqual([
			[0.6, 'kg'],
			[500, 'g'],
			[450, 'g']
		]);
		expect(s.alternatives.map((a) => a.rank)).toEqual([3, 2, 1]);
		expect(s.selected).toBe(2);
		// A criterion in mixed units: 0.6 kg + 100 g = 0.7 kg = 700 g; 600 g; 550 g, shown in one unit.
		const withCase = s.criteria.find((c) => c.name === 'withCase')!;
		expect(withCase.values).toEqual([
			{ kind: 'number', value: 0.7, unit: 'kg' },
			{ kind: 'number', value: 600, unit: 'g' },
			{ kind: 'number', value: 550, unit: 'g' }
		]);
		expect(withCase.shown).toEqual(['700 g', '600 g', '550 g']);
	});

	it('never selects by comparing numbers in units it cannot convert', () => {
		// c = 7000 grain = 7000 × 64.79891 mg = 453.59 g: the lightest. The table's units don't
		// know the grain, so it must not compare 7000 with 500 and 0.6 as plain numbers.
		const s = studyOf(MASSES('7000 [USCustomaryUnits::gr]'));
		expect(s.selected === 2 || (s.selected === null && /unit/.test(s.note ?? ''))).toBe(true);
		// withCase for c: 7000 gr + 100 g is 8543.2 gr; never 7100 gr (the numbers added as they are).
		const c = s.criteria.find((x) => x.name === 'withCase')!.values[2]!;
		if (c.kind === 'number') expect(c.value * (c.unit === 'gr' ? 0.06479891 : 1)).toBeCloseTo(553.59, 1);
		else expect(c.kind).toBe('undecided');
	});

	// Known gap: the grain (and other library units outside the table's list) don't convert, so
	// such a study selects nothing rather than the lightest pack.
	it.fails('selects the lightest pack when one mass is given in grains', () => {
		const s = studyOf(MASSES('7000 [USCustomaryUnits::gr]'));
		expect(s.selected).toBe(2);
	});
});

/** Variants that inherit `mass = cells * cellMass` and redefine its inputs. */
const DERIVED = `package D {
  private import ScalarValues::Real;
  private import SI::*;
  private import TradeStudies::*;
  part def Pack {
    attribute cells : Real default 4.0;
    attribute cellMass :> ISQ::mass default 50 [g];
    attribute mass :> ISQ::mass = cells * cellMass;
    attribute price : Real default 100.0;
  }
  variation part options : Pack {
    variant part four : Pack;
    variant part six : Pack { attribute :>> cells = 6.0; }
    variant part light : Pack {
      attribute :>> cells = 6.0;
      attribute :>> cellMass = 30 [g];
      attribute :>> price = 400.0;
    }
  }
  analysis study : TradeStudy {
    subject : Pack[3] = (options::four, options::six, options::light);
    objective : MaximizeObjective;
    calc :>> evaluationFunction {
      in part p :>> alternative : Pack;
      attribute packMass :> ISQ::mass = p.mass;
      attribute massScore : Real = (400 [g] - packMass) / 400 [g];
      attribute priceScore : Real = (500 - p.price) / 500;
      return :>> result : Real = 0.6 * massScore + 0.4 * priceScore;
    }
    return part :>> selectedAlternative : Pack;
  }
  view tradeTable : ModelViews::TradeStudyTable { expose D::study; }
}
`;

describe('6.3 alternatives with different parameter values', () => {
	it('works out each alternative’s inherited values with its own parameters', () => {
		const s = studyOf(DERIVED);
		// four: 4 × 50 g = 200 g; six: 6 × 50 g = 300 g; light: 6 × 30 g = 180 g.
		expect(s.criteria.find((c) => c.name === 'packMass')!.shown).toEqual(['200 g', '300 g', '180 g']);
		// massScore = (400 − m) / 400: 0.5, 0.25, 0.55. priceScore = (500 − price) / 500: 0.8, 0.8, 0.2.
		// score = 0.6 × massScore + 0.4 × priceScore: 0.62, 0.47, 0.41 → four is selected.
		expect(scores(s).map((x) => Number((x![0] as number).toFixed(6)))).toEqual([0.62, 0.47, 0.41]);
		expect(s.selected).toBe(0);
		expect(s.criteria.find((c) => c.name === 'massScore')).toMatchObject({ weight: 0.6, better: 'higher' });
		expect(s.criteria.find((c) => c.name === 'priceScore')).toMatchObject({ weight: 0.4, better: 'higher' });
	});

	it('gives the same study from a fresh analysis (reproducible)', () => {
		const first = JSON.stringify(studyOf(DERIVED));
		studyOf(MASSES());
		expect(JSON.stringify(studyOf(DERIVED))).toBe(first);
	});

	it('recalculates the table when the model changes in the workspace, and back on undo', async () => {
		const workspace = await openWorkspace(host, project(DERIVED));
		await analysed(workspace, () => {});
		const table = () => host.renderView(workspace.sourceFiles(), 'D::tradeTable');
		const before = table();
		expect(before.rows.find((r) => r[0] === 'score')).toEqual(['score', '', '0.62', '0.47', '0.41']);
		expect(before.trade?.selected).toBe(0);
		// The light pack's price drops to 100 (set as the inspector sets a value, one undoable step):
		// priceScore 0.8, score 0.6 × 0.55 + 0.4 × 0.8 = 0.65 → light wins.
		const source = workspace.text('T.sysml')!;
		const error = await analysed(workspace, () =>
			workspace.transact('Set price', () =>
				workspace.edit('T.sysml', {
					op: 'setDeclaration',
					path: 'T.sysml',
					source,
					element: 'price',
					line: source.split('\n').findIndex((l) => l.includes('price = 400.0')) + 1,
					set: { value: '100.0' }
				})
			)
		);
		expect(error).toBeNull();
		expect(workspace.text('T.sysml')).toContain('attribute :>> price = 100.0;');
		const after = table();
		expect(after.rows.find((r) => r[0] === 'score')).toEqual(['score', '', '0.62', '0.47', '0.65']);
		expect(after.rows.find((r) => r[0] === 'rank')).toEqual(['rank', '', '2', '3', '1']);
		expect(after.trade?.selected).toBe(2);
		await analysed(workspace, () => workspace.undo());
		expect(table().trade?.selected).toBe(0);
	});
});
