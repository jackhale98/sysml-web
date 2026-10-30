/**
 * Reading ReqIF (OMG Requirements Interchange Format 1.2), the format DOORS,
 * DOORS Next, Polarion, Jama, Codebeamer and others exchange requirements in:
 * a `.reqif` XML file, or a `.reqifz` ZIP of them with their attachments.
 *
 * What is read: the datatypes (string, XHTML, integer, real, boolean, date,
 * enumeration), the spec object types and their attribute definitions, the
 * spec objects with their values (XHTML turned into plain text that keeps
 * paragraphs, line breaks and lists), the relations between them, and each
 * specification's hierarchy. Anything that doesn't fit (a reference to
 * nothing, an identifier used twice, a value of an unknown attribute) is
 * kept as a problem to show, never dropped without a word.
 */
import { decodeText } from './csv';
import {
	child,
	elements,
	localName,
	parseXml,
	textOf,
	XmlError,
	type XmlElement
} from './xml-tree';
import { unzip } from './zip';

export type ReqifKind =
	'string' | 'xhtml' | 'integer' | 'real' | 'boolean' | 'date' | 'enumeration';

const KINDS: Record<string, ReqifKind> = {
	STRING: 'string',
	XHTML: 'xhtml',
	INTEGER: 'integer',
	REAL: 'real',
	BOOLEAN: 'boolean',
	DATE: 'date',
	ENUMERATION: 'enumeration'
};

export interface ReqifDatatype {
	id: string;
	name: string;
	kind: ReqifKind;
	/** Enumerations: the values, in order. */
	values: { id: string; name: string }[];
}

export interface ReqifAttribute {
	id: string;
	name: string;
	kind: ReqifKind;
	datatype: string | null;
	/** Enumerations: several values allowed. */
	multi: boolean;
	/** The value an object without one has, as text. */
	defaultValue?: string;
}

export interface ReqifType {
	id: string;
	name: string;
	kind: 'object' | 'relation' | 'specification' | 'group';
	attributes: ReqifAttribute[];
}

export interface ReqifObject {
	id: string;
	/** LONG-NAME, which few tools fill. */
	longName: string;
	type: string | null;
	/** Values as text, by attribute definition id. */
	values: Map<string, string>;
	line: number;
}

export interface ReqifRelation {
	id: string;
	type: string | null;
	source: string | null;
	target: string | null;
	line: number;
}

export interface ReqifNode {
	/** The SPEC-HIERARCHY's identifier. */
	id: string;
	/** The spec object it shows. */
	object: string;
	children: ReqifNode[];
}

export interface ReqifSpecification {
	id: string;
	name: string;
	children: ReqifNode[];
}

export interface ReqifDocument {
	/** File name, for messages and the import's doc. */
	name: string;
	title: string;
	/** The tool that wrote it (SOURCE-TOOL-ID), if it says. */
	tool: string;
	datatypes: Map<string, ReqifDatatype>;
	/** Enumeration values' names, by their identifier. */
	enumValues: Map<string, string>;
	types: Map<string, ReqifType>;
	attributes: Map<string, ReqifAttribute>;
	objects: Map<string, ReqifObject>;
	relations: ReqifRelation[];
	specifications: ReqifSpecification[];
	/** What could not be read as it should, grouped and counted: `[problem, examples]`. */
	problems: Map<string, string[]>;
	/** Files in a `.reqifz` other than the ReqIF, and files the text refers to. */
	attachments: string[];
}

function emptyDocument(name: string): ReqifDocument {
	return {
		name,
		title: '',
		tool: '',
		datatypes: new Map(),
		enumValues: new Map(),
		types: new Map(),
		attributes: new Map(),
		objects: new Map(),
		relations: [],
		specifications: [],
		problems: new Map(),
		attachments: []
	};
}

function problem(doc: ReqifDocument, what: string, example: string) {
	const list = doc.problems.get(what) ?? [];
	list.push(example);
	doc.problems.set(what, list);
}

