/**
 * Saving a project asks the browser to keep the site's storage for good:
 * once per page load, and not when it already does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function stubStorage(kept: boolean) {
	const storage = {
		persisted: vi.fn(async () => kept),
		persist: vi.fn(async () => true)
	};
	vi.stubGlobal('navigator', { storage });
	return storage;
}

describe('keepStorage', () => {
	beforeEach(() => vi.resetModules());
	afterEach(() => vi.unstubAllGlobals());

	it('asks the browser to keep the storage once, however often it is called', async () => {
		const storage = stubStorage(false);
		const { keepStorage } = await import('./store.ts');
		expect(await keepStorage()).toBe(true);
		expect(await keepStorage()).toBe(true);
		expect(storage.persist).toHaveBeenCalledTimes(1);
	});

	it('does not ask when the browser already keeps it', async () => {
		const storage = stubStorage(true);
		const { keepStorage } = await import('./store.ts');
		expect(await keepStorage()).toBe(true);
		expect(storage.persist).not.toHaveBeenCalled();
	});

	it('is quiet where the browser cannot keep storage', async () => {
		vi.stubGlobal('navigator', {});
		const { keepStorage } = await import('./store.ts');
		expect(await keepStorage()).toBe(false);
	});
});
