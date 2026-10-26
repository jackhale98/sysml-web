/**
 * What reports need that the engine's per-file model does not carry yet,
 * read from the SysML text of one element: requirement derivations
 * (`#derivation connection`, RequirementDerivation), and an interface
 * def's ends and flows. Comments are removed first, so text inside them is
 * never read as model. The semantic engine will provide these as resolved
 * relationships; until then the scan is deliberately narrow.
 */

import { withoutComments } from '#lib/project/derivations.ts';

export { readDerivations, withoutComments, type Derivation } from '#lib/project/derivations.ts';

/** A name as written, without the spaces around `::`, `.` and `~`. */
function compact(reference: string): string {
	return reference.trim().replace(/\s*(::|\.|~)\s*/g, '$1');
}

const NAME = String.raw`(?:'(?:[^'\\]|\\.)*'|[\w$]+)`;
const QUALIFIED = String.raw`${NAME}(?:\s*::\s*${NAME})*`;
const CHAIN = String.raw`${NAME}(?:\s*(?:::|\.)\s*${NAME})*`;

export interface InterfaceEnd {
	name: string;
	/** The port type as written, `~` included when conjugated. */
	type: string;
}

export interface InterfaceFlow {
	item: string | null;
	from: string;
	to: string;
}

/** The ends and flows written in an interface (or connection) def's body. */
export function readInterfaceBody(body: string): { ends: InterfaceEnd[]; flows: InterfaceFlow[] } {
	const text = withoutComments(body);
	const ends = [
		...text.matchAll(
			new RegExp(
				String.raw`\bend\s+(?:port\s+|part\s+|item\s+)?(${NAME})\s*(?::|defined\s+by)\s*(~?\s*${QUALIFIED})`,
				'g'
			)
		)
	].map((m) => ({ name: m[1]!.replace(/^'|'$/g, ''), type: compact(m[2]!) }));
	const flows = [
		...text.matchAll(
			new RegExp(
				String.raw`\b(?:flow|message)\b(?:\s+${NAME})?(?:\s+of\s+(${QUALIFIED}))?\s+from\s+(${CHAIN})\s+to\s+(${CHAIN})\s*[;{]`,
				'g'
			)
		)
	].map((m) => ({
		item: m[1] ? compact(m[1]) : null,
		from: compact(m[2]!),
		to: compact(m[3]!)
	}));
	return { ends, flows };
}

/** UTF-8 byte offsets of a text → the UTF-16 slice between them. */
export function sliceBytes(text: string, start: number, end: number): string {
	const bytes = new TextEncoder().encode(text);
	return new TextDecoder().decode(bytes.subarray(start, end));
}
