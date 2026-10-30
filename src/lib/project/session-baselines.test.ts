/**
 * Baselines of a project kept in this browser, through the session: a
 * project stored before there were baselines opens with none; a baseline
 * marked is saved with the project (a frozen copy of its files) and is
 * there after a reload; the report's revision names it, exactly or as
 * changed since.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredProject } from './store.ts';

const stored = new Map<string, StoredProject>();
vi.mock('./store.ts', () => ({
	loadProject: async (id: string) => stored.get(id),
	saveProject: async (project: StoredProject) =>
		void stored.set(project.id, structuredClone(project)),
	timestamp: () => '2026-10-30T09:00:00Z'
}));

const { ProjectSession } = await import('./session.svelte.ts');
const { Workspace } = await import('./workspace.svelte.ts');

/** The project as an earlier build kept it, before records had a version or baselines. */
const v1 = (): StoredProject =>
	JSON.parse(
		readFileSync(join(import.meta.dirname, 'fixtures/formats/stored-project-v1.json'), 'utf8')
	);

async function open(id: string) {
	const workspace = new Workspace();
	const session = new ProjectSession(workspace);
	const source = (await session.load(id))!;
	workspace.preview(source);
	return { workspace, session };
}

beforeEach(() => stored.clear());

describe('baselines of a project kept in this browser', () => {
	it('opens a project stored before there were baselines, with none', async () => {
		const old = v1();
		expect(old.baselines).toBeUndefined();
		stored.set(old.id, old);
		const { session, workspace } = await open(old.id);
		expect(session.baselines.list).toEqual([]);
		expect(session.baselines.status).toBeNull();
		expect(workspace.revision?.baseline).toBeNull();
	});

	it('keeps a marked baseline with the project, and knows the model is it until it changes', async () => {
		const old = v1();
		stored.set(old.id, old);
		const first = await open(old.id);
		await first.session.baselines.mark({ name: 'PDR', date: '2026-03-12' });
		const kept = stored.get(old.id)!.baselines!;
		expect(kept.map((b) => b.name)).toEqual(['PDR']);
		expect(kept[0]!.files.map((f) => f.path).sort()).toEqual(old.files.map((f) => f.path).sort());

		// After a reload it is still there, and the model is exactly it.
		const { session, workspace } = await open(old.id);
		expect(session.baselines.list.map((b) => [b.name, b.where])).toEqual([['PDR', 'browser']]);
		expect(workspace.revision?.baseline).toMatchObject({ exact: true, baseline: { name: 'PDR' } });

		const path = old.files.find((f) => f.path.endsWith('.sysml'))!.path;
		workspace.setText(path, `${workspace.files[path]}\n// a change\n`);
		expect(workspace.revision?.baseline).toMatchObject({ exact: false, baseline: { name: 'PDR' } });

		await session.baselines.remove(session.baselines.list[0]!);
		expect(stored.get(old.id)!.baselines).toEqual([]);
	});
});
