/**
 * Diagram export in the browser: the SVG measured with the app's own fonts,
 * a PNG rasterised from it (fonts embedded, as an image cannot see the
 * page's), and handing either to the person: download, the share sheet on
 * phones, or the clipboard. Loaded only when someone exports.
 */
import interUrl from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url';
import monoUrl from '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?url';
import { saveFile } from '#lib/dataio/export.ts';
import type { ExportTheme } from './palette.ts';
import {
	buildSvg,
	exportFileName,
	pngScale,
	type BuiltSvg,
	type ExportDiagram,
	type Measure
} from './svg.ts';

export interface ExportOptions {
	theme: ExportTheme;
	/** Leave the background transparent (else white, or the dark canvas). */
	transparent: boolean;
}

let context: CanvasRenderingContext2D | null | undefined;

/** Text widths in the fonts the page has loaded (Inter, JetBrains Mono). */
const measure: Measure = (text, font) => {
	context ??= document.createElement('canvas').getContext('2d');
	if (!context) return text.length * font.size * 0.58;
	context.font = `${font.italic ? 'italic ' : ''}${font.weight ?? 400} ${font.size}px ${
		font.mono ? "'JetBrains Mono Variable', monospace" : "'Inter Variable', sans-serif"
	}`;
	return context.measureText(text).width;
};

async function build(diagram: ExportDiagram, options: ExportOptions, fontFaces?: string) {
	await document.fonts?.ready;
	return buildSvg(diagram, {
		theme: options.theme,
		background: !options.transparent,
		measure,
		fontFaces
	});
}

export async function svgText(diagram: ExportDiagram, options: ExportOptions): Promise<string> {
	const { svg } = await build(diagram, options);
	return `<?xml version="1.0" encoding="UTF-8"?>\n${svg}\n`;
}

let faces: Promise<string> | undefined;

/** `@font-face` rules carrying the app's Latin fonts as data URLs. */
function fontFaces(): Promise<string> {
	faces ??= Promise.all(
		[
			['Inter Variable', interUrl],
			['JetBrains Mono Variable', monoUrl]
		].map(async ([family, url]) => {
			const bytes = await (await fetch(url!)).arrayBuffer();
			const data = await dataUrl(new Blob([bytes], { type: 'font/woff2' }));
			return `@font-face{font-family:'${family}';font-weight:100 900;src:url(${data}) format('woff2')}`;
		})
	)
		.then((rules) => rules.join(''))
		.catch(() => {
			faces = undefined;
			return '';
		});
	return faces;
}

function dataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
}

export async function pngBlob(
	diagram: ExportDiagram,
	options: ExportOptions,
	wanted = 2
): Promise<Blob> {
	const built: BuiltSvg = await build(diagram, options, await fontFaces());
	const url = URL.createObjectURL(new Blob([built.svg], { type: 'image/svg+xml' }));
	try {
		const image = new Image();
		image.src = url;
		await image.decode();
		const scale = pngScale(built.width, built.height, wanted);
		const canvas = document.createElement('canvas');
		canvas.width = Math.round(built.width * scale);
		canvas.height = Math.round(built.height * scale);
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('this browser cannot draw images');
		ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
		if (!blob) throw new Error('the image is too large to draw');
		return blob;
	} finally {
		URL.revokeObjectURL(url);
	}
}

/** Save the diagram as `<title>.svg` (or share it, on phones). */
export async function saveSvg(
	diagram: ExportDiagram,
	title: string,
	options: ExportOptions,
	share: boolean
) {
	const svg = await svgText(diagram, options);
	await saveFile(exportFileName(title, 'svg'), svg, 'image/svg+xml', share);
}

export async function savePng(
	diagram: ExportDiagram,
	title: string,
	options: ExportOptions,
	share: boolean
) {
	const blob = await pngBlob(diagram, options);
	await saveFile(
		exportFileName(title, 'png'),
		new Uint8Array(await blob.arrayBuffer()),
		'image/png',
		share
	);
}
