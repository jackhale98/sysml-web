import { describe, expect, it, vi } from 'vitest';
import { toolkitEngine } from './client';
import type { ToolkitClient } from './toolkit/client';

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
		await expect(engine.analyzeProject(files)).resolves.toBe('toolkit:analyzeProject');
		await expect(engine.hover(files, 'a.sysml', 3)).resolves.toBe('toolkit:hover');
		const request = { op: 'insertTopLevel', path: 'a.sysml', source: '', text: '' } as const;
		await expect(engine.edit(request)).resolves.toBe('toolkit:edit');
		expect(toolkit.call.mock.calls).toEqual([
			['analyzeProject', files],
			['hover', files, 'a.sysml', 3],
			['edit', request]
		]);
	});

	it('stops the worker', () => {
		const toolkit = fakeToolkit();
		toolkitEngine(toolkit).terminate();
		expect(toolkit.terminate).toHaveBeenCalled();
	});
});
