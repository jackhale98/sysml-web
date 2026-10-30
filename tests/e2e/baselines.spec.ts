/**
 * Baselines: mark the demo (a project kept in this browser) as baseline
 * PDR, see a report say so, change the model, see the report say it changed
 * since, compare with the baseline in one click, and remove it; and on a
 * project connected to GitHub (mocked), the baseline is a tag.
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { analyze } from './axe';

async function expectAccessible(page: Page) {
	const results = await analyze(page);
	const violations = results.violations.map(
		(v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
	);
	expect(violations).toEqual([]);
}

// Each test analyses the demo and compares two versions of it.
test.describe.configure({ timeout: 90_000 });

const ROOT = resolve(import.meta.dirname, '../../src/demo/drone');

/** The demo's files, as the app bundles them. */
function demoFiles(): { path: string; text: string }[] {
	const out: { path: string; text: string }[] = [];
	const walk = (dir: string) => {
		for (const name of readdirSync(dir).sort()) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) walk(path);
			else if (/\.(sysml|kerml|md)$/.test(name))
				out.push({ path: relative(ROOT, path), text: readFileSync(path, 'utf8') });
		}
	};
	walk(ROOT);
	return out;
}

async function openDemo(page: Page) {
	await page.goto('/p/demo');
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});
}

/** The GitHub sheet (opened from the top bar), and its Baselines section. */
async function openBaselines(page: Page) {
	await page.getByRole('button', { name: 'Source control' }).click();
	const sheet = page.getByRole('dialog');
	const section = sheet.getByRole('region', { name: /^Baselines/ });
	await expect(section).toBeVisible();
	return { sheet, section };
}

async function markBaseline(section: ReturnType<Page['getByRole']>, name: string) {
	await section.getByText('Mark a baseline').click();
	await section.getByRole('textbox', { name: 'Name' }).fill(name);
	await section.getByRole('textbox', { name: /Description/ }).fill('As presented at the review');
	await section.getByRole('button', { name: 'Mark baseline' }).click();
}

/** The specification report's line naming the baseline. */
async function reportBaseline(page: Page) {
	await page
		.getByRole('navigation', { name: 'Explorer' })
		.getByRole('button', { name: 'Drone specification' })
		.click();
	const title = 'Delivery drone requirements specification';
	const report = page.getByRole('article', { name: title });
	await expect(report.getByRole('heading', { name: title })).toBeVisible({ timeout: 15_000 });
	return report.locator('dt', { hasText: 'Baseline' }).locator('xpath=following-sibling::dd');
}

/** Type over the first match of `from` in the open file's text. */
async function replaceInText(page: Page, from: string, to: string) {
	const editor = page.locator('.cm-content');
	await expect(editor).toBeVisible();
	await editor.click();
	await page.keyboard.press('Control+Home');
	await page.keyboard.press('Control+f');
	await page.keyboard.type(from);
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
	await page.keyboard.type(to);
	await expect(editor).toContainText(to);
}

