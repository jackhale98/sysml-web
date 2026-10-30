/**
 * A small XML parser for interchange files (ReqIF): the whole document as a
 * tree of elements and text, or an error that says what is wrong and on which
 * line. No DTDs are read and no entities beyond XML's own (and `&nbsp;`, which
 * XHTML from requirements tools sometimes holds) are expanded, so a file can't
 * pull in other files or blow up in size.
 */

export interface XmlElement {
	/** The name as written, prefix kept (`xhtml:div`). */
	name: string;
	attributes: Record<string, string>;
	children: XmlNode[];
	/** 1-based line of the start tag. */
	line: number;
}

export type XmlNode = XmlElement | string;

export class XmlError extends Error {
	constructor(
		message: string,
		readonly line: number
	) {
		super(`Line ${line}: ${message}`);
	}
}

const ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: '\u00a0'
};

const NAME = /^[A-Za-z_\u00c0-\uffff][\w.\-:\u00b7\u00c0-\uffff]*/;

/** The name without its prefix: `xhtml:div` → `div`. */
export function localName(element: XmlElement): string {
	return element.name.slice(element.name.indexOf(':') + 1);
}

/** The element children, optionally only those with this local name. */
export function elements(element: XmlElement, name?: string): XmlElement[] {
	return element.children.filter(
		(c): c is XmlElement => typeof c !== 'string' && (!name || localName(c) === name)
	);
}

/** The first element child with this local name. */
export function child(element: XmlElement, name: string): XmlElement | undefined {
	return elements(element, name)[0];
}

/** All the text inside, tags left out. */
export function textOf(node: XmlNode): string {
	return typeof node === 'string' ? node : node.children.map(textOf).join('');
}

