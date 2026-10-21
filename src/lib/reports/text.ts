/**
 * What reports need that the engine's per-file model does not carry yet,
 * read from the SysML text of one element: requirement derivations
 * (`#derivation connection`, RequirementDerivation), and an interface
 * def's ends and flows. Comments are removed first, so text inside them is
 * never read as model. The semantic engine will provide these as resolved
 * relationships; until then the scan is deliberately narrow.
 */

/** The text with comments blanked out (same length, so offsets still match). */
export function withoutComments(text: string): string {
	return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
}

/** A name as written, without the spaces around `::`, `.` and `~`. */
function compact(reference: string): string {
	return reference.trim().replace(/\s*(::|\.|~)\s*/g, '$1');
}

const NAME = String.raw`(?:'(?:[^'\\]|\\.)*'|[\w$]+)`;
const QUALIFIED = String.raw`${NAME}(?:\s*::\s*${NAME})*`;
const CHAIN = String.raw`${NAME}(?:\s*(?:::|\.)\s*${NAME})*`;

export interface Derivation {
	/** The requirement derived from, as written. */
	original: string;
	/** The requirements derived from it, as written. */
	derived: string[];
	file: string;
}

/**
 * `#derivation connection { end #original ::> A; end #derive ::> B; … }`
 * (also `@Derivation` and `derivation connection` spellings).
 */
export function readDerivations(file: string, source: string): Derivation[] {
	const text = withoutComments(source);
	const out: Derivation[] = [];
	const block = /(?:#|@)?\s*derivation\s+connection\b[^{;]*\{([\s\S]*?)\}/gi;
	for (const match of text.matchAll(block)) {
		const body = match[1]!;
		const end = (role: string) =>
			[
				...body.matchAll(
					new RegExp(
						String.raw`end\s+#${role}\s+(?:${NAME}\s*)?(?:::>|references)\s*(${QUALIFIED})\s*;`,
						'g'
					)
				)
			].map((m) => compact(m[1]!));
		const original = end('original')[0];
		const derived = end('derive');
		if (original && derived.length) out.push({ original, derived, file });
	}
	return out;
}

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
