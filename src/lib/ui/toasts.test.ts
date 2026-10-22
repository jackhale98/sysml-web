import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toasts } from './toasts.svelte.ts';

describe('toasts', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => {
		toasts.resume();
		for (const t of toasts.items) toasts.dismiss(t.id);
		vi.useRealTimers();
	});

	const shown = (id: number) => toasts.items.some((t) => t.id === id);

	it('go on their own, later when they offer an action', () => {
		const plain = toasts.show('Saved');
		const undo = toasts.show('Deleted', { action: { label: 'Undo', run: () => {} } });
		vi.advanceTimersByTime(6000);
		expect(shown(plain)).toBe(false);
		expect(shown(undo)).toBe(true);
		vi.advanceTimersByTime(4000);
		expect(shown(undo)).toBe(false);
	});

	it('wait while paused, then carry on with the time they had left', () => {
		const id = toasts.show('Saved');
		vi.advanceTimersByTime(5000);
		toasts.pause();
		vi.advanceTimersByTime(60_000);
		expect(shown(id)).toBe(true);
		toasts.resume();
		vi.advanceTimersByTime(1000);
		expect(shown(id)).toBe(true);
		vi.advanceTimersByTime(500);
		expect(shown(id)).toBe(false);
	});

	it('one shown while paused waits too', () => {
		toasts.pause();
		const id = toasts.show('Saved');
		vi.advanceTimersByTime(60_000);
		expect(shown(id)).toBe(true);
		toasts.resume();
		vi.advanceTimersByTime(6000);
		expect(shown(id)).toBe(false);
	});

	it('those that stay until dismissed are left alone', () => {
		const id = toasts.show('Offline', { duration: 0 });
		toasts.pause();
		toasts.resume();
		vi.advanceTimersByTime(60_000);
		expect(shown(id)).toBe(true);
	});
});
