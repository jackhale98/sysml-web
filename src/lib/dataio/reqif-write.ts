/**
 * Writing the project's requirements as ReqIF 1.2, for DOORS, DOORS Next,
 * Polarion, Jama, Codebeamer and the other requirements tools that read it;
 * and checking a ReqIF document against the rules of the ReqIF schema that
 * can be checked without it (structure, required attributes, unique
 * identifiers, references that resolve).
 *
 * Each top-level package with requirements is a specification; packages
 * inside it are headings; requirements are spec objects with their ID,
 * title, text (as XHTML), status, owner, originator, rationale and the
 * attributes their definition gives them (kind, priority…). Derivations are
 * relations. Identifiers are stable: an imported requirement gets back the
 * IDENTIFIER it came with, the others one made from their ID (else their
 * qualified name), so the other tool updates rather than duplicates.
 */
import type { RequirementRow } from '#lib/project/requirements.ts';
import { unescapeName } from '#lib/project/names.ts';
import {
	attributeLabel,
	REQIF_METADATA,
	STATUS_KINDS,
	type AttributeInfo,
	type ImportContext
} from './import-plan';
import { splitQualified } from './reqif-plan';
import { escapeXml } from './xml';
import { child, elements, localName, parseXml, textOf, type XmlElement } from './xml-tree';

export const REQIF_NAMESPACE = 'http://www.omg.org/spec/ReqIF/20110401/reqif.xsd';
const XHTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

/** FNV-1a, as eight hex digits: short, stable tags for identifiers. */
function hash(text: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16).padStart(8, '0');
}

/** An xsd:ID from any text: letters, digits, `.`, `-` and `_`, not starting with a digit. */
function ncName(text: string): string {
	const safe = text.replace(/[^A-Za-z0-9._-]+/g, '_');
	return /^[A-Za-z_]/.test(safe) ? safe : `_${safe}`;
}

/** Paragraphs and lists of plain text as XHTML (`- item` and `1. item` lines are list items). */
export function textXhtml(text: string): string {
	const blocks: string[] = [];
	for (const paragraph of text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
		const lines = paragraph
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean);
		let prose: string[] = [];
		let list: { ordered: boolean; items: string[] } | null = null;
		const flushProse = () => {
			if (prose.length) blocks.push(`<xhtml:p>${escapeXml(prose.join(' '))}</xhtml:p>`);
			prose = [];
		};
		const flushList = () => {
			if (!list) return;
			const tag = list.ordered ? 'ol' : 'ul';
			blocks.push(
				`<xhtml:${tag}>${list.items.map((i) => `<xhtml:li>${escapeXml(i)}</xhtml:li>`).join('')}</xhtml:${tag}>`
			);
			list = null;
		};
		for (const line of lines) {
			const item = /^(?:([-*•])|(\d+)[.)])\s+(.*)$/.exec(line);
			if (item) {
				flushProse();
				const ordered = !item[1];
				if (list && list.ordered !== ordered) flushList();
				list ??= { ordered, items: [] };
				list.items.push(item[3]!);
			} else if (list) {
				// A line that continues the item above it (the doc comment wrapped it).
				list.items[list.items.length - 1] += ` ${line}`;
			} else prose.push(line);
		}
		flushProse();
		flushList();
	}
	return `<xhtml:div>${blocks.join('')}</xhtml:div>`;
}

interface ExportAttribute {
	id: string;
	name: string;
	kind: 'string' | 'xhtml' | 'real' | 'boolean' | 'enumeration';
	datatype: string;
	multi?: boolean;
	/** The requirement's value, as the model reads it. */
	value: (r: ExportRequirement) => string | undefined;
}

interface ExportRequirement {
	identifier: string;
	row: RequirementRow;
	qualifiedName: string;
	values: Record<string, string>;
}

export interface ReqifExportInput {
	context: ImportContext;
	/** The project's name: the document's title. */
	title: string;
	/** Defaults to now; tests pass a fixed time. */
	now?: Date;
}

