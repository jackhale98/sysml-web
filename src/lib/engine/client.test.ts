import { describe, expect, it, vi } from 'vitest';
import { toolkitEngine } from './client';
import type { ToolkitClient } from './toolkit/client';
import type { Analysis } from './types';

function fakeToolkit(): ToolkitClient & { call: ReturnType<typeof vi.fn> } {
	return {
		call: vi.fn(async (method: string) => `toolkit:${method}`),
		prefetchSnapshot: vi.fn(),
		stats: null,
		failed: null,
		terminate: vi.fn()
	} as unknown as ToolkitClient & { call: ReturnType<typeof vi.fn> };
}

describe('toolkitEngine', () => {
	it('sends each call to the toolkit worker with its parameters', async () => {
		const toolkit = fakeToolkit();
		const engine = toolkitEngine(toolkit);
		const files = [{ path: 'a.sysml', text: 'package A;' }];
		await expect(engine.version()).resolves.toBe('toolkit:version');
		await expect(engine.hover(files, 'a.sysml', 3)).resolves.toBe('toolkit:hover');
		const request = { op: 'insertTopLevel', path: 'a.sysml', source: '', text: '' } as const;
		await expect(engine.edit(request)).resolves.toBe('toolkit:edit');
		expect(toolkit.call.mock.calls).toEqual([
			['version'],
			['hover', files, 'a.sysml', 3],
			['edit', request]
		]);
	});

	it('puts back the analyses the worker didn’t send again (they hadn’t changed)', async () => {
		const toolkit = fakeToolkit();
		const engine = toolkitEngine(toolkit);
		const files = [
			{ path: 'a.sysml', text: 'package A;' },
			{ path: 'b.sysml', text: 'package B;' }
		];
		const a = { model: { file: 'a.sysml' }, diagnostics: [] } as unknown as Analysis;
		const b = { model: { file: 'b.sysml' }, diagnostics: [] } as unknown as Analysis;
		const b2 = { model: { file: 'b.sysml' }, diagnostics: [{}] } as unknown as Analysis;
		toolkit.call.mockResolvedValueOnce([a, b]).mockResolvedValueOnce([null, b2]);
		expect(await engine.analyzeProject(files)).toEqual([a, b]);
		const again = await engine.analyzeProject(files);
		expect(again[0]).toBe(a);
		expect(again[1]).toBe(b2);
	});

	it('stops the worker', () => {
		const toolkit = fakeToolkit();
		toolkitEngine(toolkit).terminate();
		expect(toolkit.terminate).toHaveBeenCalled();
	});
});
