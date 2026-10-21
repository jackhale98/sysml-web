// SPIKE: measurement profiles.
import fs from 'node:fs';
import path from 'node:path';

export function chromePath() {
	if (process.env.PW_CHROMIUM_PATH) return process.env.PW_CHROMIUM_PATH;
	const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
	for (const dir of fs
		.readdirSync(root)
		.filter((d) => /^chromium-\d+$/.test(d))
		.sort()
		.reverse())
		for (const sub of ['chrome-linux', 'chrome-linux64']) {
			const bin = path.join(root, dir, sub, 'chrome');
			if (fs.existsSync(bin)) return bin;
		}
	return undefined;
}

/** A mid-range phone (Lighthouse's Moto G Power user agent, iPhone-12-sized viewport as asked). */
export const PHONE = {
	viewport: { width: 390, height: 844 },
	deviceScaleFactor: 3,
	isMobile: true,
	hasTouch: true,
	userAgent:
		'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
};
export const DESKTOP = { viewport: { width: 1350, height: 940 }, deviceScaleFactor: 1 };

/**
 * Lighthouse "slow 4G" as Lighthouse applies it with devtools throttling
 * (constants.throttling.mobileSlow4G, adjusted): 150 ms RTT × 3.75 = 562.5 ms
 * request latency, 1.6 Mbps × 0.9 down, 750 Kbps × 0.9 up.
 */
export const SLOW_4G = {
	offline: false,
	latency: 562.5,
	downloadThroughput: Math.floor((1.6 * 1024 * 1024 * 0.9) / 8),
	uploadThroughput: Math.floor((750 * 1024 * 0.9) / 8)
};
