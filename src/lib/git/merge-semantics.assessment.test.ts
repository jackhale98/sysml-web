/**
 * Assessment (§8): Git merges that are clean as text but break the model.
 * Each case merges two people's changes as "Get latest" does (`planPull`,
 * `applyPull`), checks whether the merge itself noticed, then opens the
 * merged files on the real toolkit, as the app does after a pull, to see
 * whether the break is reported as a problem.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { openWorkspace } from '#lib/create/testing.ts';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import { loadHost } from '#lib/engine/toolkit/testing.ts';
import { applyPull, planPull, type BaseFiles } from './sync.ts';

let host: ToolkitHost;
beforeAll(async () => {
	host = await loadHost();
}, 60_000);

const sha = (text: string) => `blob:${text}`;

/** Merge `mine` and `theirs` (both made from `base`) as a pull does; conflicts take the combined text when offered. */
function pull(
	base: Record<string, string>,
	mine: Record<string, string>,
	theirs: Record<string, string>
) {
	const baseFiles: BaseFiles = Object.fromEntries(
		Object.entries(base).map(([path, text]) => [path, { sha: sha(text), text }])
	);
	const remote = Object.fromEntries(Object.entries(theirs).map(([p, t]) => [p, sha(t)]));
	const plan = planPull(baseFiles, mine, remote, theirs);
	const choices = Object.fromEntries(
		plan.conflicts.filter((c) => c.merged !== null).map((c) => [c.path, 'merged' as const])
	);
	return { plan, files: applyPull(mine, plan, choices) };
}

/** Errors and warnings of the merged model. */
async function problems(files: Record<string, string>): Promise<string[]> {
	const workspace = await openWorkspace(
		host,
		Object.entries(files).map(([path, text]) => ({ path, text }))
	);
	return workspace.problems
		.filter((p) => p.severity === 'error' || p.severity === 'warning')
		.map((p) => `${p.severity} ${p.file}:${p.span.start_row} ${p.message}`);
}

const FRAME = [
	'package A {',
	'    part def Frame {',
	'        attribute mass;',
	'    }',
	'',
	'    part def Arm;',
	'',
	'    part def Rotor;',
	'}',
	''
].join('\n');

describe('merges clean as text, broken as a model', () => {
	it('a rename here and a new use of the old name there: no conflict, but an unresolved name is reported', async () => {
		const base = {
			'A.sysml': 'package A {\n    part def Engine;\n}\n',
			'B.sysml': 'package B {\n    private import A::*;\n    part def Car;\n}\n'
		};
		const mine = { ...base, 'A.sysml': 'package A {\n    part def Motor;\n}\n' };
		const theirs = {
			...base,
			'B.sysml':
				'package B {\n    private import A::*;\n    part def Car;\n    part def Truck {\n        part engine : Engine;\n    }\n}\n'
		};
		const { plan, files } = pull(base, mine, theirs);
		expect(plan.conflicts).toEqual([]);
		expect(await problems(base)).toEqual([]);
		expect((await problems(files)).join('\n')).toMatch(/Engine/);
	}, 60_000);

	it('a feature removed here and used there, in the same file on other lines: merged, and the break is reported', async () => {
		const base = { 'A.sysml': FRAME };
		const mine = { 'A.sysml': FRAME.replace('        attribute mass;\n', '') };
		const theirs = {
			'A.sysml': FRAME.replace(
				'    part def Rotor;',
				'    part def Rotor;\n\n    part def Drone {\n        part body : Frame;\n        attribute total = body.mass;\n    }'
			)
		};
		const { plan, files } = pull(base, mine, theirs);
		expect(plan.conflicts).toHaveLength(1);
		expect(plan.conflicts[0]!.merged).not.toBeNull();
		expect(await problems(base)).toEqual([]);
		expect((await problems(files)).join('\n')).toMatch(/mass/);
	}, 60_000);

	it('the same name defined by both sides in one package is reported', async () => {
		const base = { 'A.sysml': FRAME };
		const mine = {
			'A.sysml': FRAME.replace('    part def Arm;', '    part def Arm;\n    part def Battery;')
		};
		const theirs = {
			'A.sysml': FRAME.replace(
				'    part def Rotor;',
				'    part def Rotor;\n    part def Battery {\n        attribute capacity;\n    }'
			)
		};
		const { files } = pull(base, mine, theirs);
		expect(files['A.sysml']!.match(/part def Battery/g)).toHaveLength(2);
		expect(await problems(base)).toEqual([]);
		expect((await problems(files)).join('\n')).toMatch(/Battery/);
	}, 60_000);

	it('the same requirement identifier used by both sides is reported', async () => {
		const base = {
			'R.sysml':
				"package R {\n    requirement <'R-1'> alpha;\n\n    requirement <'R-2'> beta;\n\n    requirement <'R-3'> gamma;\n}\n"
		};
		const mine = {
			'R.sysml': base['R.sysml'].replace(
				"<'R-1'> alpha;",
				"<'R-1'> alpha;\n    requirement <'R-4'> massLimit;"
			)
		};
		const theirs = {
			'R.sysml': base['R.sysml'].replace(
				"<'R-3'> gamma;",
				"<'R-3'> gamma;\n    requirement <'R-4'> speedLimit;"
			)
		};
		const { plan, files } = pull(base, mine, theirs);
		expect(plan.conflicts[0]?.merged).toContain('massLimit');
		expect(files['R.sysml']).toContain('speedLimit');
		expect(await problems(base)).toEqual([]);
		expect((await problems(files)).join('\n')).toMatch(/R-4/);
	}, 60_000);
});