/** Parse a whole document; throws an `XmlError` for anything that is not well-formed. */
export function parseXml(source: string): XmlElement {
	const text = source.replace(/^\uFEFF/, '');
	let at = 0;
	let line = 1;
	const stack: XmlElement[] = [];
	let root: XmlElement | null = null;

	const fail = (message: string): never => {
		throw new XmlError(message, line);
	};
	/** Move to `to`, counting the lines passed. */
	const advance = (to: number) => {
		for (let i = at; i < to; i++) if (text.charCodeAt(i) === 10) line++;
		at = to;
	};
	const decode = (raw: string): string =>
		raw.replace(/&([^;\s&<]*);?/g, (whole, name: string) => {
			if (!whole.endsWith(';')) fail('an “&” that does not start an entity (write it as &amp;)');
			if (name.startsWith('#x') || name.startsWith('#X')) {
				const code = parseInt(name.slice(2), 16);
				if (!Number.isFinite(code) || code > 0x10ffff) fail(`a bad character reference ${whole}`);
				return String.fromCodePoint(code);
			}
			if (name.startsWith('#')) {
				const code = parseInt(name.slice(1), 10);
				if (!Number.isFinite(code) || code > 0x10ffff) fail(`a bad character reference ${whole}`);
				return String.fromCodePoint(code);
			}
			const value = ENTITIES[name];
			if (value === undefined) fail(`an entity this file does not define: ${whole}`);
			return value!;
		});
	const addText = (raw: string) => {
		if (!raw) return;
		const top = stack.at(-1);
		if (!top) {
			if (raw.trim()) fail('text outside the root element');
			return;
		}
		const value = decode(raw);
		const last = top.children.at(-1);
		if (typeof last === 'string') top.children[top.children.length - 1] = last + value;
		else top.children.push(value);
	};

	while (at < text.length) {
		const open = text.indexOf('<', at);
		if (open < 0) {
			const rest = text.slice(at);
			addText(rest);
			advance(text.length);
			break;
		}
		const before = text.slice(at, open);
		addText(before);
		advance(open);
		if (text.startsWith('<!--', at)) {
			const end = text.indexOf('-->', at + 4);
			if (end < 0) fail('a comment that is never closed');
			advance(end + 3);
		} else if (text.startsWith('<![CDATA[', at)) {
			const end = text.indexOf(']]>', at + 9);
			if (end < 0) fail('a CDATA section that is never closed');
			if (!stack.length) fail('a CDATA section outside the root element');
			const top = stack.at(-1)!;
			const value = text.slice(at + 9, end);
			const last = top.children.at(-1);
			if (typeof last === 'string') top.children[top.children.length - 1] = last + value;
			else top.children.push(value);
			advance(end + 3);
		} else if (text.startsWith('<?', at)) {
			const end = text.indexOf('?>', at + 2);
			if (end < 0) fail('a processing instruction that is never closed');
			advance(end + 2);
		} else if (text.startsWith('<!DOCTYPE', at)) {
			// Skipped, internal subset and all: nothing in it is used.
			let depth = 0;
			let i = at + 9;
			for (; i < text.length; i++) {
				const c = text[i];
				if (c === '[') depth++;
				else if (c === ']') depth--;
				else if (c === '>' && depth <= 0) break;
			}
			if (i >= text.length) fail('a DOCTYPE that is never closed');
			advance(i + 1);
		} else if (text.startsWith('</', at)) {
			const m = /^<\/([^\s>]+)\s*>/.exec(text.slice(at, at + 400));
			if (!m) fail('a malformed end tag');
			const top = stack.pop();
			if (!top) fail(`an end tag </${m![1]}> with no start tag`);
			if (top!.name !== m![1])
				fail(`</${m![1]}> closes <${top!.name}> (opened on line ${top!.line})`);
			advance(at + m![0].length);
		} else {
			const nameMatch = NAME.exec(text.slice(at + 1, at + 300));
			if (!nameMatch) fail('a “<” that does not start a tag (write it as &lt;)');
			const element: XmlElement = {
				name: nameMatch![0],
				attributes: {},
				children: [],
				line
			};
			advance(at + 1 + nameMatch![0].length);
			// Attributes, up to `>` or `/>`.
			for (;;) {
				const space = /^\s*/.exec(text.slice(at, at + 1000))![0];
				advance(at + space.length);
				if (at >= text.length) fail(`<${element.name}> is never closed`);
				if (text.startsWith('/>', at) || text[at] === '>') break;
				if (!space) fail(`<${element.name}> needs a space between its attributes`);
				const attr = NAME.exec(text.slice(at, at + 300));
				if (!attr) fail(`<${element.name}> has a malformed attribute`);
				const name = attr![0];
				advance(at + name.length);
				const eq = /^\s*=\s*/.exec(text.slice(at, at + 100));
				if (!eq) fail(`attribute ${name} of <${element.name}> has no value`);
				advance(at + eq![0].length);
				const quote = text[at];
				if (quote !== '"' && quote !== "'")
					fail(`attribute ${name} of <${element.name}> is not in quotes`);
				const end = text.indexOf(quote!, at + 1);
				if (end < 0) fail(`attribute ${name} of <${element.name}> is never closed`);
				const raw = text.slice(at + 1, end);
				if (raw.includes('<')) fail(`attribute ${name} of <${element.name}> holds a “<”`);
				if (name in element.attributes) fail(`<${element.name}> has attribute ${name} twice`);
				element.attributes[name] = decode(raw).replace(/[\t\n\r]/g, ' ');
				advance(end + 1);
			}
			const selfClosing = text.startsWith('/>', at);
			advance(at + (selfClosing ? 2 : 1));
			const parent = stack.at(-1);
			if (parent) parent.children.push(element);
			else if (root) fail(`a second root element <${element.name}>`);
			else root = element;
			if (!selfClosing) stack.push(element);
		}
	}
	if (stack.length) {
		const open = stack.at(-1)!;
		throw new XmlError(`<${open.name}> is never closed`, open.line);
	}
	if (!root) throw new XmlError('there is no XML in it', 1);
	return root;
}
