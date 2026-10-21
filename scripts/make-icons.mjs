// Render the app's maskable PNG icons from the logo (static/favicon.svg), for the
// web manifest. Maskable icons fill the whole square, with the mark inside the
// central "safe zone" circle, so Android can crop them to any shape.
//
//   node scripts/make-icons.mjs
//
// Uses the Chromium that Playwright already installs (set PW_CHROMIUM_PATH to choose one).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const root = new URL('..', import.meta.url).pathname;
const logo = readFileSync(join(root, 'static/favicon.svg'), 'utf8');

// The logo without its rounded tile, shrunk to sit well inside the safe zone (a circle of 80%).
const mark = logo
	.replace(/<svg[^>]*>/, '')
	.replace('</svg>', '')
	.replace(/<rect width="32" height="32"[^>]*\/>/, '');
const background = /<rect width="32" height="32"[^>]*fill="([^"]+)"/.exec(logo)?.[1] ?? '#2f55d4';
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
	<rect width="32" height="32" fill="${background}"/>
	<g transform="translate(16 16) scale(0.78) translate(-16 -16)">${mark}</g>
</svg>`;

function findChromium() {
	if (process.env.PW_CHROMIUM_PATH) return process.env.PW_CHROMIUM_PATH;
	const dir = process.env.PLAYWRIGHT_BROWSERS_PATH;
	if (!dir || !existsSync(dir)) return undefined;
	for (const entry of readdirSync(dir).sort().reverse()) {
		if (!entry.startsWith('chromium-')) continue;
		for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
			if (existsSync(join(dir, entry, rel))) return join(dir, entry, rel);
		}
	}
	return undefined;
}

const browser = await chromium.launch({ executablePath: findChromium() });
const page = await browser.newPage();
for (const size of [192, 512]) {
	await page.setViewportSize({ width: size, height: size });
	await page.setContent(
		`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${maskable}`
	);
	const file = `static/icon-maskable-${size}.png`;
	writeFileSync(join(root, file), await page.screenshot({ type: 'png' }));
	console.log(`wrote ${file}`);
}
await browser.close();