/** The project's requirements as a ReqIF document. */
export function writeReqif({ context, title, now = new Date() }: ReqifExportInput): string {
	const time = now.toISOString();
	const used = new Set<string>();
	/** A stable identifier, made unique within this document. */
	const identify = (wanted: string, key: string): string => {
		let id = ncName(wanted);
		if (used.has(id)) id = ncName(`${wanted}-${hash(key)}`);
		for (let n = 2; used.has(id); n++) id = ncName(`${wanted}-${hash(key)}-${n}`);
		used.add(id);
		return id;
	};

	const requirements = context.requirements.filter((r) => !r.row.file.startsWith('libraries/'));
	const packagesByName = new Map(context.packages.map((p) => [p.qualifiedName, p]));
	// Kept identifiers first, so the made-up ones never take them.
	for (const r of requirements) {
		const kept = r.values[`metadata:${REQIF_METADATA}.identifier`];
		if (kept) used.add(ncName(kept));
	}
	for (const p of context.packages) if (p.reqif) used.add(ncName(p.reqif));
	const exported: ExportRequirement[] = requirements.map((r) => {
		const kept = r.values[`metadata:${REQIF_METADATA}.identifier`];
		return {
			identifier: kept
				? ncName(kept)
				: identify(
						r.row.id ? `tessera-req-${r.row.id}` : `tessera-req-${hash(r.qualifiedName)}`,
						r.qualifiedName
					),
			row: r.row,
			qualifiedName: r.qualifiedName,
			values: r.values
		};
	});

	// The attributes: the fixed ones, then those the requirements' definitions give them.
	const infos = new Map<string, AttributeInfo>();
	for (const def of context.defs)
		for (const a of def.attributes) if (!infos.has(a.name)) infos.set(a.name, a);
	const featureNames = [
		...new Set(
			exported.flatMap((r) => Object.keys(r.values).filter((k) => k.startsWith('feature:')))
		)
	].map((k) => k.slice(8));
	/** Enumerations by datatype identifier: their name and literals. */
	const enums = new Map<string, { name: string; literals: string[] }>();
	enums.set('tessera-dt-enum-Status', { name: 'Status', literals: [...STATUS_KINDS] });
	const attributes: ExportAttribute[] = [
		{
			id: 'tessera-attr-id',
			name: 'ReqIF.ForeignID',
			kind: 'string',
			datatype: 'tessera-dt-string',
			value: (r) => r.row.id ?? undefined
		},
		{
			id: 'tessera-attr-name',
			name: 'ReqIF.Name',
			kind: 'string',
			datatype: 'tessera-dt-string',
			value: (r) => r.row.title
		},
		{
			id: 'tessera-attr-text',
			name: 'ReqIF.Text',
			kind: 'xhtml',
			datatype: 'tessera-dt-xhtml',
			value: (r) => r.row.text || undefined
		},
		{
			id: 'tessera-attr-status',
			name: 'Status',
			kind: 'enumeration',
			datatype: 'tessera-dt-enum-Status',
			value: (r) => r.values['metadata:StatusInfo.status']
		},
		{
			id: 'tessera-attr-owner',
			name: 'Owner',
			kind: 'string',
			datatype: 'tessera-dt-string',
			value: (r) => r.values['metadata:StatusInfo.owner']
		},
		{
			id: 'tessera-attr-originator',
			name: 'Originator',
			kind: 'string',
			datatype: 'tessera-dt-string',
			value: (r) => r.values['metadata:StatusInfo.originator']
		},
		{
			id: 'tessera-attr-rationale',
			name: 'Rationale',
			kind: 'string',
			datatype: 'tessera-dt-string',
			value: (r) => r.values['metadata:Rationale.text']
		}
	];
	for (const name of featureNames) {
		const info = infos.get(name);
		const value = (r: ExportRequirement) => r.values[`feature:${name}`];
		const id = `tessera-feature-${ncName(name)}`;
		// An attribute called like one of the fixed ones (a `rationale` feature) says which it is.
		const label = attributes.some((a) => a.name === attributeLabel(name))
			? `${attributeLabel(name)} (attribute)`
			: attributeLabel(name);
		if (info?.valueKind === 'enum') {
			const enumName = unescapeName(info.enumName ?? name);
			const datatype = `tessera-dt-enum-${ncName(enumName)}`;
			const literals = [...(enums.get(datatype)?.literals ?? info.literals ?? [])];
			// Values the enumeration's text didn't give (an alias, a literal of a specialization).
			for (const r of exported)
				for (const v of (value(r) ?? '').split(', ').filter(Boolean))
					if (!literals.includes(v)) literals.push(v);
			enums.set(datatype, { name: enumName, literals });
			attributes.push({ id, name: label, kind: 'enumeration', datatype, multi: info.many, value });
		} else if (info?.valueKind === 'number') {
			attributes.push({ id, name: label, kind: 'real', datatype: 'tessera-dt-real', value });
		} else if (info?.valueKind === 'boolean') {
			attributes.push({ id, name: label, kind: 'boolean', datatype: 'tessera-dt-boolean', value });
		} else {
			attributes.push({ id, name: label, kind: 'string', datatype: 'tessera-dt-string', value });
		}
	}
	for (const a of attributes) used.add(a.id);
	const present = attributes.filter((a) => exported.some((r) => a.value(r)));
	const kinds = new Set(present.map((a) => a.kind));
	const enumValueId = (datatype: string, literal: string) =>
		`${datatype.replace('tessera-dt-enum-', 'tessera-ev-')}-${ncName(literal)}`;

	// The hierarchy: a specification per top-level package, headings for the packages inside.
	interface Node {
		identifier: string;
		/** Heading text, for packages inside a specification. */
		heading?: string;
		requirement?: ExportRequirement;
		children: Node[];
	}
	interface Spec {
		identifier: string;
		name: string;
		children: Node[];
	}
	const specs = new Map<string, Spec>();
	const headings = new Map<string, Node>();
	const nodeOf = new Map<string, Node>();
	const holderOf = (segments: string[]): Node[] => {
		const top = segments[0]!;
		let spec = specs.get(top);
		if (!spec) {
			const pkg = packagesByName.get(top);
			spec = {
				identifier: pkg?.reqif
					? ncName(pkg.reqif)
					: identify(`tessera-spec-${unescapeName(top)}`, top),
				name: unescapeName(top),
				children: []
			};
			specs.set(top, spec);
		}
		let holder = spec.children;
		for (let i = 1; i < segments.length; i++) {
			const qualified = segments.slice(0, i + 1).join('::');
			const requirement = nodeOf.get(qualified);
			if (requirement) {
				holder = requirement.children;
				continue;
			}
			let heading = headings.get(qualified);
			if (!heading) {
				const pkg = packagesByName.get(qualified);
				heading = {
					identifier: pkg?.reqif
						? ncName(pkg.reqif)
						: identify(`tessera-heading-${hash(qualified)}`, qualified),
					heading: unescapeName(segments[i]!),
					children: []
				};
				headings.set(qualified, heading);
				holder.push(heading);
			}
			holder = heading.children;
		}
		return holder;
	};
	for (const r of exported) {
		const segments = splitQualified(r.qualifiedName);
		const node: Node = { identifier: r.identifier, requirement: r, children: [] };
		nodeOf.set(r.qualifiedName, node);
		// A requirement at the top of a file, in no package: its own specification.
		holderOf(segments.length > 1 ? segments.slice(0, -1) : segments).push(node);
	}

	// Derivations: from the derived requirement (source) to the one it comes from (target).
	const byKey = new Map(exported.map((r) => [r.row.key, r]));
	const relations: { id: string; source: string; target: string }[] = [];
	for (const r of exported)
		for (const key of r.row.derivedFrom) {
			const original = byKey.get(key);
			if (!original) continue;
			relations.push({
				id: identify(
					`tessera-rel-${hash(`${r.identifier}>${original.identifier}`)}`,
					`${r.identifier}>${original.identifier}`
				),
				source: r.identifier,
				target: original.identifier
			});
		}

	// Writing it.
	const out: string[] = [];
	const at = `LAST-CHANGE="${time}"`;
	const attr = (name: string, value: string) => `${name}="${escapeXml(value)}"`;
	out.push('<?xml version="1.0" encoding="UTF-8"?>');
	out.push(`<REQ-IF xmlns="${REQIF_NAMESPACE}" xmlns:xhtml="${XHTML_NAMESPACE}">`);
	out.push('  <THE-HEADER>');
	out.push(`    <REQ-IF-HEADER ${attr('IDENTIFIER', identify(`tessera-header-${title}`, title))}>`);
	out.push(`      <CREATION-TIME>${time}</CREATION-TIME>`);
	out.push('      <REQ-IF-TOOL-ID>Tessera</REQ-IF-TOOL-ID>');
	out.push('      <REQ-IF-VERSION>1.0</REQ-IF-VERSION>');
	out.push('      <SOURCE-TOOL-ID>Tessera</SOURCE-TOOL-ID>');
	out.push(`      <TITLE>${escapeXml(title)}</TITLE>`);
	out.push('    </REQ-IF-HEADER>');
	out.push('  </THE-HEADER>');
	out.push('  <CORE-CONTENT>');
	out.push('    <REQ-IF-CONTENT>');

	out.push('      <DATATYPES>');
	out.push(
		`        <DATATYPE-DEFINITION-STRING IDENTIFIER="tessera-dt-string" ${at} LONG-NAME="String" MAX-LENGTH="100000"/>`
	);
	out.push(
		`        <DATATYPE-DEFINITION-XHTML IDENTIFIER="tessera-dt-xhtml" ${at} LONG-NAME="Formatted text"/>`
	);
	if (kinds.has('real'))
		out.push(
			`        <DATATYPE-DEFINITION-REAL IDENTIFIER="tessera-dt-real" ${at} LONG-NAME="Number" ACCURACY="10" MAX="1.0E308" MIN="-1.0E308"/>`
		);
	if (kinds.has('boolean'))
		out.push(
			`        <DATATYPE-DEFINITION-BOOLEAN IDENTIFIER="tessera-dt-boolean" ${at} LONG-NAME="Yes or no"/>`
		);
	const writtenEnums = new Set<string>();
	for (const a of present) {
		if (a.kind !== 'enumeration' || writtenEnums.has(a.datatype)) continue;
		writtenEnums.add(a.datatype);
		const { name: enumName, literals } = enums.get(a.datatype)!;
		out.push(
			`        <DATATYPE-DEFINITION-ENUMERATION ${attr('IDENTIFIER', a.datatype)} ${at} ${attr('LONG-NAME', enumName)}>`
		);
		out.push('          <SPECIFIED-VALUES>');
		literals.forEach((literal, key) => {
			out.push(
				`            <ENUM-VALUE ${attr('IDENTIFIER', enumValueId(a.datatype, literal))} ${at} ${attr('LONG-NAME', literal)}>`
			);
			out.push(
				`              <PROPERTIES><EMBEDDED-VALUE KEY="${key}" ${attr('OTHER-CONTENT', literal)}/></PROPERTIES>`
			);
			out.push('            </ENUM-VALUE>');
		});
		out.push('          </SPECIFIED-VALUES>');
		out.push('        </DATATYPE-DEFINITION-ENUMERATION>');
	}
	out.push('      </DATATYPES>');

	const KIND = (k: ExportAttribute['kind']) => k.toUpperCase();
	out.push('      <SPEC-TYPES>');
	out.push(
		`        <SPEC-OBJECT-TYPE IDENTIFIER="tessera-type-heading" ${at} LONG-NAME="Heading">`
	);
	out.push('          <SPEC-ATTRIBUTES>');
	out.push(
		`            <ATTRIBUTE-DEFINITION-STRING IDENTIFIER="tessera-attr-heading" ${at} LONG-NAME="ReqIF.ChapterName">`
	);
	out.push(
		'              <TYPE><DATATYPE-DEFINITION-STRING-REF>tessera-dt-string</DATATYPE-DEFINITION-STRING-REF></TYPE>'
	);
	out.push('            </ATTRIBUTE-DEFINITION-STRING>');
	out.push('          </SPEC-ATTRIBUTES>');
	out.push('        </SPEC-OBJECT-TYPE>');
	out.push(
		`        <SPEC-OBJECT-TYPE IDENTIFIER="tessera-type-requirement" ${at} LONG-NAME="Requirement">`
	);
	out.push('          <SPEC-ATTRIBUTES>');
	for (const a of present) {
		const multi = a.kind === 'enumeration' ? ` MULTI-VALUED="${a.multi ? 'true' : 'false'}"` : '';
		out.push(
			`            <ATTRIBUTE-DEFINITION-${KIND(a.kind)} ${attr('IDENTIFIER', a.id)} ${at} ${attr('LONG-NAME', a.name)}${multi}>`
		);
		out.push(
			`              <TYPE><DATATYPE-DEFINITION-${KIND(a.kind)}-REF>${escapeXml(a.datatype)}</DATATYPE-DEFINITION-${KIND(a.kind)}-REF></TYPE>`
		);
		out.push(`            </ATTRIBUTE-DEFINITION-${KIND(a.kind)}>`);
	}
	out.push('          </SPEC-ATTRIBUTES>');
	out.push('        </SPEC-OBJECT-TYPE>');
	if (relations.length)
		out.push(
			`        <SPEC-RELATION-TYPE IDENTIFIER="tessera-type-derived-from" ${at} LONG-NAME="Derived from"/>`
		);
	out.push(
		`        <SPECIFICATION-TYPE IDENTIFIER="tessera-type-specification" ${at} LONG-NAME="Specification"/>`
	);
	out.push('      </SPEC-TYPES>');

	out.push('      <SPEC-OBJECTS>');
	const writeObject = (node: Node) => {
		out.push(`        <SPEC-OBJECT ${attr('IDENTIFIER', node.identifier)} ${at}>`);
		out.push('          <VALUES>');
		if (node.heading !== undefined) {
			out.push(`            <ATTRIBUTE-VALUE-STRING ${attr('THE-VALUE', node.heading)}>`);
			out.push(
				'              <DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>tessera-attr-heading</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION>'
			);
			out.push('            </ATTRIBUTE-VALUE-STRING>');
		}
		const r = node.requirement;
		for (const a of r ? present : []) {
			const value = a.value(r!);
			if (!value) continue;
			const K = KIND(a.kind);
			const definition = `<DEFINITION><ATTRIBUTE-DEFINITION-${K}-REF>${escapeXml(a.id)}</ATTRIBUTE-DEFINITION-${K}-REF></DEFINITION>`;
			if (a.kind === 'xhtml') {
				out.push('            <ATTRIBUTE-VALUE-XHTML>');
				out.push(`              ${definition}`);
				out.push(`              <THE-VALUE>${textXhtml(value)}</THE-VALUE>`);
				out.push('            </ATTRIBUTE-VALUE-XHTML>');
			} else if (a.kind === 'enumeration') {
				const refs = value
					.split(', ')
					.filter(Boolean)
					.map((v) => `<ENUM-VALUE-REF>${escapeXml(enumValueId(a.datatype, v))}</ENUM-VALUE-REF>`);
				out.push('            <ATTRIBUTE-VALUE-ENUMERATION>');
				out.push(`              ${definition}`);
				out.push(`              <VALUES>${refs.join('')}</VALUES>`);
				out.push('            </ATTRIBUTE-VALUE-ENUMERATION>');
			} else {
				const v = a.kind === 'boolean' ? String(/^true$/i.test(value)) : value;
				out.push(`            <ATTRIBUTE-VALUE-${K} ${attr('THE-VALUE', v)}>`);
				out.push(`              ${definition}`);
				out.push(`            </ATTRIBUTE-VALUE-${K}>`);
			}
		}
		out.push('          </VALUES>');
		const type = node.requirement ? 'tessera-type-requirement' : 'tessera-type-heading';
		out.push(`          <TYPE><SPEC-OBJECT-TYPE-REF>${type}</SPEC-OBJECT-TYPE-REF></TYPE>`);
		out.push('        </SPEC-OBJECT>');
		for (const c of node.children) writeObject(c);
	};
	for (const spec of specs.values()) for (const node of spec.children) writeObject(node);
	out.push('      </SPEC-OBJECTS>');

	if (relations.length) {
		out.push('      <SPEC-RELATIONS>');
		for (const r of relations) {
			out.push(`        <SPEC-RELATION ${attr('IDENTIFIER', r.id)} ${at}>`);
			out.push(
				`          <SOURCE><SPEC-OBJECT-REF>${escapeXml(r.source)}</SPEC-OBJECT-REF></SOURCE>`
			);
			out.push(
				`          <TARGET><SPEC-OBJECT-REF>${escapeXml(r.target)}</SPEC-OBJECT-REF></TARGET>`
			);
			out.push(
				'          <TYPE><SPEC-RELATION-TYPE-REF>tessera-type-derived-from</SPEC-RELATION-TYPE-REF></TYPE>'
			);
			out.push('        </SPEC-RELATION>');
		}
		out.push('      </SPEC-RELATIONS>');
	}

	if (specs.size) {
		out.push('      <SPECIFICATIONS>');
		const writeHierarchy = (nodes: Node[], depth: number) => {
			const pad = '  '.repeat(depth);
			out.push(`${pad}<CHILDREN>`);
			for (const node of nodes) {
				out.push(
					`${pad}  <SPEC-HIERARCHY ${attr('IDENTIFIER', identify(`tessera-sh-${node.identifier}`, node.identifier))} ${at}>`
				);
				if (node.children.length) writeHierarchy(node.children, depth + 2);
				out.push(
					`${pad}    <OBJECT><SPEC-OBJECT-REF>${escapeXml(node.identifier)}</SPEC-OBJECT-REF></OBJECT>`
				);
				out.push(`${pad}  </SPEC-HIERARCHY>`);
			}
			out.push(`${pad}</CHILDREN>`);
		};
		for (const spec of specs.values()) {
			out.push(
				`        <SPECIFICATION ${attr('IDENTIFIER', spec.identifier)} ${at} ${attr('LONG-NAME', spec.name)}>`
			);
			if (spec.children.length) writeHierarchy(spec.children, 5);
			out.push(
				'          <TYPE><SPECIFICATION-TYPE-REF>tessera-type-specification</SPECIFICATION-TYPE-REF></TYPE>'
			);
			out.push('        </SPECIFICATION>');
		}
		out.push('      </SPECIFICATIONS>');
	}
	out.push('    </REQ-IF-CONTENT>');
	out.push('  </CORE-CONTENT>');
	out.push('</REQ-IF>');
	return `${out.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Checking

/** One element of the schema: its children in order (`?` optional, `*` any number) and required attributes. */
interface Rule {
	children?: string[];
	/** Children of these kinds, in any order and number (the schema's `xsd:choice`). */
	choice?: string[];
	required?: string[];
	/** Any XHTML inside (THE-VALUE of an XHTML value). */
	xhtml?: boolean;
}

const IDENTIFIABLE = ['IDENTIFIER', 'LAST-CHANGE'];
const REF = (name: string): Rule => ({ children: [`${name}-REF`] });
const VALUE_KINDS = ['BOOLEAN', 'DATE', 'ENUMERATION', 'INTEGER', 'REAL', 'STRING', 'XHTML'];

/** The ReqIF 1.2 schema's structure (children in the schema's order), as far as an import or export uses it. */
const RULES: Record<string, Rule> = {
	'REQ-IF': { children: ['THE-HEADER', 'CORE-CONTENT', 'TOOL-EXTENSIONS?'] },
	'THE-HEADER': { children: ['REQ-IF-HEADER'] },
	'REQ-IF-HEADER': {
		children: [
			'COMMENT?',
			'CREATION-TIME',
			'REPOSITORY-ID?',
			'REQ-IF-TOOL-ID',
			'REQ-IF-VERSION',
			'SOURCE-TOOL-ID',
			'TITLE'
		],
		required: ['IDENTIFIER']
	},
	'CORE-CONTENT': { children: ['REQ-IF-CONTENT'] },
	'REQ-IF-CONTENT': {
		children: [
			'DATATYPES?',
			'SPEC-TYPES?',
			'SPEC-OBJECTS?',
			'SPEC-RELATIONS?',
			'SPECIFICATIONS?',
			'SPEC-RELATION-GROUPS?'
		]
	},
	DATATYPES: { choice: VALUE_KINDS.map((k) => `DATATYPE-DEFINITION-${k}`) },
	'DATATYPE-DEFINITION-STRING': {
		children: ['ALTERNATIVE-ID?'],
		required: [...IDENTIFIABLE, 'MAX-LENGTH']
	},
	'DATATYPE-DEFINITION-XHTML': { children: ['ALTERNATIVE-ID?'], required: IDENTIFIABLE },
	'DATATYPE-DEFINITION-BOOLEAN': { children: ['ALTERNATIVE-ID?'], required: IDENTIFIABLE },
	'DATATYPE-DEFINITION-DATE': { children: ['ALTERNATIVE-ID?'], required: IDENTIFIABLE },
	'DATATYPE-DEFINITION-INTEGER': {
		children: ['ALTERNATIVE-ID?'],
		required: [...IDENTIFIABLE, 'MAX', 'MIN']
	},
	'DATATYPE-DEFINITION-REAL': {
		children: ['ALTERNATIVE-ID?'],
		required: [...IDENTIFIABLE, 'ACCURACY', 'MAX', 'MIN']
	},
	'DATATYPE-DEFINITION-ENUMERATION': {
		children: ['ALTERNATIVE-ID?', 'SPECIFIED-VALUES?'],
		required: IDENTIFIABLE
	},
	'SPECIFIED-VALUES': { children: ['ENUM-VALUE*'] },
	'ENUM-VALUE': { children: ['ALTERNATIVE-ID?', 'PROPERTIES'], required: IDENTIFIABLE },
	PROPERTIES: { children: ['EMBEDDED-VALUE'] },
	'EMBEDDED-VALUE': { required: ['KEY', 'OTHER-CONTENT'] },
	'SPEC-TYPES': {
		choice: ['SPEC-OBJECT-TYPE', 'SPEC-RELATION-TYPE', 'SPECIFICATION-TYPE', 'RELATION-GROUP-TYPE']
	},
	'SPEC-OBJECT-TYPE': { children: ['ALTERNATIVE-ID?', 'SPEC-ATTRIBUTES?'], required: IDENTIFIABLE },
	'SPEC-RELATION-TYPE': {
		children: ['ALTERNATIVE-ID?', 'SPEC-ATTRIBUTES?'],
		required: IDENTIFIABLE
	},
	'SPECIFICATION-TYPE': {
		children: ['ALTERNATIVE-ID?', 'SPEC-ATTRIBUTES?'],
		required: IDENTIFIABLE
	},
	'SPEC-ATTRIBUTES': { choice: VALUE_KINDS.map((k) => `ATTRIBUTE-DEFINITION-${k}`) },
	...Object.fromEntries(
		VALUE_KINDS.flatMap((k) => [
			[
				`ATTRIBUTE-DEFINITION-${k}`,
				{
					children: ['ALTERNATIVE-ID?', 'DEFAULT-VALUE?', 'TYPE'],
					required: k === 'ENUMERATION' ? [...IDENTIFIABLE, 'MULTI-VALUED'] : IDENTIFIABLE
				}
			],
			[
				`ATTRIBUTE-VALUE-${k}`,
				k === 'XHTML'
					? { children: ['DEFINITION', 'THE-ORIGINAL-VALUE?', 'THE-VALUE'] }
					: k === 'ENUMERATION'
						? { children: ['DEFINITION', 'VALUES?'] }
						: { children: ['DEFINITION'], required: ['THE-VALUE'] }
			]
		])
	),
	'THE-VALUE': { xhtml: true },
	'THE-ORIGINAL-VALUE': { xhtml: true },
	'SPEC-OBJECTS': { children: ['SPEC-OBJECT*'] },
	'SPEC-OBJECT': { children: ['ALTERNATIVE-ID?', 'VALUES?', 'TYPE'], required: IDENTIFIABLE },
	'SPEC-RELATIONS': { children: ['SPEC-RELATION*'] },
	'SPEC-RELATION': {
		children: ['ALTERNATIVE-ID?', 'VALUES?', 'SOURCE', 'TARGET', 'TYPE'],
		required: IDENTIFIABLE
	},
	SOURCE: REF('SPEC-OBJECT'),
	TARGET: REF('SPEC-OBJECT'),
	OBJECT: REF('SPEC-OBJECT'),
	SPECIFICATIONS: { children: ['SPECIFICATION*'] },
	SPECIFICATION: {
		children: ['ALTERNATIVE-ID?', 'VALUES?', 'CHILDREN?', 'TYPE'],
		required: IDENTIFIABLE
	},
	CHILDREN: { children: ['SPEC-HIERARCHY*'] },
	'SPEC-HIERARCHY': {
		children: ['ALTERNATIVE-ID?', 'CHILDREN?', 'EDITABLE-ATTS?', 'OBJECT'],
		required: IDENTIFIABLE
	}
};

/** What a `…-REF` must point at: the elements whose IDENTIFIER it may name. */
function refTarget(refName: string): string {
	return refName.replace(/-REF$/, '');
}

/**
 * Problems with a ReqIF document, as sentences (none: it follows the
 * schema's rules checked here): well-formed XML, the REQ-IF root in the ReqIF
 * namespace, each element's children in the schema's order with the required
 * ones there, required attributes, IDENTIFIERs unique, every reference to an
 * element of the right kind, and values of an attribute that their spec
 * object's type has.
 */
export function checkReqif(xml: string): string[] {
	let root: XmlElement;
	try {
		root = parseXml(xml);
	} catch (error) {
		return [error instanceof Error ? error.message : String(error)];
	}
	const problems: string[] = [];
	if (root.name !== 'REQ-IF') problems.push(`The root is <${root.name}>, not <REQ-IF>.`);
	if (root.attributes.xmlns !== REQIF_NAMESPACE)
		problems.push(`<REQ-IF> is not in the ReqIF namespace ${REQIF_NAMESPACE}.`);

	const ids = new Map<string, XmlElement>();
	const refs: XmlElement[] = [];
	const check = (e: XmlElement, path: string) => {
		const name = localName(e);
		const rule = RULES[name];
		if (name.endsWith('-REF')) {
			refs.push(e);
			return;
		}
		if (!rule) {
			if (
				![
					'ALTERNATIVE-ID',
					'TOOL-EXTENSIONS',
					'EDITABLE-ATTS',
					'SPEC-RELATION-GROUPS',
					'RELATION-GROUP-TYPE',
					'DEFAULT-VALUE',
					'VALUES',
					'TYPE',
					'DEFINITION'
				].includes(name) &&
				!/^(COMMENT|CREATION-TIME|REPOSITORY-ID|REQ-IF-TOOL-ID|REQ-IF-VERSION|SOURCE-TOOL-ID|TITLE)$/.test(
					name
				)
			)
				problems.push(`Line ${e.line}: <${e.name}> is not a ReqIF element (in ${path}).`);
		}
		for (const a of rule?.required ?? [])
			if (e.attributes[a] === undefined) problems.push(`Line ${e.line}: <${name}> has no ${a}.`);
		const id = e.attributes.IDENTIFIER;
		if (id !== undefined) {
			if (!/^[A-Za-z_][\w.-]*$/.test(id))
				problems.push(`Line ${e.line}: IDENTIFIER ${id} is not an XML ID.`);
			if (ids.has(id))
				problems.push(
					`Line ${e.line}: IDENTIFIER ${id} is used twice (also line ${ids.get(id)!.line}).`
				);
			else ids.set(id, e);
		}
		if (rule?.xhtml) {
			const content = elements(e);
			if (content.length !== 1 || !/^(div|p)$/.test(localName(content[0]!)))
				problems.push(`Line ${e.line}: an XHTML value must be one <div> or <p>.`);
			if (content.some((c) => c.name.indexOf(':') < 0 && !c.attributes.xmlns))
				problems.push(`Line ${e.line}: XHTML not in the XHTML namespace.`);
			return;
		}
		if (rule?.choice)
			for (const c of elements(e))
				if (!rule.choice.includes(localName(c)))
					problems.push(`Line ${c.line}: <${c.name}> is out of place in <${name}>.`);
		if (rule?.children) {
			// Children in the schema's order: walk the pattern alongside them.
			const kids = elements(e);
			let k = 0;
			for (const slot of rule.children) {
				const many = slot.endsWith('*');
				const optional = many || slot.endsWith('?');
				const want = slot.replace(/[?*]$/, '');
				let count = 0;
				while (k < kids.length && localName(kids[k]!) === want && (many || count === 0)) {
					k++;
					count++;
				}
				if (!count && !optional) problems.push(`Line ${e.line}: <${name}> has no <${want}>.`);
			}
			for (; k < kids.length; k++)
				problems.push(`Line ${kids[k]!.line}: <${kids[k]!.name}> is out of place in <${name}>.`);
		}
		for (const c of elements(e)) check(c, `${path}/${name}`);
		if (/^(TYPE|DEFINITION|SOURCE|TARGET|OBJECT)$/.test(name) && elements(e).length !== 1)
			problems.push(`Line ${e.line}: <${name}> must hold exactly one reference.`);
	};
	check(root, '');

	for (const ref of refs) {
		const target = ids.get(textOf(ref).trim());
		if (!target)
			problems.push(
				`Line ${ref.line}: <${ref.name}> points to ${textOf(ref).trim() || 'nothing'}, which is not in the file.`
			);
		else if (localName(target) !== refTarget(localName(ref)))
			problems.push(`Line ${ref.line}: <${ref.name}> points to a <${target.name}>.`);
	}

	// Values must be of attributes their object's type defines.
	const typeAttributes = new Map<string, Set<string>>();
	for (const [id, e] of ids) {
		if (!/^(SPEC-OBJECT-TYPE|SPEC-RELATION-TYPE|SPECIFICATION-TYPE)$/.test(localName(e))) continue;
		const holder = child(e, 'SPEC-ATTRIBUTES');
		typeAttributes.set(
			id,
			new Set((holder ? elements(holder) : []).map((a) => a.attributes.IDENTIFIER ?? ''))
		);
	}
	for (const e of ids.values()) {
		if (!/^(SPEC-OBJECT|SPEC-RELATION|SPECIFICATION)$/.test(localName(e))) continue;
		const typeRef = child(e, 'TYPE');
		const allowed = typeAttributes.get(typeRef ? textOf(typeRef).trim() : '');
		const values = child(e, 'VALUES');
		for (const v of values ? elements(values) : []) {
			const definition = child(v, 'DEFINITION');
			const id = definition ? textOf(definition).trim() : '';
			if (allowed && !allowed.has(id))
				problems.push(
					`Line ${v.line}: a value of ${id}, which the type of ${e.attributes.IDENTIFIER} does not have.`
				);
		}
	}
	return problems;
}
