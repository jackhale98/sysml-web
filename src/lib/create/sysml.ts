/**
 * Small pieces of SysML text the guided forms share: names, numbers with
 * units, doc comments, plain-language words for names, and the imports a
 * package needs for what the forms write into it. Pure, so the generators
 * built on them can be tested without a browser.
 */
import { sysmlName } from '#lib/project/names.ts';

export const name = sysmlName;

/** `doc /* text *\/`, with `*\/` in the text defused. */
export function docComment(text: string): string {
	const clean = text.replace(/\*\//g, '* /').replace(/\s+/g, ' ').trim();
	return `doc /* ${clean} */`;
}

/** The words of a name, lower case: `takeOffMass` → `take off mass`, `'Max mass'` → `max mass`. */
export function words(raw: string): string {
	return raw
		.replace(/^'|'$/g, '')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
		.replace(/[_\s]+/g, ' ')
		.trim()
		.split(' ')
		.map((w) => (/^[A-Z0-9]+$/.test(w) && w.length > 1 ? w : w.toLowerCase()))
		.join(' ');
}

/** A title from words: first letter upper case. */
export function sentenceCase(text: string): string {
	return text ? text[0]!.toUpperCase() + text.slice(1) : text;
}

function identifierWords(text: string): string[] {
	return text
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.split(/[^A-Za-z0-9]+/)
		.filter(Boolean);
}

/** `Mass budget` → `massBudget`; never empty, never starts with a digit. */
export function camelName(text: string, fallback = 'item'): string {
	const parts = identifierWords(text);
	if (!parts.length) return fallback;
	const out = parts
		.map((w, i) => (i === 0 ? w[0]!.toLowerCase() + w.slice(1) : w[0]!.toUpperCase() + w.slice(1)))
		.join('');
	return /^[0-9]/.test(out) ? `_${out}` : out;
}

/** `motor choice` → `MotorChoice`. */
export function pascalName(text: string, fallback = 'Item'): string {
	const camel = camelName(text, fallback);
	return camel[0] === '_' ? camel : camel[0]!.toUpperCase() + camel.slice(1);
}

/** A name not in `taken`: `name`, else `name2`, `name3`, … */
export function uniqueName(base: string, taken: Iterable<string>): string {
	const used = new Set(taken);
	if (!used.has(base)) return base;
	for (let i = 2; ; i++) if (!used.has(`${base}${i}`)) return `${base}${i}`;
}

/**
 * A number as SysML writes it: plain decimal (no exponent for everyday
 * magnitudes), at most 6 significant digits; `real` keeps a decimal point
 * (`260.0`), so the value is a Real rather than an Integer.
 */
export function numberText(value: number, real = false): string {
	if (!Number.isFinite(value)) return '0';
	let text = String(Number(value.toPrecision(6)));
	if (/e/i.test(text))
		text = value.toFixed(Math.max(0, 6 - Math.floor(Math.log10(Math.abs(value)))));
	if (real && !/[.eE]/.test(text)) text += '.0';
	return text;
}

/** `4 [kg]`, or a Real (`260.0`) without a unit. */
export function quantityText(value: number, unit: string | null): string {
	return unit ? `${numberText(value)} [${unit}]` : numberText(value, true);
}

/** A number as people read it (`4`, `0.25`, `1 250`): for statements and titles. */
export function readableNumber(value: number): string {
	return String(Number(value.toPrecision(6)));
}

/** A unit as people read it in a sentence (`W*h` → `W·h`). */
export function readableUnit(unit: string | null): string {
	return unit ? unit.replace(/\*/g, '·') : '';
}

// --- Imports ----------------------------------------------------------------

/** Where a package is written in its file (UTF-16 offsets of its declaration). */
export interface PackageAt {
	qualifiedName: string;
	from: number;
	to: number;
}

/** Whether the package's own text already imports `target` (itself or with its owner's `::*`). */
export function imports(packageText: string, target: string): boolean {
	const at = target.lastIndexOf('::');
	const owner = at > 0 ? target.slice(0, at) : null;
	const forms = [target, ...(owner ? [`${owner}::*`, `${owner}::**`] : [])].map(escape);
	return new RegExp(`\\bimport\\s+(?:all\\s+)?(?:${forms.join('|')})\\s*;`).test(packageText);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The file's text with `private import X;` added to the package for each
 * target it doesn't import yet: after its last import, else after its doc
 * comment, else at the top of its body, indented like its members.
 */
export function withImports(text: string, pkg: PackageAt, targets: readonly string[]): string {
	const body = bodyOf(text, pkg);
	if (!body) return text;
	const own = text.slice(pkg.from, pkg.to);
	const missing = [...new Set(targets)].filter((t) => !imports(own, t));
	if (!missing.length) return text;
	const indent = memberIndent(text, body.open, body.close, pkg.from);
	const lines = missing.map((t) => `${indent}private import ${t};`).join('\n');
	const { at: anchor, after } = insertionPoint(text, body.open, body.close);
	let at = anchor;
	const lineAt = (i: number) => text.slice(i, (text.indexOf('\n', i) + 1 || text.length + 1) - 1);
	let insert: string;
	if (after === 'import') insert = `${lines}\n`;
	else {
		const next = lineAt(at);
		if (!next.trim()) {
			// A blank line already separates what follows: the imports go after it.
			at += next.length + 1;
			insert = `${lines}\n\n`;
		} else if (next.trim().startsWith('}')) insert = `${lines}\n`;
		else insert = after === 'doc' ? `\n${lines}\n\n` : `${lines}\n\n`;
	}
	if (at > 0 && text[at - 1] !== '\n') insert = `\n${insert}`;
	return text.slice(0, at) + insert + text.slice(at);
}

interface Body {
	open: number;
	close: number;
}

/** The offsets of the package body's `{` and `}`. */
function bodyOf(text: string, pkg: PackageAt): Body | null {
	let open = -1;
	let depth = 0;
	for (let i = pkg.from; i < pkg.to; i++) {
		const skip = skipTrivia(text, i);
		if (skip !== i) {
			i = skip - 1;
			continue;
		}
		const c = text[i];
		if (c === '{') {
			if (depth === 0) open = i;
			depth++;
		} else if (c === '}') {
			depth--;
			if (depth === 0 && open >= 0) return { open, close: i };
		} else if (c === ';' && depth === 0) return null; // `package P;`
	}
	return null;
}

/** Past a comment, string or quoted name starting at `i` (or `i` itself). */
function skipTrivia(text: string, i: number): number {
	const c = text[i];
	if (c === '/' && text[i + 1] === '*') {
		const end = text.indexOf('*/', i + 2);
		return end < 0 ? text.length : end + 2;
	}
	if (c === '/' && text[i + 1] === '/') {
		const end = text.indexOf('\n', i);
		return end < 0 ? text.length : end;
	}
	if (c === '"' || c === "'") {
		for (let j = i + 1; j < text.length; j++) {
			if (text[j] === '\\') j++;
			else if (text[j] === c) return j + 1;
		}
		return text.length;
	}
	return i;
}

/** The indentation of the body's members: its first member's, else the package's plus four spaces. */
function memberIndent(text: string, open: number, close: number, from: number): string {
	const inner = text.slice(open + 1, close);
	const first = /\n([ \t]*)\S/.exec(inner);
	if (first) return first[1]!;
	const lineStart = text.lastIndexOf('\n', from) + 1;
	return `${/^[ \t]*/.exec(text.slice(lineStart))![0]}    `;
}

/** Where new imports go: after the last top-level import of the body, else after its doc, else after `{`. */
function insertionPoint(
	text: string,
	open: number,
	close: number
): { at: number; after: 'import' | 'doc' | 'brace' } {
	let depth = 0;
	let lastImport = -1;
	let doc = -1;
	let statementStart = -1;
	let first = true;
	for (let i = open + 1; i < close; i++) {
		const skip = skipTrivia(text, i);
		if (skip !== i) {
			// The body's doc comment: `doc /* … */` as its first statement.
			if (
				depth === 0 &&
				first &&
				statementStart >= 0 &&
				/^doc\s*$/.test(text.slice(statementStart, i))
			) {
				doc = skip;
				statementStart = -1;
				first = false;
			}
			i = skip - 1;
			continue;
		}
		const c = text[i]!;
		if (depth === 0 && statementStart < 0 && /\S/.test(c)) statementStart = i;
		if (c === '{') depth++;
		else if (c === '}') {
			depth--;
			if (depth === 0) {
				statementStart = -1;
				first = false;
			}
		} else if (c === ';' && depth === 0) {
			if (/^(?:(?:private|public|protected)\s+)?import\b/.test(text.slice(statementStart, i)))
				lastImport = i + 1;
			statementStart = -1;
			first = false;
		}
	}
	const lineEnd = (at: number) => {
		const nl = text.indexOf('\n', at);
		return nl < 0 || nl > close ? at : nl + 1;
	};
	if (lastImport >= 0) return { at: lineEnd(lastImport), after: 'import' };
	if (doc >= 0) return { at: lineEnd(doc), after: 'doc' };
	return { at: lineEnd(open + 1), after: 'brace' };
}

/**
 * How generated text in one package spells the elements it refers to: a
 * member of the package by its name; anything else by its simple name with
 * a `private import` of it (as the demo writes), or by its qualified name
 * when another element would take the same simple name.
 */
export class References {
	private readonly byName = new Map<string, string>();
	private readonly needed: string[] = [];

	/** `pkg`: the package's qualified name; `declared`: names its generated text declares itself. */
	constructor(
		private readonly pkg: string,
		declared: Iterable<string> = []
	) {
		for (const n of declared) this.byName.set(n, `${pkg}::${n}`);
	}

	/** The spelling of an element (qualified name), importing it when needed. */
	name(qualified: string): string {
		const at = qualified.lastIndexOf('::');
		if (at < 0) return qualified;
		const simple = qualified.slice(at + 2);
		const owner = qualified.slice(0, at);
		const taken = this.byName.get(simple);
		if (taken && taken !== qualified) return qualified;
		this.byName.set(simple, qualified);
		if (owner !== this.pkg && !this.needed.includes(qualified)) this.needed.push(qualified);
		return simple;
	}

	/** A reference as `features.ts` gives it: import its head, then the path (`drone.battery`). */
	reference(ref: { imports: string; text: string }): string {
		const head = this.name(ref.imports);
		const at = ref.imports.lastIndexOf('::');
		const simple = at < 0 ? ref.imports : ref.imports.slice(at + 2);
		return ref.text.startsWith(simple) ? head + ref.text.slice(simple.length) : ref.text;
	}

	/** A library import the text needs (`SI::*`, `NumericalFunctions::sum`). */
	library(target: string) {
		if (!this.needed.includes(target)) this.needed.push(target);
	}

	/** What the package must import, in the order first needed. */
	get imports(): string[] {
		return [...this.needed];
	}
}
