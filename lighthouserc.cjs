// Lighthouse CI config. Select the form factor with LH_PRESET=mobile (default) | desktop.
//   LH_PRESET=desktop npx lhci autorun
// Serves ./build through `vite preview`, which falls back to 404.html for deep links (SPA mode).
const fs = require('node:fs');
const path = require('node:path');

const desktop = process.env.LH_PRESET === 'desktop';
const preset = desktop ? 'desktop' : 'mobile';
const port = Number(process.env.LH_PORT ?? 4174);
const origin = `http://localhost:${port}`;

// Prefer an explicit CHROME_PATH; otherwise look for a Playwright-installed Chromium.
function findChrome() {
	if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
	const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
	if (!root || !fs.existsSync(root)) return undefined;
	for (const dir of fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d))) {
		for (const sub of ['chrome-linux', 'chrome-linux64']) {
			const bin = path.join(root, dir, sub, 'chrome');
			if (fs.existsSync(bin)) return bin;
		}
	}
	return undefined;
}
const chromePath = findChrome();

module.exports = {
	ci: {
		collect: {
			startServerCommand: `npx vite preview --port ${port} --strictPort`,
			startServerReadyPattern: 'Local',
			startServerReadyTimeout: 60000,
			url: ['/', '/p/demo'].map((p) => origin + p),
			numberOfRuns: 3,
			...(chromePath ? { chromePath } : {}),
			settings: {
				preset: desktop ? 'desktop' : undefined,
				chromeFlags: '--no-sandbox --headless=new --disable-gpu --disable-dev-shm-usage'
			}
		},
		assert: {
			assertions: {
				'categories:performance': ['error', { minScore: 0.9, aggregationMethod: 'median-run' }],
				'categories:accessibility': ['error', { minScore: 1, aggregationMethod: 'pessimistic' }],
				'categories:best-practices': ['error', { minScore: 0.95, aggregationMethod: 'median-run' }],
				'categories:seo': ['error', { minScore: 0.9, aggregationMethod: 'median-run' }]
			}
		},
		upload: {
			target: 'filesystem',
			outputDir: `.lighthouseci/${preset}`
		}
	}
};
