import { describe, expect, it, vi } from 'vitest';
import type { Engine } from './client';
import { composeEngine } from './composite';
import type { ToolkitClient } from './toolkit/client';
import { TOOLKIT_METHODS } from './toolkit/protocol';

function fakeClassic(): Engine {
	return new Proxy({} as Record<string, unknown>, {
		get: (target, method: string) => (target[method] ??= vi.fn(async () => `classic:${method}`))
	}) as unknown as Engine;
}

function fakeToolkit(): ToolkitClient & { call: ReturnType<typeof vi.fn> } {
	return {
		call: vi.fn(async (method: string) => `toolkit:${method}`),
		prefetchSnapshot: vi.fn(),
		stats: null,
		failed: null,
		terminate: vi.fn()
	} as unknown as ToolkitClient & { call: ReturnType<typeof vi.fn> };
}

describe('composeEngine', () => {
	it('routes ported methods to the toolkit and the rest to the classic engine', async () => {
		const classic = {
			...Object.fromEntries(
				['version', 'analyzeProject', 'listViews', 'diagram', 'terminate'].map((m) => [
					m,
					vi.fn(async () => `classic:${m}`)
				])
			)
		} as unknown as Engine;
		const toolkit = fakeToolkit();
		const engine = composeEngine(classic, toolkit);
		await expect(engine.analyzeProject([])).resolves.toBe('toolkit:analyzeProject');
		await expect(engine.listViews([])).resolves.toBe('classic:listViews');
		// The classic engine starts alongside the toolkit, for the methods it still serves.
		expect(classic.version).toHaveBeenCalledTimes(1);
		await engine.version();
		expect(toolkit.call).toHaveBeenCalledWith('version');
	});

	it('routes every method the toolkit lists', () => {
		const toolkit = fakeToolkit();
		const engine = composeEngine(fakeClassic(), toolkit);
		for (const method of TOOLKIT_METHODS) void (engine[method] as () => Promise<unknown>)();
		expect(toolkit.call.mock.calls.map((c) => c[0])).toEqual([...TOOLKIT_METHODS]);
	});

	it('stops both engines', () => {
		const classic = { terminate: vi.fn(), version: vi.fn() } as unknown as Engine;
		const toolkit = fakeToolkit();
		composeEngine(classic, toolkit).terminate();
		expect(classic.terminate).toHaveBeenCalled();
		expect(toolkit.terminate).toHaveBeenCalled();
	});
});
