/**
 * Assessment (§9, worker supervision): what the page does when the engine's
 * worker crashes, runs out of memory, or stops answering. Uses a stand-in
 * worker (the real one needs a browser); the crash-and-give-up path on the
 * real worker is covered end to end by tests/e2e/engine.spec.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startToolkit } from './client';
import type { ToolkitInbound, ToolkitOutbound } from './protocol';

class StandInWorker {
	onmessage: ((event: MessageEvent<ToolkitOutbound>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	terminated = false;
	stuck = false;
	readonly received: ToolkitInbound[] = [];
	constructor(private readonly behave: (w: StandInWorker, m: ToolkitInbound) => void) {}
	postMessage(message: ToolkitInbound) {
		this.received.push(message);
		queueMicrotask(() => this.behave(this, message));
	}
	reply(message: ToolkitOutbound) {
		this.onmessage?.({ data: message } as MessageEvent<ToolkitOutbound>);
	}
	crash(message: string) {
		this.onerror?.({ message, preventDefault() {} } as ErrorEvent);
	}
	terminate() {
		this.terminated = true;
	}
}

const init = () => ({
	glueUrl: 'g',
	wasmUrl: 'w',
	bundleUrl: 'b',
	preparedUrl: 'p',
	version: '1',
	snapshotCache: 'c'
});
const stats = { version: '1', bootMs: 1, library: 'source' as const, libraryMs: 1, memoryMiB: 1 };

function answer(w: StandInWorker, m: ToolkitInbound) {
	if (m.type === 'init') w.reply({ type: 'ready', stats });
	if (m.type === 'call') w.reply({ type: 'result', id: m.id, ok: true, result: m.id });
}

afterEach(() => {
	vi.useRealTimers();
});

describe('engine worker supervision', () => {
	it('a crash with several calls in flight restarts once and answers every call', async () => {
		const workers: StandInWorker[] = [];
		const client = startToolkit(init, {
			createWorker: () => {
				const first = workers.length === 0;
				const w = new StandInWorker((w, m) => {
					// The first worker dies (out of memory) on its third call, before answering any.
					if (first && m.type === 'call') {
						if (w.received.filter((r) => r.type === 'call').length === 3) w.crash('out of memory');
						return;
					}
					answer(w, m);
				});
				workers.push(w);
				return w as unknown as Worker;
			}
		});
		const calls = [client.call('version'), client.call('version'), client.call('version')];
		const results = await Promise.all(calls);
		expect(results).toHaveLength(3);
		expect(workers).toHaveLength(2);
		expect(workers[0]!.terminated).toBe(true);
		// Each call was sent again to the new worker once, after its init.
		expect(workers[1]!.received.map((m) => m.type)).toEqual(['init', 'call', 'call', 'call']);
		expect(client.failed).toBeNull();
	});

	it('a crash later in the session, after a restart was used, is final and said once', async () => {
		const onFailure = vi.fn();
		let crashes = 0;
		const client = startToolkit(init, {
			onFailure,
			createWorker: () =>
				new StandInWorker((w, m) => {
					if (m.type === 'call' && m.method === 'analyzeProject') {
						crashes++;
						w.reply({ type: 'fatal', error: 'RuntimeError: unreachable' });
						return;
					}
					answer(w, m);
				}) as unknown as Worker
		});
		await expect(client.call('version')).resolves.toBeDefined();
		await expect(client.call('analyzeProject', [])).rejects.toThrow(
			/Fairtide stopped reading the model \(RuntimeError: unreachable\)\. Reload the page/
		);
		// Sent to the first worker and once more to its replacement.
		expect(crashes).toBe(2);
		expect(onFailure).toHaveBeenCalledTimes(1);
		await expect(client.call('version')).rejects.toThrow(/Reload the page/);
	});

	it('a call the worker never answers fails after a time limit', async () => {
		vi.useFakeTimers();
		const client = startToolkit(init, {
			createWorker: () =>
				new StandInWorker((w, m) => {
					if (m.type === 'init') w.reply({ type: 'ready', stats });
					// Calls are never answered.
				}) as unknown as Worker
		});
		let settled = false;
		const call = client.call('analyzeProject', []).then(
			() => (settled = true),
			() => (settled = true)
		);
		await vi.advanceTimersByTimeAsync(10 * 60_000);
		expect(settled).toBe(true);
		await call;
	});

	it('a stuck call says why, the worker is replaced, and the calls behind it are answered', async () => {
		vi.useFakeTimers();
		const onTooLong = vi.fn();
		const workers: StandInWorker[] = [];
		const client = startToolkit(init, {
			onTooLong,
			createWorker: () => {
				const first = workers.length === 0;
				const w = new StandInWorker((w, m) => {
					// The first worker gets stuck in its analysis; it answers nothing after it.
					if (first && m.type === 'call' && m.method === 'analyzeProject') w.stuck = true;
					if (w.stuck && m.type === 'call') return;
					answer(w, m);
				});
				workers.push(w);
				return w as unknown as Worker;
			}
		});
		await client.call('version');
		const stuck = client.call('analyzeProject', []);
		const failure = stuck.catch((error: Error) => error.message);
		const behind = client.call('hover', [], 'a.sysml', 0);
		// Well within the time limit nothing gives up.
		await vi.advanceTimersByTimeAsync(4 * 60_000);
		expect(workers).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(await failure).toBe(
			'Reading the model took longer than 5 minutes, so Fairtide stopped it and started again. ' +
				'If it keeps happening, the project may be too large for this device: try splitting it into smaller projects.'
		);
		expect(onTooLong).toHaveBeenCalledTimes(1);
		expect(workers).toHaveLength(2);
		expect(workers[0]!.terminated).toBe(true);
		// The call behind it went to the new worker, not the stuck call again.
		await expect(behind).resolves.toBeDefined();
		expect(workers[1]!.received.map((m) => (m.type === 'call' ? m.method : m.type))).toEqual([
			'init',
			'hover'
		]);
		// The engine goes on working, and a later crash still has its restart.
		await expect(client.call('version')).resolves.toBeDefined();
		expect(client.failed).toBeNull();
	});

	it("a call's clock starts when the worker gets to it, not while it waits its turn or the library loads", async () => {
		vi.useFakeTimers();
		const workers: StandInWorker[] = [];
		const client = startToolkit(init, {
			createWorker: () => {
				// The library takes 20 minutes to download (a slow connection); then the worker does
				// its calls one at a time, 4 minutes each (a large model on a slow phone).
				const queue: { id: number }[] = [];
				let loaded = false;
				const next = (w: StandInWorker) => {
					const m = queue[0];
					if (!m || !loaded) return;
					setTimeout(() => {
						queue.shift();
						w.reply({ type: 'result', id: m.id, ok: true, result: m.id });
						next(w);
					}, 4 * 60_000);
				};
				const w = new StandInWorker((w, m) => {
					if (m.type === 'init')
						setTimeout(() => {
							loaded = true;
							w.reply({ type: 'ready', stats });
							next(w);
						}, 20 * 60_000);
					if (m.type === 'call' && queue.push(m) === 1) next(w);
				});
				workers.push(w);
				return w as unknown as Worker;
			}
		});
		const analysis = client.call('analyzeProject', []);
		const checks = client.call('checks', []);
		await vi.advanceTimersByTimeAsync(24 * 60_000);
		await expect(analysis).resolves.toBeDefined();
		await vi.advanceTimersByTimeAsync(4 * 60_000);
		await expect(checks).resolves.toBeDefined();
		expect(workers).toHaveLength(1);
	});
});
