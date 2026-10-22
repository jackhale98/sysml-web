/** Short, dismissible notices, optionally with one action such as Undo. */

export interface Toast {
	id: number;
	message: string;
	tone: 'info' | 'success' | 'error';
	action?: { label: string; run: () => void };
	/** How long it stays, in ms; 0 keeps it until dismissed. */
	duration?: number;
}

const DURATION_MS = 6000;

interface Timer {
	handle?: ReturnType<typeof setTimeout>;
	/** When it was last started, and what was left of its time then. */
	started: number;
	left: number;
}

class Toasts {
	items = $state<Toast[]>([]);
	private next = 1;
	private timers = new Map<number, Timer>();
	private paused = false;

	show(message: string, options: Omit<Partial<Toast>, 'id' | 'message'> = {}) {
		const toast: Toast = { id: this.next++, message, tone: options.tone ?? 'info', ...options };
		// Up to three at once; one that stays until dismissed isn't pushed out by later ones.
		const stays = this.items.filter((t) => t.duration === 0);
		const others = this.items.filter((t) => t.duration !== 0);
		const room = Math.max(0, 2 - stays.length);
		this.items = [...stays, ...others.slice(others.length - room), toast];
		const duration = options.duration ?? DURATION_MS;
		if (duration > 0) {
			const timer: Timer = { started: Date.now(), left: duration };
			this.timers.set(toast.id, timer);
			if (!this.paused) this.run(toast.id, timer);
		}
		return toast.id;
	}

	dismiss(id: number) {
		clearTimeout(this.timers.get(id)?.handle);
		this.timers.delete(id);
		this.items = this.items.filter((t) => t.id !== id);
	}

	/**
	 * Hold every toast while focus is in them, so one reached by keyboard
	 * doesn't go before its action is used (WCAG 2.2.1, timing adjustable).
	 */
	pause() {
		if (this.paused) return;
		this.paused = true;
		const now = Date.now();
		for (const timer of this.timers.values()) {
			clearTimeout(timer.handle);
			timer.left = Math.max(0, timer.left - (now - timer.started));
		}
	}

	/** Carry on, each with the time it had left (and at least a moment to move away). */
	resume() {
		if (!this.paused) return;
		this.paused = false;
		for (const [id, timer] of this.timers) {
			timer.left = Math.max(timer.left, 1500);
			this.run(id, timer);
		}
	}

	private run(id: number, timer: Timer) {
		timer.started = Date.now();
		timer.handle = setTimeout(() => this.dismiss(id), timer.left);
	}
}

export const toasts = new Toasts();
