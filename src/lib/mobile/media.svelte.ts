/**
 * Phone detection and the visual viewport, for the touch-first layout.
 *
 * `phone` follows the same breakpoint as the CSS (≤ 760 px). The viewport
 * tracker publishes the space the on-screen keyboard leaves as CSS custom
 * properties, so the app shell can shrink to it instead of being panned.
 */
import { MediaQuery } from 'svelte/reactivity';

export const PHONE_QUERY = '(max-width: 760px)';

let query: MediaQuery | undefined;

/** Whether the phone layout is in use (reactive). */
export function isPhone(): boolean {
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
	query ??= new MediaQuery(PHONE_QUERY);
	return query.current;
}

/**
 * Keep `--app-height` (the visible height) and `--keyboard-inset` on the root
 * element in step with the visual viewport. Chrome on Android resizes the
 * layout viewport itself (see `interactive-widget` in app.html), so the inset
 * there is zero; iOS Safari only shrinks the visual viewport.
 */
export function trackViewport(): () => void {
	const vv = window.visualViewport;
	const root = document.documentElement;
	if (!vv) return () => {};
	let frame = 0;
	const update = () => {
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(() => {
			const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
			// A pinch zoom also shrinks the visual viewport: only a keyboard does it at scale 1.
			const keyboard = inset > 80 && Math.abs(vv.scale - 1) < 0.01;
			if (keyboard) {
				root.style.setProperty('--app-height', `${Math.round(vv.height)}px`);
				root.style.setProperty('--app-top', `${Math.round(vv.offsetTop)}px`);
				root.style.setProperty('--keyboard-inset', `${inset}px`);
				root.dataset.keyboard = 'open';
			} else {
				root.style.removeProperty('--app-height');
				root.style.removeProperty('--app-top');
				root.style.removeProperty('--keyboard-inset');
				delete root.dataset.keyboard;
			}
		});
	};
	vv.addEventListener('resize', update);
	vv.addEventListener('scroll', update);
	update();
	return () => {
		cancelAnimationFrame(frame);
		vv.removeEventListener('resize', update);
		vv.removeEventListener('scroll', update);
		root.style.removeProperty('--app-height');
		root.style.removeProperty('--app-top');
		root.style.removeProperty('--keyboard-inset');
		delete root.dataset.keyboard;
	};
}