test('mark a baseline of a project in this browser, change the model, compare with it', async ({
	page
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await openDemo(page);
	const { sheet, section } = await openBaselines(page);
	await expect(section.getByText('No baselines yet.')).toBeVisible();
	await markBaseline(section, 'PDR');
	const pdr = section.locator('li[data-baseline="PDR"]');
	await expect(pdr).toContainText('The model is this baseline');
	await expect(pdr).toContainText('As presented at the review');
	await expect(pdr).toContainText('Kept in this browser');
	await expectAccessible(page);
	await sheet.getByRole('button', { name: 'Close' }).click();

	// A report made now is the baseline.
	const baseline = await reportBaseline(page);
	await expect(baseline).toHaveText('PDR');

	// A requirement changes: the report says the model changed since.
	await page.getByRole('tab', { name: 'Files' }).click();
	await page.getByRole('button', { name: 'SystemRequirements.sysml', exact: true }).click();
	await page.getByRole('button', { name: 'Text', exact: true }).click();
	await replaceInText(page, 'StatusKind::closed', 'StatusKind::done');
	// And a part: the motor's mass.
	await page.getByRole('button', { name: 'Components.sysml', exact: true }).click();
	await replaceInText(page, 'mass = 120 [g]', 'mass = 190 [g]');
	await page.getByRole('tab', { name: 'Model' }).click();
	await expect(await reportBaseline(page)).toHaveText('PDR, changed since', { timeout: 15_000 });

	// Kept with the project: still there after a reload (once the edits are saved here).
	await expect(page.locator('.save[role="status"]')).toHaveText('Saved');
	await page.reload();
	await expect(page.getByRole('status').filter({ hasText: 'Model ready' })).toBeVisible({
		timeout: 30_000
	});
	const again = await openBaselines(page);
	await expect(again.section.locator('li[data-baseline="PDR"]')).toContainText('Changed since');

	// "Changes since PDR": the review, against the baseline, with the requirement that changed.
	await again.section.getByRole('button', { name: 'Changes since PDR' }).click();
	await expect(again.sheet).toBeHidden();
	const review = page.getByRole('region', { name: 'Review changes' });
	await expect(review.getByText(/Comparing your version with baseline “PDR” \(/)).toBeVisible();
	const requirements = review.getByRole('region', { name: /^Requirements/ });
	await expect(requirements).toContainText('SYS-002 ‘Payload capacity’: status closed → done', {
		timeout: 30_000
	});
	await expect(review.getByRole('region', { name: /^Design/ })).toContainText(
		'Motor.mass changed 120 g → 190 g'
	);
	await expect(review.getByRole('combobox', { name: 'Compare' })).toHaveValue(
		'baseline:browser:PDR'
	);
	// The requirements that changed, in one click.
	await review
		.getByRole('navigation', { name: 'Kinds of change' })
		.getByRole('button', { name: /^Requirements/ })
		.click();
	await expect(review.getByRole('heading', { name: /^Requirements/ })).toBeFocused();
	await expectAccessible(page);

	// Removing it asks first.
	const { section: last } = await openBaselines(page);
	await last.getByRole('button', { name: 'Remove baseline PDR' }).click();
	const confirm = last.getByRole('group', { name: 'Remove baseline PDR?' });
	await expect(confirm).toContainText('Its copy of the files, kept in this browser, is deleted.');
	await confirm.getByRole('button', { name: 'Remove' }).click();
	await expect(last.getByText('No baselines yet.')).toBeVisible();
});

test('on a project connected to GitHub, a baseline is a tag on the version there', async ({
	page
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	const files = demoFiles();
	const BASE = 'c0ffee1234567890';
	const info = JSON.parse(readFileSync(join(ROOT, '.project.json'), 'utf8')) as unknown;
	await page.goto('/');
	await page.evaluate(
		async ({ files, info, BASE }) => {
			localStorage.setItem(
				'sysml-web:github',
				JSON.stringify({ token: 't0ken', user: { login: 'jo' }, connectedAt: '2026-10-20' })
			);
			const git = {
				provider: 'github',
				owner: 'acme',
				repo: 'drone',
				branch: 'main',
				defaultBranch: 'main',
				base: BASE,
				baseTree: 'tree',
				files: Object.fromEntries(files.map((f, i) => [f.path, { sha: `b${i}`, text: f.text }])),
				syncedAt: new Date().toISOString()
			};
			await new Promise<void>((done, fail) => {
				const open = indexedDB.open('sysml-web', 1);
				open.onupgradeneeded = () => open.result.createObjectStore('projects', { keyPath: 'id' });
				open.onsuccess = () => {
					const tx = open.result.transaction('projects', 'readwrite');
					const now = new Date().toISOString();
					tx.objectStore('projects').put({
						id: 'demo',
						info,
						files,
						git,
						origin: 'git',
						created: now,
						updated: now
					});
					tx.oncomplete = () => {
						open.result.close();
						done();
					};
					tx.onerror = () => fail(tx.error);
				};
				open.onerror = () => fail(open.error);
			});
		},
		{ files, info, BASE }
	);

	// GitHub, as far as baselines need it: the tags, making and deleting one, the tagged version.
	const tags: { ref: string; object: { sha: string; type: string } }[] = [];
	let tagObject: unknown = null;
	const sent: { method: string; path: string; body: unknown }[] = [];
	await page.route('https://api.github.com/**', (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname.replace('/repos/acme/drone', '');
		const method = request.method();
		const body = request.postData() ? (JSON.parse(request.postData()!) as unknown) : undefined;
		if (method !== 'GET') sent.push({ method, path, body });
		const json = (data: unknown, status = 200) => route.fulfill({ status, json: data });
		if (path === '/branches/main')
			return json({ commit: { sha: BASE, commit: { tree: { sha: 'tree' } } } });
		if (path === '/pulls' || path === '/commits') return json([]);
		if (path === '/git/matching-refs/tags/baseline/') return json(tags);
		if (method === 'POST' && path === '/git/tags') {
			const input = body as { message: string; object: string };
			tagObject = {
				sha: 'tag1',
				message: input.message,
				tagger: { name: 'Jo', date: '2026-10-30T10:00:00Z' },
				object: { sha: input.object, type: 'commit' }
			};
			return json(tagObject, 201);
		}
		if (path === '/git/tags/tag1') return json(tagObject);
		if (method === 'POST' && path === '/git/refs') {
			tags.push({ ref: (body as { ref: string }).ref, object: { sha: 'tag1', type: 'tag' } });
			return json({}, 201);
		}
		if (method === 'DELETE' && path === '/git/refs/tags/baseline/CDR') {
			tags.length = 0;
			return route.fulfill({ status: 204 });
		}
		if (path === `/git/commits/${BASE}`) return json({ tree: { sha: 'tree' } });
		if (path === '/git/trees/tree')
			return json({
				sha: 'tree',
				truncated: false,
				tree: files.map((f, i) => ({ path: f.path, type: 'blob', sha: `b${i}`, size: 1 }))
			});
		return route.fulfill({ status: 404, json: { message: 'Not Found' } });
	});

	await openDemo(page);
	const { sheet, section } = await openBaselines(page);
	await expect(section.getByText('No baselines yet.')).toBeVisible();
	await section.getByText('Mark a baseline').click();
	await section.getByRole('textbox', { name: 'Name' }).fill('CDR');
	await expect(
		section.getByText(/Tags the version on GitHub you're at \(c0ffee1\) as baseline\/CDR/)
	).toBeVisible();
	await section.getByRole('button', { name: 'Mark baseline' }).click();
	const cdr = section.locator('li[data-baseline="CDR"]');
	await expect(cdr).toContainText('The model is this baseline');
	await expect(cdr).toContainText('Tag baseline/CDR on GitHub');
	expect(sent.map((s) => `${s.method} ${s.path}`)).toEqual(['POST /git/tags', 'POST /git/refs']);
	expect(sent[0]!.body).toMatchObject({ tag: 'baseline/CDR', object: BASE, type: 'commit' });
	expect(sent[1]!.body).toEqual({ ref: 'refs/tags/baseline/CDR', sha: 'tag1' });
	await expectAccessible(page);

	// Compared with the tagged version: the same model.
	await cdr.getByRole('button', { name: 'Changes since CDR' }).click();
	const review = page.getByRole('region', { name: 'Review changes' });
	await expect(review.getByText(/Comparing your version with baseline “CDR”/)).toBeVisible();
	await expect(review.getByText('No changes to the model')).toBeVisible({ timeout: 30_000 });

	// Removing it deletes the tag on GitHub, and says so first.
	await page.getByRole('button', { name: 'Source control' }).click();
	await section.getByRole('button', { name: 'Remove baseline CDR' }).click();
	const confirm = section.getByRole('group', { name: 'Remove baseline CDR?' });
	await expect(confirm).toContainText(
		'This deletes the tag baseline/CDR from acme/drone on GitHub'
	);
	await confirm.getByRole('button', { name: 'Remove' }).click();
	await expect(section.getByText('No baselines yet.')).toBeVisible();
	expect(sent.at(-1)).toMatchObject({ method: 'DELETE', path: '/git/refs/tags/baseline/CDR' });
	await expect(sheet).toBeVisible();
});
