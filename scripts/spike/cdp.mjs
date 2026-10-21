// SPIKE: a tiny raw CDP client (Node 22 WebSocket) for what Playwright's
// CDPSession cannot reach: dedicated-worker targets (heap usage), and
// browser-wide SystemInfo.
export class Cdp {
	static async connect(port) {
		const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
		const ws = new WebSocket(version.webSocketDebuggerUrl);
		await new Promise((resolve, reject) => {
			ws.onopen = resolve;
			ws.onerror = reject;
		});
		return new Cdp(ws);
	}
	constructor(ws) {
		this.ws = ws;
		this.next = 1;
		this.pending = new Map();
		this.listeners = [];
		ws.onmessage = (event) => {
			const msg = JSON.parse(event.data);
			if (msg.id && this.pending.has(msg.id)) {
				const { resolve, reject } = this.pending.get(msg.id);
				this.pending.delete(msg.id);
				if (msg.error) reject(new Error(`${msg.error.message} ${msg.error.data ?? ''}`));
				else resolve(msg.result);
			} else for (const l of this.listeners) l(msg);
		};
	}
	send(method, params = {}, sessionId) {
		const id = this.next++;
		this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
		return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
	}
	on(fn) {
		this.listeners.push(fn);
	}
	close() {
		this.ws.close();
	}
	/** Attach to the first target matching `pred`, flattened; returns the sessionId. */
	async attach(pred) {
		const { targetInfos } = await this.send('Target.getTargets');
		const t = targetInfos.find(pred);
		if (!t) return null;
		const { sessionId } = await this.send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
		return { sessionId, target: t };
	}
}
