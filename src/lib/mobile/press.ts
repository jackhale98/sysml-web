/**
 * A long press on a touch screen (or with a pen): what a right click does
 * with a mouse, such as opening an item's menu. A mouse is left alone; its
 * right click is the `contextmenu` event.
 */
const LONG_PRESS_MS = 500;
/** Further than this and it is a scroll, not a press. */
const SLOP_PX = 10;

export interface LongPress {
	/** On `pointerdown`: `run` once the finger has stayed put long enough. */
	start(event: PointerEvent, run: () => void): void;
	/** On `pointermove`. */
	move(event: PointerEvent): void;
	/** On `pointerup`, `pointercancel` and `pointerleave`, or when a menu opened another way. */
	cancel(): void;
	/** True, once, for the click that ends a long press: it shouldn't also act. */
	fired(): boolean;
}

export function longPress(): LongPress {
	let held: { timer: ReturnType<typeof setTimeout>; x: number; y: number } | null = null;
	let fired = false;
	const cancel = () => {
		if (held) clearTimeout(held.timer);
		held = null;
	};
	return {
		start(event, run) {
			if (event.pointerType === 'mouse') return;
			cancel();
			fired = false;
			held = {
				x: event.clientX,
				y: event.clientY,
				timer: setTimeout(() => {
					held = null;
					fired = true;
					navigator.vibrate?.(10);
					run();
				}, LONG_PRESS_MS)
			};
		},
		move(event) {
			if (held && Math.hypot(event.clientX - held.x, event.clientY - held.y) > SLOP_PX) cancel();
		},
		cancel,
		fired() {
			const was = fired;
			fired = false;
			return was;
		}
	};
}
