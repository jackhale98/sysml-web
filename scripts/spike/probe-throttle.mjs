// SPIKE: does page-level CDP throttling (Emulation.setCPUThrottlingRate,
// Network.emulateNetworkConditions) reach a dedicated worker? Runs the bench
// worker's fixed CPU loop and reads the worker's download times, with and
// without page-level throttling, and with throttling sent to the worker target.
// usage: node scripts/spike/probe-throttle.mjs [base=http://localhost:4575]
import { chromium } from 'playwright';
import { Cdp } from './cdp.mjs';
import { chromePath, PHONE, SLOW_4G } from './profiles.mjs';

const base = process.argv[2] ?? 'http://localhost:4575';
const port = 9420 + Math.floor(Math.random() * 50);
const browser = await chromium.launch({
	executablePath: chromePath(),
	args: [`--remote-debugging-port=${port}`, '--no-sandbox']
});
const cdp = await Cdp.connect(port);
for (const mode of ['none', 'page', 'page+worker']) {
	const context = await browser.newContext({ ...PHONE, serviceWorkers: 'block' });
	const page = await context.newPage();
	const session = await context.newCDPSession(page);
	if (mode !== 'none') {
		await session.send('Network.enable');
		await session.send('Network.emulateNetworkConditions', SLOW_4G);
		await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
	}
	await page.goto(`${base}/p/demo?toolkit=libcache`);
	await page.waitForFunction(() => window.__toolkit, null, { timeout: 300000 });
	if (mode === 'page+worker') {
		const w = await cdp.attach((t) => t.type === 'worker' && t.url.includes('bench.worker'));
		console.log('worker target', w?.target.url);
		try {
			await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }, w.sessionId);
			console.log('  worker accepted Emulation.setCPUThrottlingRate');
		} catch (e) {
			console.log('  worker refused Emulation.setCPUThrottlingRate:', e.message);
		}
	}
	await page.waitForFunction(() => window.__toolkitStats?.done, null, { timeout: 600000 });
	const stats = await page.evaluate(() => window.__toolkitStats);
	const spins = [];
	for (let i = 0; i < 3; i++)
		spins.push((await page.evaluate(() => window.__toolkit.call('spin'))).ms);
	const mainSpin = await page.evaluate(() => {
		const s = performance.now();
		let x = 0;
		for (let i = 0; i < 2e8; i++) x = (x + i * 7) % 1000003;
		return Math.round(performance.now() - s) + x * 0;
	});
	const wasm = stats.boot?.resources.find((r) => r.name.includes('.wasm'));
	console.log(
		JSON.stringify({
			mode,
			workerSpinMs: spins,
			mainSpinMs: mainSpin,
			wasmTransfer: wasm?.transferSize,
			wasmDownloadMs: wasm && Math.round(wasm.end - wasm.start),
			libraryLoadMs: stats.boot?.steps.libraryLoad?.ms,
			error: stats.error
		})
	);
	await context.close();
}
await browser.close();
cdp.close();