/** The problems as sentences: `What (line 12, line 40 and 3 more).` */
export function problemList(doc: ReqifDocument): string[] {
	return [...doc.problems].map(([what, examples]) => {
		const shown = examples.slice(0, 3).join(', ');
		const more = examples.length > 3 ? ` and ${examples.length - 3} more` : '';
		return `${what}: ${shown}${more}.`;
	});
}

// ---------------------------------------------------------------------------
// XHTML

/** Plain text of an XHTML value: paragraphs, line breaks and lists kept; images named. */
export function xhtmlText(root: XmlElement, attachments: string[] = []): string {
	const lines: string[] = [];
	let current = '';
	/** What the next line starts with: a list marker, else the indent of the item it continues. */
	let marker: string | null = null;
	let indent = '';
	let gap = false;

	const endLine = (keepEmpty = false) => {
		const text = current.replace(/[ \t\u00a0]+/g, ' ').trim();
		current = '';
		if (!text && !keepEmpty) return;
		if (gap && lines.length && lines.at(-1) !== '') lines.push('');
		gap = false;
		lines.push(text ? (marker ?? indent) + text : '');
		marker = null;
	};
	const block = (withGap: boolean) => {
		endLine();
		if (withGap) gap = true;
	};

	const walk = (node: XmlElement | string, pre: boolean) => {
		if (typeof node === 'string') {
			if (pre) {
				const parts = node.split(/\r?\n/);
				parts.forEach((part, i) => {
					if (i > 0) endLine(true);
					current += part;
				});
			} else current += node.replace(/\s+/g, ' ');
			return;
		}
		const name = localName(node).toLowerCase();
		switch (name) {
			case 'br':
				endLine(true);
				return;
			case 'script':
			case 'style':
			case 'head':
				return;
			case 'object':
			case 'img': {
				const file = node.attributes.data ?? node.attributes.src ?? '';
				if (file && !attachments.includes(file)) attachments.push(file);
				// An object's own content is its fallback (often a smaller image of it): the name says enough.
				const label = node.attributes.alt || file.split('/').pop() || 'object';
				current += ` [${name === 'img' ? 'image' : 'attachment'}: ${label}] `;
				return;
			}
			case 'ul':
			case 'ol': {
				block(false);
				const saved = indent;
				let n = Number(node.attributes.start) || 1;
				for (const item of elements(node)) {
					if (localName(item).toLowerCase() !== 'li') {
						walk(item, pre);
						continue;
					}
					endLine();
					const mark = name === 'ol' ? `${n++}. ` : '- ';
					marker = saved + mark;
					indent = saved + ' '.repeat(mark.length);
					for (const c of item.children) walk(c, pre);
					endLine();
					indent = saved;
				}
				indent = saved;
				block(false);
				return;
			}
			case 'tr': {
				endLine();
				const cells = elements(node).map((cell) =>
					xhtmlText(cell, attachments).replace(/\n+/g, ' ')
				);
				current = cells.join(' | ');
				endLine();
				return;
			}
			case 'a': {
				const text = textOf(node).replace(/\s+/g, ' ').trim();
				const href = node.attributes.href ?? '';
				current += /^https?:/.test(href) && href !== text ? `${text} (${href})` : textOf(node);
				return;
			}
			case 'p':
			case 'div':
			case 'h1':
			case 'h2':
			case 'h3':
			case 'h4':
			case 'h5':
			case 'h6':
			case 'blockquote':
			case 'pre':
			case 'table':
			case 'dl':
			case 'dt':
			case 'dd':
			case 'address':
			case 'hr': {
				block(true);
				for (const c of node.children) walk(c, pre || name === 'pre');
				block(true);
				return;
			}
			default:
				for (const c of node.children) walk(c, pre);
		}
	};
	walk(root, false);
	endLine();
	while (lines.at(-1) === '') lines.pop();
	return lines.join('\n');
}

// ---------------------------------------------------------------------------
// The document

