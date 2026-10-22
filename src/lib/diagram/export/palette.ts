/**
 * The colours an exported diagram is drawn in: the app's light and dark
 * design tokens (`src/lib/styles/global.css`, kept in step by a test) with
 * the per-kind mixes SysmlNode.svelte makes with `color-mix(in oklab, …)`
 * worked out here, so the file needs no CSS at all.
 */
import type { Family } from '#lib/ui/kinds.ts';

export type ExportTheme = 'light' | 'dark';

export interface Tokens {
	bg: string;
	surface: string;
	border: string;
	borderStrong: string;
	text: string;
	text2: string;
	text3: string;
	kinds: Record<Family, string>;
}

export const TOKENS: Record<ExportTheme, Tokens> = {
	light: {
		bg: '#f6f6f3',
		surface: '#ffffff',
		border: '#e5e4de',
		borderStrong: '#d2d1c9',
		text: '#1a1b1e',
		text2: '#50535a',
		text3: '#686b72',
		kinds: {
			structure: '#3b5bdb',
			interface: '#0b7285',
			behavior: '#2b8a3e',
			requirement: '#9c36b5',
			analysis: '#c2410c',
			package: '#5c6370',
			view: '#5f3dc4'
		}
	},
	dark: {
		bg: '#0f1012',
		surface: '#16171a',
		border: '#2a2c31',
		borderStrong: '#3a3d43',
		text: '#ecedef',
		text2: '#a9acb3',
		text3: '#8f939b',
		kinds: {
			structure: '#91a7ff',
			interface: '#66d9e8',
			behavior: '#69db7c',
			requirement: '#e599f7',
			analysis: '#ffa94d',
			package: '#adb5bd',
			view: '#b197fc'
		}
	}
};

/** Colours of one element family, as a node draws them. */
export interface FamilyColors {
	/** Icon colour. */
	ink: string;
	/** Border and compartment rules: `color-mix(in oklab, fam 55%, text-2)`. */
	line: string;
	/** Header fill: `color-mix(in oklab, fam 11%, surface)`. */
	tint: string;
	/** A package's tab: `color-mix(in oklab, fam 22%, surface)`. */
	tab: string;
}

export function familyColors(tokens: Tokens, family: Family): FamilyColors {
	const ink = tokens.kinds[family];
	return {
		ink,
		line: mixOklab(ink, tokens.text2, 0.55),
		tint: mixOklab(ink, tokens.surface, 0.11),
		tab: mixOklab(ink, tokens.surface, 0.22)
	};
}

type Lab = [number, number, number];

function parseHex(hex: string): [number, number, number] {
	const h = hex.replace('#', '');
	const full =
		h.length === 3
			? h
					.split('')
					.map((c) => c + c)
					.join('')
			: h;
	return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as [number, number, number];
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function toOklab(hex: string): Lab {
	const [r, g, b] = parseHex(hex).map(toLinear) as [number, number, number];
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
	];
}

function fromOklab([L, a, b]: Lab): string {
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
	const rgb = [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
	];
	return (
		'#' +
		rgb
			.map((c) =>
				Math.round(Math.min(1, Math.max(0, fromLinear(c))) * 255)
					.toString(16)
					.padStart(2, '0')
			)
			.join('')
	);
}

/** `color-mix(in oklab, a weight, b)`, as a hex colour. */
export function mixOklab(a: string, b: string, weight: number): string {
	const x = toOklab(a);
	const y = toOklab(b);
	return fromOklab([0, 1, 2].map((i) => x[i]! * weight + y[i]! * (1 - weight)) as Lab);
}
