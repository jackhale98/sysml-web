/**
 * The uncertainty library a project gets, and the SysML that gives a value
 * a distribution: written into a model, the check on the value says how
 * often it is met.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import { loadHost } from '#lib/engine/toolkit/testing.ts';
import { write } from './apply';
import { analysed, openWorkspace, problemsOf } from './testing';
import {
	distributionText,
	missingUncertaintyLibrary,
	UNCERTAINTY_LIBRARY,
	type DistributionSpec
} from './uncertaintyLibrary';

let host: ToolkitHost;
beforeAll(async () => {
	host = await loadHost();
}, 60_000);

const scale = (inside: string) => ({
	path: 'Scale.sysml',
	text: `package Scale {
    private import ISQ::*;
    private import SI::*;
    part def Load {
        attribute m :> mass = 1.1 [kg] {
            ${inside}
        }
        assert constraint light { m <= 1.104 [kg] }
    }
}
`
});

describe('the uncertainty library', () => {
	it('comes into a project that lacks it, once', { timeout: 60_000 }, async () => {
		const without = await openWorkspace(host, [scale('')]);
		expect(missingUncertaintyLibrary(without)).toEqual([
			{ path: 'libraries/Uncertainty.sysml', text: UNCERTAINTY_LIBRARY.text }
		]);
		// Written as the help's "Add the uncertainty library" writes it: one undoable step, no problems.
		await analysed(without, () =>
			write(without, 'Add the uncertainty library', { files: missingUncertaintyLibrary(without) })
		);
		expect(without.text('libraries/Uncertainty.sysml')).toBe(UNCERTAINTY_LIBRARY.text);
		expect(problemsOf(without)).toEqual([]);
		expect(missingUncertaintyLibrary(without)).toEqual([]);
	});
});

describe('a value’s distribution as SysML', () => {
	it('writes each kind with the fields given', () => {
		expect(distributionText({ kind: 'tolerance', plus: '60 [g]', minus: '40 [g]' })).toBe(
			'attribute tolerance : Uncertainty::Tolerance { :>> plus = 60 [g]; :>> minus = 40 [g]; }'
		);
		expect(
			distributionText({ kind: 'tolerance', plus: '5 [g]', reading: 'uniform' }, (n) => n)
		).toBe(
			'attribute tolerance : Tolerance { :>> plus = 5 [g]; :>> reading = ToleranceReading::uniform; }'
		);
		expect(distributionText({ kind: 'normal', standardDeviation: '4 [W]' })).toBe(
			'attribute uncertainty : Uncertainty::Normal { :>> standardDeviation = 4 [W]; }'
		);
		expect(distributionText({ kind: 'uniform', min: '0.8', max: '0.9' })).toBe(
			'attribute uncertainty : Uncertainty::Uniform { :>> min = 0.8; :>> max = 0.9; }'
		);
		expect(distributionText({ kind: 'triangular', min: '1 [kg]', mode: '', max: '2 [kg]' })).toBe(
			'attribute uncertainty : Uncertainty::Triangular { :>> min = 1 [kg]; :>> max = 2 [kg]; }'
		);
	});

	it('gives the check on the value a spread', () => {
		const specs: DistributionSpec[] = [
			{ kind: 'tolerance', plus: '5 [g]' },
			{ kind: 'normal', standardDeviation: '0.002 [kg]' },
			{ kind: 'uniform', min: '1.095 [kg]', max: '1105 [g]' },
			{ kind: 'triangular', min: '1095 [g]', max: '1.105 [kg]' }
		];
		for (const spec of specs) {
			const files = [UNCERTAINTY_LIBRARY, scale(distributionText(spec))];
			host.analyzeProject(files);
			const [check] = host.checks(files).checks;
			expect(check!.spread?.met.share, spec.kind).toBeGreaterThan(0.5);
			expect(check!.spread!.met.share, spec.kind).toBeLessThan(1);
		}
	});
});
