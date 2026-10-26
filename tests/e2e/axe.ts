/**
 * The page checked for accessibility once it has settled, with its
 * notifications held meanwhile.
 *
 * Settled: running CSS animations that end (a dialog's entrance) have
 * finished, so colour contrast is measured on the colours people see, not
 * part way through a fade (a sheet dialog fades in over 180 ms; caught in
 * it, its buttons fail contrast now and then). A spinner's never end and
 * are not waited for; nor is anything past a few seconds.
 *
 * Held: a check takes seconds on a slow machine, long enough for a toast to
 * go before the test reaches its Undo. They are held as focus in them holds
 * them (the toaster's focusin), without moving focus; released after, unless
 * focus really is in them.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/** Wait for running animations that end to finish (at most `limit` ms). */
export async function settled(page: Page, limit = 10_000) {
	await page.evaluate(
		(limit) =>
			Promise.race([
				Promise.all(
					document
						.getAnimations()
						.filter(
							(a) => a.playState === 'running' && a.effect?.getComputedTiming().endTime !== Infinity
						)
						.map((a) => a.finished.catch(() => undefined))
				),
				new Promise((resolve) => setTimeout(resolve, limit))
			]),
		limit
	);
}

export async function analyze(page: Page) {
	await settled(page);
	const hold = (type: 'focusin' | 'focusout') =>
		page.evaluate((type) => {
			const toaster = document.querySelector('section[aria-label="Notifications"]');
			if (type === 'focusout' && toaster?.contains(document.activeElement)) return;
			toaster?.dispatchEvent(new FocusEvent(type, { bubbles: true }));
		}, type);
	await hold('focusin');
	try {
		return await new AxeBuilder({ page }).analyze();
	} finally {
		await hold('focusout');
	}
}
