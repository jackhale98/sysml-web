/**
 * Vertical drag for bottom sheets: the sheet follows the finger and, on
 * release, gets the distance dragged and the speed (px/ms) to settle with.
 *
 * Drags start only on elements marked `data-sheet-drag` (the grabber and the
 * sheet's header), which set `touch-action: none` so the browser does not
 * scroll instead. A press that barely moves stays a tap.
 */

export interface DragHandlers {
	/** Called once the pointer has moved far enough to be a drag. */
	start?: () => void;
	move: (dy: number) => void;
	end: (dy: number, velocity: number) => void;
}

const THRESHOLD = 6;
const INTERACTIVE =
	'input, select, textarea, a, button:not([data-sheet-grip]), [contenteditable="true"]';

export function verticalDrag(handlers: DragHandlers) {
	return (node: HTMLElement) => {
		let pointer: number | null = null;
		let origin = 0;
		let last = 0;
		let lastTime = 0;
		let velocity = 0;
		let dragging = false;
		let swallowClick = false;

		function down(event: PointerEvent) {
			if (event.pointerType === 'mouse' && event.button !== 0) return;
			const target = event.target as Element | null;
			if (!target?.closest('[data-sheet-drag]') || target.closest(INTERACTIVE)) return;
			pointer = event.pointerId;
			origin = last = event.clientY;
			lastTime = event.timeStamp;
			velocity = 0;
			dragging = false;
		}

		function move(event: PointerEvent) {
			if (event.pointerId !== pointer) return;
			const dy = event.clientY - origin;
			if (!dragging) {
				if (Math.abs(dy) < THRESHOLD) return;
				dragging = true;
				node.setPointerCapture(event.pointerId);
				handlers.start?.();
			}
			const dt = event.timeStamp - lastTime;
			if (dt > 0) velocity = 0.7 * ((event.clientY - last) / dt) + 0.3 * velocity;
			last = event.clientY;
			lastTime = event.timeStamp;
			event.preventDefault();
			handlers.move(dy);
		}

		function up(event: PointerEvent) {
			if (event.pointerId !== pointer) return;
			pointer = null;
			if (!dragging) return;
			dragging = false;
			swallowClick = true;
			setTimeout(() => (swallowClick = false), 0);
			// A pause before letting go means "stay here", not a flick.
			const still = event.timeStamp - lastTime > 80;
			handlers.end(event.clientY - origin, still ? 0 : velocity);
		}

		function click(event: MouseEvent) {
			if (!swallowClick) return;
			swallowClick = false;
			event.preventDefault();
			event.stopPropagation();
		}

		node.addEventListener('pointerdown', down);
		node.addEventListener('pointermove', move);
		node.addEventListener('pointerup', up);
		node.addEventListener('pointercancel', up);
		node.addEventListener('click', click, true);
		return () => {
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('pointermove', move);
			node.removeEventListener('pointerup', up);
			node.removeEventListener('pointercancel', up);
			node.removeEventListener('click', click, true);
		};
	};
}

/** Whether the user asked for less motion. */
export function reducedMotion(): boolean {
	return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
