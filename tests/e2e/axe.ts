/**
 * The page checked for accessibility with its notifications held meanwhile:
 * a check takes seconds on a slow machine, long enough for a toast to go
 * before the test reaches its Undo. They are held as focus in them holds
 * them (the toaster's focusin), without moving focus; released after, unless
 * focus really is in them.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

export async function analyze(page: Page) {
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
