import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// PW_PORT lets several checkouts run their e2e suites side by side.
const PORT = Number(process.env.PW_PORT ?? 4173);

/**
 * Resolve a Chromium binary when the installed Playwright revision does not match the
 * preinstalled browsers. Order: PW_CHROMIUM_PATH env, then any chromium under
 * PLAYWRIGHT_BROWSERS_PATH, else undefined (Playwright's own default lookup, e.g. in CI).
 */
function findChromium(): string | undefined {
	const fromEnv = process.env.PW_CHROMIUM_PATH;
	if (fromEnv) return fromEnv;

	const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
	if (!root || !existsSync(root)) return undefined;

	const candidates = ['chrome-linux64/chrome', 'chrome-linux/chrome'];
	for (const dir of readdirSync(root).sort().reverse()) {
		if (!dir.startsWith('chromium-')) continue;
		for (const rel of candidates) {
			const p = join(root, dir, rel);
			if (existsSync(p)) return p;
		}
	}
	return undefined;
}

const executablePath = process.env.CI ? process.env.PW_CHROMIUM_PATH : findChromium();

/**
 * The e2e build has "Sign in with GitHub" set up, with a test client ID and a
 * worker address the tests answer for (tests/e2e/signin.spec.ts mocks GitHub
 * and the worker). PW_SIGN_IN=off builds without it, as the site is until it
 * is configured: the token-only connect flow.
 */
export const SIGN_IN_TEST =
	process.env.PW_SIGN_IN === 'off'
		? null
		: {
				PUBLIC_GITHUB_CLIENT_ID: 'Iv1.e2etestclient',
				PUBLIC_GITHUB_APP_SLUG: 'sysml-web-e2e',
				PUBLIC_SYNC_WORKER: 'https://sync.example.test'
			};

/**
 * Firefox and WebKit (Safari's engine) run a smoke set when PW_BROWSERS
 * names them (`PW_BROWSERS=firefox,webkit`, as .github/workflows/browsers.yml
 * does); otherwise only Chromium runs, as on a machine with only Chromium.
 * Firefox has no mobile emulation (`isMobile`), so it leaves out the phone tests.
 */
const SMOKE = [
	'smoke.spec.ts',
	'landing.spec.ts',
	'onboarding.spec.ts',
	'phone-layout.spec.ts',
	'editor.spec.ts'
];
const BROWSERS = (process.env.PW_BROWSERS ?? '').split(',').map((b) => b.trim());
const otherBrowsers = [
	...(BROWSERS.includes('firefox')
		? [
				{
					name: 'firefox',
					testMatch: SMOKE,
					testIgnore: 'phone-layout.spec.ts',
					grepInvert: /on a phone|on an iPhone/,
					use: { ...devices['Desktop Firefox'] }
				}
			]
		: []),
	...(BROWSERS.includes('webkit')
		? [{ name: 'webkit', testMatch: SMOKE, use: { ...devices['Desktop Safari'] } }]
		: [])
];

export default defineConfig({
	testDir: 'tests/e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
	use: {
		baseURL: `http://localhost:${PORT}`,
		trace: 'on-first-retry'
	},
	projects: [
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
				launchOptions: executablePath ? { executablePath } : {}
			}
		},
		...otherBrowsers
	],
	webServer: {
		command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
		port: PORT,
		reuseExistingServer: !process.env.CI,
		timeout: 180_000,
		env: SIGN_IN_TEST ?? {
			PUBLIC_GITHUB_CLIENT_ID: '',
			PUBLIC_GITHUB_APP_SLUG: '',
			PUBLIC_SYNC_WORKER: ''
		}
	}
});
