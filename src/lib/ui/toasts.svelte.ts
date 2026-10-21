/** Short, dismissible notices, optionally with one action such as Undo. */

export interface Toast {
	id: number;
	message: string;
	tone: 'info' | 'success' | 'error';
	action?: { label: string; run: () => void };
}

const DURATION_MS = 6000;

class Toasts {
	items = $state<Toast[]>([]);
	private next = 1;

	show(message: string, options: Omit<Partial<Toast>, 'id' | 'message'> = {}) {
		const toast: Toast = { id: this.next++, message, tone: options.tone ?? 'info', ...options };
		this.items = [...this.items.slice(-2), toast];
		setTimeout(() => this.dismiss(toast.id), DURATION_MS);
		return toast.id;
	}

	dismiss(id: number) {
		this.items = this.items.filter((t) => t.id !== id);
	}
}

export const toasts = new Toasts();
