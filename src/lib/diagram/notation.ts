/**
 * SysML v2 graphical notation for engine diagram nodes: which keyword a
 * node shows, whether it is a definition (sharp corners) or a usage
 * (rounded), and how its features split into named compartments.
 */
import type { DiagramNode } from '#lib/engine/types.ts';
import { familyOf, type Family } from '#lib/ui/kinds.ts';

export type Shape =
	'box' | 'package' | 'port' | 'initial' | 'final' | 'decision' | 'bar' | 'actor' | 'note';

export interface Compartment {
	/** Compartment name as SysML writes it: "parts", "ports", "attributes"… */
	title: string;
	rows: string[];
}

export interface BorderPort {
	label: string;
	side: 'left' | 'right';
}

export interface Notation {
	shape: Shape;
	/** The keyword shown in guillemets, e.g. "part def". */
	keyword: string;
	/** Element kind without "def", e.g. "part", "use case". */
	base: string;
	family: Family;
	isDefinition: boolean;
	isAbstract: boolean;
	/** Documentation / requirement text, shown as prose. */
	doc: string | null;
	compartments: Compartment[];
	/** Ports drawn on the boundary (interconnection view). */
	ports: BorderPort[];
}

/** Maximum rows per compartment before "+n more". */
export const MAX_ROWS = 6;

const PLURAL: Record<string, string> = {
	part: 'parts',
	port: 'ports',
	attribute: 'attributes',
	item: 'items',
	action: 'actions',
	state: 'states',
	ref: 'references',
	requirement: 'requirements',
	constraint: 'constraints',
	calc: 'calculations',
	connection: 'connections',
	interface: 'interfaces',
	flow: 'flows',
	enum: 'enums',
	occurrence: 'occurrences',
	perform: 'perform actions',
	exhibit: 'exhibit states',
	satisfy: 'satisfies',
	verify: 'verifies',
	subject: 'subject',
	objective: 'objective',
	'use case': 'use cases'
};

const DIRECTIONS = new Set(['in', 'out', 'inout']);
const HIDDEN = /succession|_node$|^(first|then|accept|send|assign|if|while|for|loop)$/;

/** "in port" → { base: "port", direction: "in" }. */
function splitKeyword(keyword: string): { base: string; direction: string | null } {
	const [first, ...rest] = keyword.trim().split(/\s+/);
	if (first && DIRECTIONS.has(first) && rest.length) {
		return { base: rest.join(' '), direction: first };
	}
	return { base: keyword.trim(), direction: null };
}

function shapeOf(node: DiagramNode): Shape {
	switch (node.kind) {
		case 'package':
			return 'package';
		case 'port':
			return 'port';
		case 'initial_state':
			return 'initial';
		case 'final_state':
			return 'final';
		case 'decision':
			return 'decision';
		case 'fork':
		case 'join':
			return 'bar';
		case 'actor':
			return 'actor';
		case 'note':
			return 'note';
		default:
			return 'box';
	}
}

export function notationOf(node: DiagramNode, view: 'general' | 'interconnection' | string) {
	const stereotype = node.stereotype?.replace(/^<<|>>$/g, '').trim() || null;
	const fallback =
		node.kind === 'block'
			? 'part'
			: node.kind === 'use_case'
				? 'use case'
				: node.kind === 'initial_state' || node.kind === 'final_state'
					? 'state'
					: node.kind;
	const keywordSource = stereotype ?? (node.is_definition ? `${fallback} def` : fallback);
	const isDefinition = node.is_definition || /\bdef$/.test(keywordSource);
	const base = keywordSource.replace(/\s*def$/, '').trim() || fallback;
	const keyword = isDefinition && base !== 'package' ? `${base} def` : base;
	const shape = base === 'package' ? 'package' : shapeOf(node);

	let isAbstract = false;
	let doc: string | null = null;
	const ports: BorderPort[] = [];
	const groups = new Map<string, string[]>();
	for (const [rawKeyword, text] of node.attributes) {
		if (rawKeyword === 'modifier') {
			if (text === 'abstract') isAbstract = true;
			continue;
		}
		if (rawKeyword === 'text' || rawKeyword === 'doc') {
			doc = text;
			continue;
		}
		// Control nodes and successions belong to the flow, not to a compartment.
		if (!text.trim() || HIDDEN.test(rawKeyword)) continue;
		const { base: rowBase, direction } = splitKeyword(rawKeyword);
		const row = direction ? `${direction} ${text}` : text;
		if (rowBase === 'port' && view === 'interconnection') {
			ports.push({ label: row, side: direction === 'out' ? 'right' : 'left' });
			continue;
		}
		const title = PLURAL[rowBase] ?? (rowBase.endsWith('s') ? rowBase : `${rowBase}s`);
		const rows = groups.get(title) ?? [];
		rows.push(row);
		groups.set(title, rows);
	}

	return {
		shape,
		keyword,
		base,
		family: base === 'package' ? 'package' : familyOf(base.replace(/ /g, '_')),
		isDefinition: isDefinition && base !== 'package',
		isAbstract,
		doc,
		compartments: [...groups].map(([title, rows]) => ({ title, rows })),
		ports
	} satisfies Notation;
}

/** "<<Power>>" edge labels carry an item type; show it plainly. */
export function edgeLabelText(kind: string, label: string | null): string | null {
	if (!label) return null;
	const inner = label.replace(/^<<(.+)>>$/, '$1').trim();
	return inner === kind ? null : inner;
}
