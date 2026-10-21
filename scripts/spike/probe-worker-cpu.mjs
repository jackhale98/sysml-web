// SPIKE: can CPU throttling be applied to a dedicated worker through its own
// CDP session (auto-attached via the page target)?
import { chromium } from 'playwright';
import { Cdp } from './cdp.mjs';
import { chromePath, PHONE } from './profiles.mjs';
const base = process.argv[2] ?? 'http://localhost:4575';
const port = 9470 + Math.floor(Math.random() * 50);
const browser = await chromium.launch({ executablePath: chromePath(), args: [`--remote-debugging-port=${port}`, '--no-sandbox'] });
const cdp = await Cdp.connect(port);
const context = await browser.newContext({ ...PHONE, serviceWorkers: 'block' });
const page = await context.newPage();
const pageTarget = await cdp.attach((t) => t.type === 'page' && t.url === 'about:blank');
const workers = [];
cdp.on((m) => {
	if (m.method === 'Target.attachedToTarget') workers.push({ ...m.params.targetInfo, sessionId: m.params.sessionId, parent: m.sessionId });
});
await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, pageTarget.sessionId);
await page.goto(`${base}/p/demo?toolkit=libcache`);
await page.waitForFunction(() => window.__toolkitStats?.done, null, { timeout: 300000 });
console.log(workers.map((w) => `${w.type} ${w.url.split('/').pop()}`));
const w = workers.find((x) => x.url.includes('bench.worker'));
const spin = async () => (await page.evaluate(() => window.__toolkit.call('spin'))).ms;
console.log('worker spin unthrottled', await spin());
for (const rate of [4, 1]) {
	try {
		await cdp.send('Emulation.setCPUThrottlingRate', { rate }, w.sessionId);
		console.log(`rate ${rate} accepted on worker session; spin`, await spin());
	} catch (e) {
		console.log(`rate ${rate} refused on worker session:`, e.message);
	}
}
console.log('heap', JSON.stringify(await cdp.send('Runtime.getHeapUsage', {}, w.sessionId)));
console.log('procs', JSON.stringify((await cdp.send('SystemInfo.getProcessInfo')).processInfo));
await browser.close();
cdp.close();
