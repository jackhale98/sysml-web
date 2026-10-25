import { beforeAll, describe, expect, it } from 'vitest';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import { demoFiles, loadHost } from '#lib/engine/toolkit/testing.ts';
import { loadTemplate, type TemplateId } from './templates/catalog';
import { nextId, requirementIdProblems } from './requirementIds';

let host: ToolkitHost;
beforeAll(async () => {
	host = await loadHost();
}, 60_000);

const problems = (files: { path: string; text: string }[]) =>
	requirementIdProblems(host.analyzeProject(files)).map(
		(p) => `${p.severity} ${p.file}:${p.span.start_row} ${p.message}`
	);

describe('requirement IDs', () => {
	it('warns at each requirement that shares an ID, across packages and files, ignoring case', () => {
		expect(
			problems([
				{
					path: 'a.sysml',
					text: `package A {
	requirement <'R-1'> mass;
	package Sub { requirement <'r-1'> power; }
}`
				},
				{ path: 'b.sysml', text: `package B { requirement <'R-1'> noise; }` }
			]).filter((p) => p.startsWith('warning'))
		).toEqual([
			'warning a.sysml:2 The ID R-1 is also used by ‘power’ (a.sysml:3), ‘noise’ (b.sysml:1).',
			'warning a.sysml:3 The ID r-1 is also used by ‘mass’ (a.sysml:2), ‘noise’ (b.sysml:1).',
			'warning b.sysml:1 The ID R-1 is also used by ‘mass’ (a.sysml:2), ‘power’ (a.sysml:3).'
		]);
	});

	it('leaves IDs shared within one namespace to the engine, which reports them', () => {
		const files = [
			{
				path: 'a.sysml',
				text: `package A { requirement <'R-1'> mass; requirement <'R-1'> power; }`
			}
		];
		expect(problems(files)).toEqual([]);
		expect(host.analyzeProject(files)[0]!.diagnostics.map((d) => d.severity)).toEqual(['error']);
	});

	it('counts requirement definitions and concerns among the IDs', () => {
		expect(
			problems([
				{
					path: 'a.sysml',
					text: `package A {
	requirement def <'X-1'> MassLimit;
	package Concerns { concern <'X-1'> weight; }
}`
				}
			])
		).toEqual([
			'warning a.sysml:2 The ID X-1 is also used by ‘weight’ (a.sysml:3).',
			'warning a.sysml:3 The ID X-1 is also used by ‘MassLimit’ (a.sysml:2).'
		]);
	});

	it('notes a requirement in a package without an ID, not one inside another element', () => {
		const found = problems([
			{
				path: 'a.sysml',
				text: `package A {
	requirement <'SYS-009'> range;
	requirement <'SYS-011'> speed;
	requirement 'Battery life' { requirement subOne; }
	part def Car { requirement inPart; }
	requirement def NoIdDefinition;
}`
			}
		]);
		expect(found).toEqual(['note a.sysml:4 ‘Battery life’ has no ID.']);
		const [note] = requirementIdProblems(
			host.analyzeProject([
				{ path: 'a.sysml', text: `package A { requirement <'SYS-011'> speed; requirement noId; }` }
			])
		);
		expect(note!.suggestion).toBe(
			"Set its ID in the details (such as SYS-012), or write requirement <'SYS-012'> noId."
		);
	});

	it('finds nothing in the demo or the templates', async () => {
		expect(problems(demoFiles().filter((f) => f.path.endsWith('.sysml')))).toEqual([]);
		for (const id of ['blank', 'requirements', 'flashlight'] satisfies TemplateId[]) {
			const { files } = (await loadTemplate(id)).make('Rover', '', []);
			expect(problems(files.filter((f) => f.path.endsWith('.sysml'))), id).toEqual([]);
		}
	});
});

describe('the next free ID', () => {
	const item = (id: string | null, pkg: string | null = 'P') => ({ id, package: pkg });

	it('follows the series its package uses most, keeping its width', () => {
		expect(nextId(item(null), [item('SYS-009'), item('SYS-011'), item('STK-1')])).toBe('SYS-012');
		expect(nextId(item(null), [item('REQ-0099')])).toBe('REQ-0100');
	});

	it('falls back to the project series, then REQ-001, and skips IDs already taken', () => {
		expect(nextId(item(null, 'Q'), [item('HZ-4', 'P')])).toBe('HZ-5');
		expect(nextId(item(null), [])).toBe('REQ-001');
		expect(nextId(item(null), [item('A-1'), item('a-2', 'Other'), item('A-3', null)])).toBe('A-4');
	});
});
