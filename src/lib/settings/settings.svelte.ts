/**
 * Preferences for this browser, kept in local storage. Read them anywhere
 * as plain reactive fields (`settings.editorFontSize`); change them by
 * assignment. The theme lives in `#lib/ui/theme.svelte.ts`.
 *
 * Applied to the page as soon as they load or change:
 * - `<html data-density="compact">` plus tighter spacing tokens;
 * - `<html data-motion="reduce">`, with animations and transitions off;
 * - `--editor-font-size` on `<html>`.
 */

export type Density = 'comfortable' | 'compact';
export type MotionChoice = 'system' | 'reduce' | 'allow';
export type PhoneStart = 'diagram' | 'text';

export interface SettingsValues {
	density: Density;
	motion: MotionChoice;
	/** Pixels. */
	editorFontSize: number;
	lineWrapping: boolean;
	lineNumbers: boolean;
	/** What a phone shows first when a file opens. */
	phoneStart: PhoneStart;
}

export const DEFAULTS: SettingsValues = {
	density: 'comfortable',
	motion: 'system',
	editorFontSize: 13,
	lineWrapping: false,
	lineNumbers: true,
	phoneStart: 'text'
};

export const FONT_SIZES = { min: 11, max: 20 };

const KEY = 'sysml-web:settings';

/** Stored values, checked one by one so a bad or older entry falls back to the default. */
export function parseSettings(raw: string | null): SettingsValues {
	let stored: Partial<Record<keyof SettingsValues, unknown>> = {};
	try {
		stored = raw ? (JSON.parse(raw) as typeof stored) : {};
	} catch {
		stored = {};
	}
	const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T =>
		allowed.includes(value as T) ? (value as T) : fallback;
	const size = Number(stored.editorFontSize);
	return {
		density: pick(stored.density, ['comfortable', 'compact'] as const, DEFAULTS.density),
		motion: pick(stored.motion, ['system', 'reduce', 'allow'] as const, DEFAULTS.motion),
		editorFontSize:
			Number.isFinite(size) && size >= FONT_SIZES.min && size <= FONT_SIZES.max
				? Math.round(size)
				: DEFAULTS.editorFontSize,
		lineWrapping:
			typeof stored.lineWrapping === 'boolean' ? stored.lineWrapping : DEFAULTS.lineWrapping,
		lineNumbers:
			typeof stored.lineNumbers === 'boolean' ? stored.lineNumbers : DEFAULTS.lineNumbers,
		phoneStart: pick(stored.phoneStart, ['diagram', 'text'] as const, DEFAULTS.phoneStart)
	};
}

/** Tighter spacing for compact density (inline on <html>, so it overrides the tokens). */
const COMPACT_TOKENS: Record<string, string> = {
	'--space-2': '0.375rem',
	'--space-3': '0.5rem',
	'--space-4': '0.75rem',
	'--space-5': '1.125rem',
	'--topbar-height': '2.75rem',
	'--text-md': '0.8125rem'
};

const MOTION_STYLE_ID = 'sysml-web-reduced-motion';

class Settings implements SettingsValues {
	density = $state<Density>(DEFAULTS.density);
	motion = $state<MotionChoice>(DEFAULTS.motion);
	editorFontSize = $state(DEFAULTS.editorFontSize);
	lineWrapping = $state(DEFAULTS.lineWrapping);
	lineNumbers = $state(DEFAULTS.lineNumbers);
	phoneStart = $state<PhoneStart>(DEFAULTS.phoneStart);

	/** Whether the system asks for less motion. */
	private systemReduced = $state(false);
	private started = false;

	/** Whether animations should be avoided: the override, else the system setting. */
	get reducedMotion(): boolean {
		return this.motion === 'reduce' || (this.motion === 'system' && this.systemReduced);
	}

	get values(): SettingsValues {
		return {
			density: this.density,
			motion: this.motion,
			editorFontSize: this.editorFontSize,
			lineWrapping: this.lineWrapping,
			lineNumbers: this.lineNumbers,
			phoneStart: this.phoneStart
		};
	}

	/** Load, apply and keep saving (once per page; safe to call again). */
	init() {
		if (this.started || typeof window === 'undefined') return;
		this.started = true;
		let raw: string | null = null;
		try {
			raw = localStorage.getItem(KEY);
		} catch {
			// Unavailable: defaults.
		}
		Object.assign(this, parseSettings(raw));
		const query = matchMedia('(prefers-reduced-motion: reduce)');
		this.systemReduced = query.matches;
		query.addEventListener('change', () => (this.systemReduced = query.matches));
		$effect.root(() => {
			$effect(() => {
				const values = this.values;
				apply(values);
				try {
					localStorage.setItem(KEY, JSON.stringify(values));
				} catch {
					// Private mode: applies for this visit.
				}
			});
		});
	}

	reset() {
		Object.assign(this, DEFAULTS);
	}
}

function apply(values: SettingsValues) {
	const root = document.documentElement;
	root.dataset.density = values.density;
	for (const [name, value] of Object.entries(COMPACT_TOKENS)) {
		if (values.density === 'compact') root.style.setProperty(name, value);
		else root.style.removeProperty(name);
	}
	root.style.setProperty('--editor-font-size', `${values.editorFontSize}px`);
	if (values.motion === 'system') delete root.dataset.motion;
	else root.dataset.motion = values.motion;
	// The reduced-motion override needs a rule; the system preference has one in global.css.
	let style = document.getElementById(MOTION_STYLE_ID);
	if (values.motion === 'reduce' && !style) {
		style = Object.assign(document.createElement('style'), { id: MOTION_STYLE_ID });
		style.textContent = `html[data-motion='reduce'] *, html[data-motion='reduce'] *::before, html[data-motion='reduce'] *::after { transition-duration: 0ms !important; animation-duration: 0ms !important; animation-iteration-count: 1 !important; scroll-behavior: auto !important; }`;
		document.head.append(style);
	} else if (values.motion !== 'reduce') style?.remove();
}

export const settings = new Settings();
