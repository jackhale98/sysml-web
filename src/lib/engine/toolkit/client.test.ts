import { describe, expect, it, vi } from 'vitest';
import { MEMORY_WARNING_MIB, memoryWarning, startToolkit } from './client';
import type { ToolkitInbound, ToolkitOutbound } from './protocol';

/** A stand-in worker that answers as a script says. */
class FakeWorker {
	onmessage: ((event: MessageEvent<ToolkitOutbound>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	terminated = false;
	readonly received: ToolkitInbound[] = [];
	constructor(private readonly behave: (w: FakeWorker, m: ToolkitInbound) => void) {}
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

/** Workers that work. */
const healthy = (w: FakeWorker, m: ToolkitInbound) => {
	if (m.type === 'init') w.reply({ type: 'ready', stats });
	if (m.type === 'call') w.reply({ type: 'result', id: m.id, ok: true, result: `${m.method}!` });
};

describe('startToolkit', () => {
	it('starts on the first call and answers', async () => {
		const workers: FakeWorker[] = [];
		const onReady = vi.fn();
		const client = startToolkit(init, {
			onReady,
			createWorker: () => {
				const w = new FakeWorker(healthy);
				workers.push(w);
				return w as unknown as Worker;
			}
		});
		expect(workers).toHaveLength(0);
		await expect(client.call('version')).resolves.toBe('version!');
		expect(workers).toHaveLength(1);
		expect(workers[0]!.received[0]).toMatchObject({ type: 'init', glueUrl: 'g' });
		expect(onReady).toHaveBeenCalledWith(stats);
		expect(client.stats).toEqual(stats);
	});

	it('passes on ordinary errors without restarting', async () => {
		const workers: FakeWorker[] = [];
		const client = startToolkit(init, {
			createWorker: () => {
				const w = new FakeWorker((w, m) => {
					if (m.type === 'call')
						w.reply({ type: 'result', id: m.id, ok: false, error: 'not found' });
				});
				workers.push(w);
				return w as unknown as Worker;
			}
		});
		await expect(client.call('version')).rejects.toThrow('not found');
		expect(workers).toHaveLength(1);
	});

	it('restarts a worker that dies once, and sends the call again', async () => {
		const workers: FakeWorker[] = [];
		const client = startToolkit(init, {
			createWorker: () => {
				const first = workers.length === 0;
				const w = new FakeWorker((w, m) => {
					if (first && m.type === 'call')
						w.reply({
							type: 'result',
							id: m.id,
							ok: false,
							error: 'RuntimeError: unreachable',
							fatal: true
						});
					else healthy(w, m);
				});
				workers.push(w);
				return w as unknown as Worker;
			}
		});
		await expect(client.call('analyzeProject', [])).resolves.toBe('analyzeProject!');
		expect(workers).toHaveLength(2);
		expect(workers[0]!.terminated).toBe(true);
		expect(client.failed).toBeNull();
	});

	it('gives up after the restart fails too, and says so once', async () => {
		const workers: FakeWorker[] = [];
		const onFailure = vi.fn();
		const client = startToolkit(init, {
			onFailure,
			createWorker: () => {
				const w = new FakeWorker((w, m) => {
					if (m.type === 'init') w.crash('out of memory');
				});
				workers.push(w);
				return w as unknown as Worker;
			}
		});
		await expect(client.call('version')).rejects.toThrow(
			/stopped reading the model \(out of memory\)/
		);
		expect(workers).toHaveLength(2);
		expect(onFailure).toHaveBeenCalledTimes(1);
		await expect(client.call('version')).rejects.toThrow(/Reload the page/);
		expect(workers).toHaveLength(2);
		expect(onFailure).toHaveBeenCalledTimes(1);
	});

	it('asks for the snapshot once the library is up', async () => {
		const workers: FakeWorker[] = [];
		const client = startToolkit(init, {
			createWorker: () => {
				const w = new FakeWorker(healthy);
				workers.push(w);
				return w as unknown as Worker;
			}
		});
		client.prefetchSnapshot();
		await client.call('version');
		expect(workers[0]!.received.map((m) => m.type)).toContain('prefetch');
	});

	it('warns once when the engine nears its memory ceiling', async () => {
		const onMemoryHigh = vi.fn();
		let used = 1100;
		const client = startToolkit(init, {
			onMemoryHigh,
			createWorker: () =>
				new FakeWorker((w, m) => {
					if (m.type === 'init') w.reply({ type: 'ready', stats });
					if (m.type === 'call')
						w.reply({ type: 'result', id: m.id, ok: true, result: null, memoryMiB: used });
				}) as unknown as Worker
		});
		await client.call('analyzeProject', []);
		expect(onMemoryHigh).not.toHaveBeenCalled();
		used = 1780;
		await client.call('analyzeProject', []);
		used = 1950;
		await client.call('checks', []);
		expect(onMemoryHigh).toHaveBeenCalledTimes(1);
		expect(onMemoryHigh).toHaveBeenCalledWith(1780);
		expect(MEMORY_WARNING_MIB).toBeLessThan(1780);
		expect(memoryWarning(1780)).toBe(
			'This project is close to the most Tessera can hold in a browser tab (1.7 of 2 GB used). ' +
				'If it grows much more, the model will stop updating. Move parts of it into separate projects; ' +
				'reloading the page frees some memory for a while.'
		);
	});
});