/** The text of a `<X-REF>` inside `element`'s `<wrapper>`. */
function reference(element: XmlElement, wrapper: string): string | null {
	const holder = child(element, wrapper);
	const ref = holder ? elements(holder)[0] : undefined;
	const id = ref ? textOf(ref).trim() : '';
	return id || null;
}

function where(element: XmlElement): string {
	return `line ${element.line}`;
}

/** `ATTRIBUTE-VALUE-STRING` → `string`. */
function kindOf(name: string, prefix: string): ReqifKind | null {
	return name.startsWith(prefix) ? (KINDS[name.slice(prefix.length)] ?? null) : null;
}

function readDatatypes(doc: ReqifDocument, holder: XmlElement | undefined, ids: Set<string>) {
	for (const e of holder ? elements(holder) : []) {
		const kind = kindOf(localName(e), 'DATATYPE-DEFINITION-');
		const id = identifier(doc, e, ids);
		if (!kind || !id) {
			if (!kind) problem(doc, 'Datatypes of a kind ReqIF does not have', localName(e));
			continue;
		}
		const values: ReqifDatatype['values'] = [];
		if (kind === 'enumeration') {
			const specified = child(e, 'SPECIFIED-VALUES');
			for (const v of specified ? elements(specified, 'ENUM-VALUE') : []) {
				const vid = identifier(doc, v, ids);
				if (!vid) continue;
				const key = child(child(v, 'PROPERTIES') ?? v, 'EMBEDDED-VALUE')?.attributes[
					'OTHER-CONTENT'
				];
				const valueName = v.attributes['LONG-NAME'] || key || vid;
				values.push({ id: vid, name: valueName });
				doc.enumValues.set(vid, valueName);
			}
		}
		doc.datatypes.set(id, { id, name: e.attributes['LONG-NAME'] ?? id, kind, values });
	}
}

/** The element's IDENTIFIER, noting one that is missing or used before. */
function identifier(doc: ReqifDocument, e: XmlElement, ids: Set<string>): string | null {
	const id = e.attributes.IDENTIFIER?.trim();
	if (!id) {
		problem(doc, `Elements without an IDENTIFIER, left out`, `${localName(e)} on ${where(e)}`);
		return null;
	}
	if (ids.has(id)) {
		problem(doc, 'IDENTIFIERs used more than once (the first is kept)', `${id} on ${where(e)}`);
		return null;
	}
	ids.add(id);
	return id;
}

const TYPE_KINDS: Record<string, ReqifType['kind']> = {
	'SPEC-OBJECT-TYPE': 'object',
	'SPEC-RELATION-TYPE': 'relation',
	'SPECIFICATION-TYPE': 'specification',
	'RELATION-GROUP-TYPE': 'group'
};

/** One value of an `ATTRIBUTE-VALUE-…` element as text, or null when it has none. */
function valueText(doc: ReqifDocument, e: XmlElement, kind: ReqifKind): string | null {
	switch (kind) {
		case 'xhtml': {
			const value = child(e, 'THE-VALUE');
			return value ? xhtmlText(value, doc.attachments) : null;
		}
		case 'enumeration': {
			const holder = child(e, 'VALUES');
			const names: string[] = [];
			for (const ref of holder ? elements(holder) : []) {
				const id = textOf(ref).trim();
				const name = doc.enumValues.get(id);
				if (name) names.push(name);
				else
					problem(
						doc,
						'Enumeration values that are not defined, left out',
						`${id} on ${where(ref)}`
					);
			}
			return names.join(', ');
		}
		case 'boolean': {
			const v = e.attributes['THE-VALUE'];
			if (v === undefined) return null;
			return /^(true|1)$/i.test(v.trim()) ? 'true' : 'false';
		}
		case 'date': {
			const v = e.attributes['THE-VALUE'];
			// The date as people read it; a time of day at midnight says nothing.
			return v === undefined ? null : v.replace(/T00:00:00(\.0+)?(Z|[+-]00:00)?$/, '');
		}
		default:
			return e.attributes['THE-VALUE'] ?? null;
	}
}

