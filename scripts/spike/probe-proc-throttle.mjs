// SPIKE: check that renderer duty-cycling slows main thread and worker alike.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { Cdp } from './cdp.mjs';
import { chromePath, PHONE } from './profiles.mjs';
const base = process.argv[2] ?? 'http://localhost:4575';
const throttleBin = process.env.CPU_THROTTLE_BIN;
const port = 9520 + Math.floor(Math.random() * 50);
const browser = await chromium.launch({
	executablePath: chromePath(),
	args: [`--remote-debugging-port=${port}`, '--no-sandbox']
});
const cdp = await Cdp.connect(port);
const browserPid = (await cdp.send('SystemInfo.getProcessInfo')).processInfo.find(
	(p) => p.type === 'browser'
).id;
const context = await browser.newContext({ ...PHONE, serviceWorkers: 'block' });
const page = await context.newPage();
await page.goto(`${base}/p/demo?toolkit=libcache`);
await page.waitForFunction(() => window.__toolkitStats?.done, null, { timeout: 300000 });
const spin = async () => (await page.evaluate(() => window.__toolkit.call('spin'))).ms;
const main = () =>
	page.evaluate(() => {
		const s = performance.now();
		let x = 0;
		for (let i = 0; i < 2e8; i++) x = (x + i * 7) % 1000003;
		return Math.round(performance.now() - s) + x * 0;
	});
console.log('unthrottled worker', await spin(), 'main', await main());
for (const period of [10, 20]) {
	const t = spawn(throttleBin, [String(browserPid), '4', String(period)], { stdio: 'inherit' });
	await new Promise((r) => setTimeout(r, 300));
	console.log(
		`throttled x4 period ${period}ms: worker`,
		await spin(),
		await spin(),
		'main',
		await main()
	);
	t.kill('SIGTERM');
	await new Promise((r) => setTimeout(r, 300));
}
await browser.close();
cdp.close();
