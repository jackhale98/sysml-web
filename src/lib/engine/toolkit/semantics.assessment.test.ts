/**
 * Assessment (docs/assessment/01-language.md, checklist 1.2): what Fairtide
 * reports for semantically invalid models — the toolkit's findings as the
 * problems list shows them — and where the toolkit departs from the
 * specification (KerML 1.1 / SysML 2.1 Beta 1, Release 2026-05, the
 * release its library comes from). The departures were found by comparing
 * with the OMG pilot implementation (tools/interop/pilot-check.sh) and are
 * kept as `it.fails` with the clause that decides them, so they flip when
 * the engine is fixed.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ToolkitHost } from './host';
import { loadHost } from './testing';

let host: ToolkitHost;
beforeAll(async () => {
	host = await loadHost();
}, 60_000);

/** `severity line: message` for each problem of a one-file project. */
function problems(text: string, path = 'model/P.sysml'): string[] {
	const [a] = host.analyzeProject([{ path, text }]);
	return [
		...a!.model.syntax_errors.map((e) => `syntax ${e.span.start_row}: ${e.message}`),
		...a!.diagnostics.map((d) => `${d.severity} ${d.span.start_row}: ${d.message}`)
	];
}

describe('invalid models are diagnosed where the problem is', () => {
	const cases: [string, string, RegExp][] = [
		[
			'an unresolved type',
			'package P {\n  part p : Nope;\n}',
			/^warning 2: unresolved reference `Nope`$/
		],
		[
			'an action typed by a part definition',
			'package P {\n  part def B;\n  action a : B;\n}',
			/^error 3: ActionUsage must be typed by Behavior/
		],
		[
			'a part definition specializing an attribute definition',
			'package P {\n  attribute def V;\n  part def A :> V;\n}',
			/^error 3: A class cannot specialize a data type/
		],
		[
			'a redefinition of a feature that is not inherited',
			'package P {\n  part def A { attribute m; }\n  part def B :> A { attribute :>> q; }\n}',
			/^warning 3: unresolved reference `q`$/
		],
		[
			'overriding a bound (non-default) value',
			'package P {\n  part def A { attribute m = 1; }\n  part a : A { attribute :>> m = 2; }\n}',
			/^error 3: Cannot override the non-default value of `P::A::m`/
		],
		[
			'a redefined multiplicity outside the original',
			'package P {\n  part def A { part w[4]; }\n  part a : A { part :>> w[5]; }\n}',
			/^warning 3: redefining multiplicity \[5\.\.5\] is not within/
		],
		[
			'a value of the wrong type',
			'package P {\n  attribute x : ScalarValues::Boolean = 3;\n}',
			/^warning 2: feature value evaluates to a number, which can never conform to the declared type `Boolean`$/
		],
		[
			'a duplicate name',
			'package P {\n  part def A;\n  part def A;\n}',
			/^error 3: the name `A` is already used/
		]
	];
	for (const [label, text, expected] of cases)
		it(label, () => {
			const found = problems(text);
			expect(
				found.some((p) => expected.test(p)),
				found.join('\n')
			).toBe(true);
		});
});

describe('departures from the specification', () => {
	// Known gap: an unresolved name is a warning; KerML 8.2.3.5.1 says the text "fails with a
	// name resolution error" (the pilot reports an error), so a model with dangling names
	// counts as having no errors.
	it.fails('an unresolved name is an error', () => {
		expect(problems('package P {\n  part p : Nope;\n}')).toEqual([
			'error 2: unresolved reference `Nope`'
		]);
	});

	// Known gap: KerML 7.3.2.3 "Specialization relationships can form cycles" (and 8.2.3.5.1:
	// "Circularity is allowed for Imports and Specializations"); the pilot's own tests expect
	// no errors (ShadowingTests_CircleInheritance.kerml.xt). The toolkit reports an error.
	it.fails('circular specialization is not an error', () => {
		expect(
			problems(
				'package P {\n  classifier A specializes B;\n  classifier B specializes A;\n}',
				'k.kerml'
			)
		).toEqual([]);
	});

	// Known gap: in `satisfy r by drone.fc`, `drone` is resolved from the satisfy usage's own
	// subject parameter outwards (KerML 8.2.3.5.2: a FeatureReferenceExpression's names resolve
	// in the nearest non-invocation namespace, here the subject parameter; 8.2.3.5.4: full
	// resolution looks in each containing namespace in turn, so the satisfy usage, whose
	// subject parameter redefines R's `drone` and takes its name, KerML 8.3.3.3 effectiveName;
	// SysML 8.4.17.3 parses `by f` as `subject subj redefines R::subj = f`). So `drone` is the
	// subject itself, `drone.fc` does not resolve, and the pilot says so. The toolkit resolves
	// `drone` to the imported part and reports nothing: the claim means something else in
	// Fairtide than in the reference implementation.
	it.fails(
		'`by` names the satisfy usage’s own subject before an imported part of the same name',
		() => {
			const text = [
				'package A {',
				'    part def D;',
				'    requirement def R { subject drone : D; }',
				'    requirement r : R;',
				'    package Design { part drone : D { part fc; } }',
				'    package Claims {',
				'        private import Design::drone;',
				'        satisfy r by drone.fc;',
				'    }',
				'}'
			].join('\n');
			expect(problems(text).some((p) => /^error 8: .*`fc`/.test(p))).toBe(true);
		}
	);

	// Known gap: SysML 8.3.21 validateRequirementUsageSubjectParameterPosition, "The
	// subjectParameter of a RequirementUsage must be its first input"; a stakeholder declared
	// before the (inherited) subject breaks it. The pilot reports it; the toolkit does not.
	it.fails('a stakeholder before the subject is reported', () => {
		const text = 'package C {\n  part def Op;\n  requirement r { stakeholder s : Op; }\n}';
		expect(problems(text).some((p) => /^error 3: /.test(p))).toBe(true);
	});
});