function readTypes(doc: ReqifDocument, holder: XmlElement | undefined, ids: Set<string>) {
	for (const e of holder ? elements(holder) : []) {
		const kind = TYPE_KINDS[localName(e)];
		const id = kind ? identifier(doc, e, ids) : null;
		if (!kind || !id) continue;
		const attributes: ReqifAttribute[] = [];
		const specAttributes = child(e, 'SPEC-ATTRIBUTES');
		for (const a of specAttributes ? elements(specAttributes) : []) {
			const akind = kindOf(localName(a), 'ATTRIBUTE-DEFINITION-');
			const aid = akind ? identifier(doc, a, ids) : null;
			if (!akind || !aid) continue;
			const datatype = reference(a, 'TYPE');
			if (!datatype)
				problem(doc, 'Attribute definitions without a datatype', `${aid} on ${where(a)}`);
			const attribute: ReqifAttribute = {
				id: aid,
				name: (a.attributes['LONG-NAME'] ?? aid).trim(),
				kind: akind,
				datatype,
				multi: a.attributes['MULTI-VALUED'] === 'true'
			};
			attributes.push(attribute);
			doc.attributes.set(aid, attribute);
		}
		doc.types.set(id, { id, name: (e.attributes['LONG-NAME'] ?? id).trim(), kind, attributes });
	}
	// Default values need every datatype and attribute read first.
	for (const e of holder ? elements(holder) : []) {
		const specAttributes = child(e, 'SPEC-ATTRIBUTES');
		for (const a of specAttributes ? elements(specAttributes) : []) {
			const attribute = doc.attributes.get(a.attributes.IDENTIFIER ?? '');
			const value = child(a, 'DEFAULT-VALUE');
			const holderValue = value ? elements(value)[0] : undefined;
			if (!attribute || !holderValue) continue;
			const text = valueText(doc, holderValue, attribute.kind);
			if (text) attribute.defaultValue = text;
		}
	}
}

function readValues(doc: ReqifDocument, e: XmlElement): Map<string, string> {
	const values = new Map<string, string>();
	const holder = child(e, 'VALUES');
	for (const v of holder ? elements(holder) : []) {
		const kind = kindOf(localName(v), 'ATTRIBUTE-VALUE-');
		if (!kind) continue;
		const definition = reference(v, 'DEFINITION');
		const attribute = definition ? doc.attributes.get(definition) : undefined;
		if (!attribute) {
			problem(
				doc,
				'Values of attributes that are not defined, left out',
				`${definition ?? 'no definition'} on ${where(v)}`
			);
			continue;
		}
		if (kind !== attribute.kind) {
			problem(
				doc,
				'Values of another kind than their attribute, left out',
				`${attribute.id} on ${where(v)}`
			);
			continue;
		}
		const text = valueText(doc, v, kind);
		if (text !== null) values.set(attribute.id, text);
	}
	return values;
}

function readHierarchy(
	doc: ReqifDocument,
	holder: XmlElement | undefined,
	ids: Set<string>
): ReqifNode[] {
	const nodes: ReqifNode[] = [];
	for (const h of holder ? elements(holder, 'SPEC-HIERARCHY') : []) {
		const id = identifier(doc, h, ids) ?? `line-${h.line}`;
		const object = reference(h, 'OBJECT');
		const children = readHierarchy(doc, child(h, 'CHILDREN'), ids);
		if (!object || !doc.objects.has(object)) {
			problem(
				doc,
				'Hierarchy entries that point to no spec object (what is under them is kept)',
				`${object ?? 'nothing'} on ${where(h)}`
			);
			nodes.push(...children);
			continue;
		}
		nodes.push({ id, object, children });
	}
	return nodes;
}

