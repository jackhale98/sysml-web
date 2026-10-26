/**
 * The site's Content-Security-Policy (`src/app.html`): the app works under it
 * (the engine's WebAssembly, diagrams laid out, a PNG export, a table, the
 * service worker), and it refuses what it is there to refuse. Every other
 * spec runs under it too; this one fails on any refusal along the way.
 */
import { expect, test, type Page } from '@playwright/test';

/** Collects the policy's refusals, from the page and its console (workers included). */
async function watchRefusals(page: Page): Promise<string[]> {
	const refused: string[] = [];
	page.on('console', (m) => {
		if (/Content.Security.Policy/i.test(m.text())) refused.push(m.text().slice(0, 300));
	});
	await page.addInitScript(() =>
		document.addEventListener('securitypolicyviolation', (e) =>
			console.error(`Content-Security-Policy refused ${e.blockedURI} (${e.effectiveDirective})`)
		)
	);
	return refused;
}

test('the app works under its Content-Security-Policy without a single refusal', async ({
	page
}) => {
	test.setTimeout(120_000);
	const refused = await watchRefusals(page);

	await page.goto('/');
	const policy = await page
		.locator('meta[http-equiv="Content-Security-Policy"]')
		.getAttribute('content');
	expect(policy).toContain("default-src 'self'");
	expect(policy).toContain("object-src 'none'");
	expect(policy).not.toContain("'unsafe-eval'");

	await page
		.getByRole('link', { name: /Try the demo/ })
		.first()
		.click();
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 60_000
	});
	await expect(page.getByRole('button', { name: /^Problems: 0 errors/ })).toBeVisible();

	// A diagram, laid out and exported as PNG (an SVG drawn into a canvas through a blob URL).
	await page
		.locator('section[aria-labelledby="views-heading"]')
		.getByRole('button', { name: 'Drone interconnection', exact: true })
		.click();
	const diagram = page.getByRole('region', { name: /Drone interconnection diagram/ });
	await expect(diagram.locator('.svelte-flow__node').first()).toBeVisible({ timeout: 15_000 });
	await diagram.getByRole('button', { name: 'Export' }).click();
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('menuitem', { name: 'PNG', exact: true }).click()
	]);
	expect(download.suggestedFilename()).toMatch(/\.png$/);

	// A table.
	await page
		.locator('section[aria-labelledby="views-heading"]')
		.getByRole('button', { name: 'Drone bill of materials', exact: true })
		.click();
	await expect(
		page.getByRole('region', { name: 'Drone bill of materials view' }).locator('tbody tr').first()
	).toBeVisible({ timeout: 30_000 });

	// Settings → About asks the running engine for its version.
	await page.getByRole('button', { name: 'Settings' }).click();
	await page.getByRole('tab', { name: 'About' }).click();
	await expect(page.getByText(/^\((toolkit )?\d+\.\d+\.\d+\)$/)).toBeVisible({ timeout: 30_000 });
	await page.keyboard.press('Escape');

	expect(refused).toEqual([]);
});

test('the policy refuses a script from another site and string evaluation', async ({ page }) => {
	// The page's own code, not Playwright's (its evaluation is exempt from the policy): the
	// landing page as served, with an inline script that tries to evaluate a string (inline
	// scripts are allowed; evaluating strings isn't) and a script from another site.
	const said: string[] = [];
	page.on('console', (m) => said.push(m.text()));
	await page.route('**/*', async (route) => {
		if (route.request().resourceType() !== 'document') return route.continue();
		const response = await route.fetch();
		const body = (await response.text()).replace(
			'</body>',
			`<script>try { eval('1'); console.log('eval: ran'); } catch { console.log('eval: refused'); }</script>` +
				'<script src="https://scripts.example.test/injected.js"></script></body>'
		);
		return route.fulfill({ response, body });
	});
	await page.goto('/');
	await expect.poll(() => said.join('\n')).toContain('eval: ');
	expect(said).toContain('eval: refused');
	await expect
		.poll(() => said.join('\n'))
		.toMatch(/Refused to load the script 'https:\/\/scripts\.example\.test\/injected\.js'/);
});
