/**
 * The app as an installed, offline-capable web app: whether the network is
 * reachable, the service worker (registered after the page has loaded), a
 * quiet "new version" notice, and the browser's install prompt.
 */
import { dev } from '$app/env';
import { resolve } from '$app/paths';
import { toasts } from '#lib/ui/toasts.svelte.ts';

/** Chromium's install prompt (not in the DOM typings). */
interface InstallPromptEvent extends Event {
	prompt(): Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Look for a new version this often while the app stays open. */
const UPDATE_CHECK_MS = 60 * 60 * 1000;

class Pwa {
	/** Whether the browser has a network connection. */
	online = $state(true);
	/** A new version is installed and waiting for a reload. */
	updateReady = $state(false);
	/** The browser offered to install the app (Chromium, not yet installed). */
	canInstall = $state(false);

	private started = false;
	private installPrompt: InstallPromptEvent | null = null;
	private registration: ServiceWorkerRegistration | null = null;
	private reloading = false;
	private guards = new Set<() => Promise<boolean> | boolean>();

	init() {
		if (this.started || typeof window === 'undefined') return;
		this.started = true;

		this.online = navigator.onLine;
		addEventListener('online', () => (this.online = true));
		addEventListener('offline', () => (this.online = false));

		addEventListener('beforeinstallprompt', (event) => {
			event.preventDefault();
			this.installPrompt = event as InstallPromptEvent;
			this.canInstall = true;
		});
		addEventListener('appinstalled', () => {
			this.installPrompt = null;
			this.canInstall = false;
		});

		if (dev || !('serviceWorker' in navigator)) return;
		// After the page has loaded and gone idle: never in the way of the first paint.
		const later = () => {
			const idle = window.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 1000));
			idle(() => void this.register(), { timeout: 5000 });
		};
		if (document.readyState === 'complete') later();
		else addEventListener('load', later, { once: true });
	}

	private async register() {
		const sw = navigator.serviceWorker;
		// A page loaded without a worker gets one on first install: that's not an update.
		let controlled = !!sw.controller;
		sw.addEventListener('controllerchange', () => {
			if (this.reloading) location.reload();
			else if (controlled) this.announce();
			controlled = true;
		});

		let registration: ServiceWorkerRegistration;
		try {
			registration = await sw.register(`${resolve('/')}service-worker.js`, { type: 'module' });
		} catch {
			return; // Private mode or blocked by the browser: the app still works online.
		}
		this.registration = registration;
		if (registration.waiting && sw.controller) this.announce();
		registration.addEventListener('updatefound', () => {
			const installing = registration.installing;
			installing?.addEventListener('statechange', () => {
				if (installing.state === 'installed' && sw.controller) this.announce();
			});
		});

		// Long sessions (a laptop left open in the lab) still hear about new versions.
		setInterval(() => {
			if (this.online && document.visibilityState === 'visible') void registration.update();
		}, UPDATE_CHECK_MS);
	}

	private announce() {
		if (this.updateReady) return;
		this.updateReady = true;
		toasts.show('A new version is ready.', {
			duration: 0,
			action: { label: 'Reload', run: () => void this.reload() }
		});
	}

	/**
	 * Run `guard` before reloading for a new version: it saves pending work and
	 * returns false to stay on the page. Returns a function that removes it.
	 */
	guardReload(guard: () => Promise<boolean> | boolean): () => void {
		this.guards.add(guard);
		return () => this.guards.delete(guard);
	}

	/** Switch to the new version: save first, then reload this tab. */
	async reload() {
		for (const guard of this.guards) if (!(await guard())) return;
		const waiting = this.registration?.waiting;
		if (waiting) {
			this.reloading = true;
			waiting.postMessage({ type: 'skip-waiting' });
		} else {
			location.reload(); // Already active (another tab switched).
		}
	}

	/** Show the browser's install dialog. */
	async install() {
		const prompt = this.installPrompt;
		if (!prompt) return;
		this.installPrompt = null;
		this.canInstall = false;
		await prompt.prompt();
	}

	/**
	 * Once the engine has started, have the worker fill in any engine files it
	 * hasn't cached yet (when idle), so the engine works offline next time.
	 */
	warmEngineCache() {
		if (dev || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
		const idle = window.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 2000));
		idle(
			() =>
				void navigator.serviceWorker.ready.then((registration) =>
					registration.active?.postMessage({ type: 'warm-engine' })
				),
			{ timeout: 10_000 }
		);
	}
}

export const pwa = new Pwa();
