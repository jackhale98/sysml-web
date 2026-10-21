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

class Toasts {
	items = $state<Toast[]>([]);
	private next = 1;

	show(message: string, options: Omit<Partial<Toast>, 'id' | 'message'> = {}) {
		const toast: Toast = { id: this.next++, message, tone: options.tone ?? 'info', ...options };
		// Up to three at once; one that stays until dismissed isn't pushed out by later ones.
		const stays = this.items.filter((t) => t.duration === 0);
		const others = this.items.filter((t) => t.duration !== 0);
		const room = Math.max(0, 2 - stays.length);
		this.items = [...stays, ...others.slice(others.length - room), toast];
		const duration = options.duration ?? DURATION_MS;
		if (duration > 0) setTimeout(() => this.dismiss(toast.id), duration);
		return toast.id;
	}

	dismiss(id: number) {
		this.items = this.items.filter((t) => t.id !== id);
	}
}

export const toasts = new Toasts();