/** Read one `.reqif` document into `doc` (a `.reqifz` may hold several). */
export function readReqifXml(text: string, doc: ReqifDocument): void {
	let root: XmlElement;
	try {
		root = parseXml(text);
	} catch (error) {
		if (error instanceof XmlError)
			throw new Error(`${doc.name} is not well-formed XML. ${error.message}.`, { cause: error });
		throw error;
	}
	if (localName(root) !== 'REQ-IF')
		throw new Error(
			`${doc.name} is not a ReqIF file: it holds <${root.name}> where ReqIF has <REQ-IF>.`
		);
	const header = child(child(root, 'THE-HEADER') ?? root, 'REQ-IF-HEADER');
	if (header) {
		doc.title ||= textOf(child(header, 'TITLE') ?? '').trim();
		doc.tool ||= textOf(child(header, 'SOURCE-TOOL-ID') ?? '').trim();
	}
	const content = child(child(root, 'CORE-CONTENT') ?? root, 'REQ-IF-CONTENT');
	if (!content) throw new Error(`${doc.name} has no requirements in it (no <REQ-IF-CONTENT>).`);
	const ids = new Set<string>([
		...doc.datatypes.keys(),
		...doc.types.keys(),
		...doc.attributes.keys(),
		...doc.objects.keys()
	]);

	readDatatypes(doc, child(content, 'DATATYPES'), ids);
	readTypes(doc, child(content, 'SPEC-TYPES'), ids);

	const objects = child(content, 'SPEC-OBJECTS');
	for (const o of objects ? elements(objects, 'SPEC-OBJECT') : []) {
		const id = identifier(doc, o, ids);
		if (!id) continue;
		const type = reference(o, 'TYPE');
		if (!type || doc.types.get(type)?.kind !== 'object')
			problem(doc, 'Spec objects whose type is not defined', `${id} on ${where(o)}`);
		const values = readValues(doc, o);
		// Attributes of its type that it has no value for take their default.
		for (const a of doc.types.get(type ?? '')?.attributes ?? []) {
			if (!values.has(a.id) && a.defaultValue !== undefined) values.set(a.id, a.defaultValue);
		}
		doc.objects.set(id, {
			id,
			longName: (o.attributes['LONG-NAME'] ?? '').trim(),
			type,
			values,
			line: o.line
		});
	}

	const relations = child(content, 'SPEC-RELATIONS');
	for (const r of relations ? elements(relations, 'SPEC-RELATION') : []) {
		const id = identifier(doc, r, ids) ?? `line-${r.line}`;
		doc.relations.push({
			id,
			type: reference(r, 'TYPE'),
			source: reference(r, 'SOURCE'),
			target: reference(r, 'TARGET'),
			line: r.line
		});
	}

	const specifications = child(content, 'SPECIFICATIONS');
	for (const s of specifications ? elements(specifications, 'SPECIFICATION') : []) {
		const id = identifier(doc, s, ids);
		if (!id) continue;
		doc.specifications.push({
			id,
			name: (s.attributes['LONG-NAME'] ?? '').trim() || id,
			children: readHierarchy(doc, child(s, 'CHILDREN'), ids)
		});
	}
}

/** Read a `.reqif` or `.reqifz` file. Throws a readable error when it can't be read at all. */
export async function readReqif(bytes: Uint8Array, name: string): Promise<ReqifDocument> {
	const doc = emptyDocument(name);
	const zipped = bytes[0] === 0x50 && bytes[1] === 0x4b;
	if (!zipped) {
		readReqifXml(decodeText(bytes), doc);
		return doc;
	}
	const entries = await unzip(bytes, 'a .reqifz is a ZIP of .reqif files', { maxTotal: 512e6 });
	const reqifs = entries.filter((e) => /\.reqif$/i.test(e.path));
	if (!reqifs.length) throw new Error(`${name} holds no .reqif file.`);
	for (const entry of reqifs) {
		if (entry.damaged) problem(doc, 'Files in the archive that are damaged', entry.path);
		readReqifXml(decodeText(entry.data), doc);
	}
	for (const entry of entries)
		if (!reqifs.includes(entry) && !doc.attachments.includes(entry.path))
			doc.attachments.push(entry.path);
	return doc;
}
