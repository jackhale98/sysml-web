/**
 * Assessment: a self-hosted copy (docs/assessment/10-performance-usability.md).
 * Skipped unless ASSESS_DEPLOY_URL names one: a build made with a base path
 * and without the sign-in settings, served by a plain static server
 * (optionally with a strict Content-Security-Policy), with every request to
 * another host refused, as behind a firewall.
 *
 *   BASE_PATH=/tools/tessera PUBLIC_GITHUB_CLIENT_ID= PUBLIC_SYNC_WORKER= npm run build
 *   node tests/perf/assessment-static-server.mjs build /tools/tessera 4329 --csp &
 *   ASSESS_DEPLOY_URL=http://localhost:4329/tools/tessera/ npx playwright test assessment-perf-ux-deploy
 */
import { expect, test } from '@playwright/test';

const url = process.env.ASSESS_DEPLOY_URL;
test.skip(!url, 'ASSESS_DEPLOY_URL is not set');

test('a self-hosted copy under a base path works with no outside network and a strict CSP', async ({
	page
}) => {
	test.setTimeout(180_000);
	const site = new URL(url!);
	const refused: string[] = [];
	await page.context().route('**/*', (route) => {
		const target = new URL(route.request().url());
		if (target.host === site.host) return route.continue();
		refused.push(target.href);
		return route.abort('blockedbyclient');
	});
	const problems: string[] = [];
	page.on('console', (m) => {
		if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 200)}`);
	});
	page.on('pageerror', (e) => problems.push(`page: ${String(e).slice(0, 200)}`));
	await page.addInitScript(() =>
		document.addEventListener('securitypolicyviolation', (e) =>
			console.error(`CSP blocked ${e.blockedURI} (${e.violatedDirective})`)
		)
	);

	await page.goto(site.href);
	await expect(page.getByRole('link', { name: /Try the demo/ })).toBeVisible();
	await page.getByRole('link', { name: /Try the demo/ }).click();
	await expect(page).toHaveURL(new RegExp(`${site.pathname}p/demo`));
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 90_000
	});
	await expect(page.getByRole('button', { name: /^Problems: 0 errors/ })).toBeVisible();

	// A deep link straight into a project (served by the 404 fallback).
	await page.goto(`${site.href}p/demo`);
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 90_000
	});
	await page
		.locator('section[aria-labelledby="views-heading"]')
		.getByRole('button', { name: 'Drone bill of materials', exact: true })
		.click();
	await expect(
		page.getByRole('region', { name: 'Drone bill of materials view' }).locator('tbody tr').first()
	).toBeVisible({ timeout: 30_000 });

	// Without the sign-in settings, GitHub is connected with a token, and says so.
	await page.getByRole('button', { name: 'Settings' }).click();
	await page.getByRole('tab', { name: 'About' }).click();
	await expect(page.getByText(/sysml-toolkit \d+\.\d+\.\d+/)).toBeVisible();
	await page.keyboard.press('Escape');

	await page.waitForTimeout(10_000); // idle work: the engine snapshot, the service worker
	console.log(
		`refused: ${refused.join(', ') || 'none'}; problems: ${problems.join(' | ') || 'none'}`
	);
	expect(refused).toEqual([]);
	expect(problems.filter((p) => /CSP blocked/.test(p))).toEqual([]);
});
