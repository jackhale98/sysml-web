import { beforeAll, describe, expect, it } from 'vitest';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import { demoFiles, loadHost } from '#lib/engine/toolkit/testing.ts';
import { satisfyProblems, subjectFirstProblems } from './requirementChecks';

let host: ToolkitHost;
beforeAll(async () => {
	host = await loadHost();
}, 60_000);

const problems = (files: { path: string; text: string }[]) =>
	satisfyProblems(
		host.analyzeProject(files),
		(path) => files.find((f) => f.path === path)?.text
	).map((p) => `${p.file}:${p.span.start_row} ${p.message}`);

const MODEL = `package A {
	part def D { part fc; }
	requirement def R { subject drone : D; }
	requirement r : R;
	requirement s { subject other : D; }
	package Design { part drone : D { part fc; } }
	package Claims {
		private import Design::drone;
		satisfy r by drone.fc;
		satisfy r by drone;
		satisfy r by Design::drone.fc;
		satisfy s by drone.fc;
	}
}`;

describe('a satisfy whose part has the name of the requirement’s subject', () => {
	it('warns where other tools read the subject, and gives the qualified spelling', () => {
		expect(problems([{ path: 'a.sysml', text: MODEL }])).toEqual([
			'a.sysml:9 In “by drone.fc”, other SysML tools read drone as the requirement’s own subject, not the part A::Design::drone: write A::Design::drone.fc.',
			'a.sysml:10 In “by drone”, other SysML tools read drone as the requirement’s own subject, not the part A::Design::drone: write A::Design::drone.'
		]);
	});

	it('finds nothing in the demo', () => {
		expect(problems(demoFiles().filter((f) => f.path.endsWith('.sysml')))).toEqual([]);
	});
});

describe('a requirement’s subject comes first', () => {
	// The cases the OMG pilot implementation rejects (validate…SubjectParameterPosition) and accepts.
	const text = `package C {
	part def Op;
	requirement def RD { subject x : Op; }
	requirement r { stakeholder s : Op; }
	requirement q { subject x : Op; actor a : Op; }
	requirement t : RD { stakeholder s : Op; }
	requirement u { actor a : Op; subject x : Op; }
	requirement def W { stakeholder s : Op; }
}`;

	it('warns where the pilot rejects it, and nowhere else', () => {
		expect(
			subjectFirstProblems(host.analyzeProject([{ path: 'c.sysml', text }])).map(
				(p) => `${p.span.start_row} ${p.message}`
			)
		).toEqual([
			'8 W has a stakeholder but no subject of its own: declare its subject first (other SysML tools reject it otherwise).',
			'4 r has a stakeholder but no subject of its own: declare its subject first (other SysML tools reject it otherwise).',
			'6 t has a stakeholder but no subject of its own: declare its subject first (other SysML tools reject it otherwise).',
			'7 Declare the subject of u before its actor: other SysML tools reject a requirement whose first parameter is not its subject.'
		]);
	});

	it('finds nothing in the demo', () => {
		expect(subjectFirstProblems(host.analyzeProject(demoFiles()))).toEqual([]);
	});
});
