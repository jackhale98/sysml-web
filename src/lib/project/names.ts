/**
 * SysML names as people read them. Mirrors `sysml-semantic::name`
 * (KerML 8.2.2.3): unrestricted names are single-quoted with escapes.
 */

const ESCAPES: Record<string, string> = {
	"'": "'",
	'"': '"',
	b: '\b',
	f: '\f',
	t: '\t',
	n: '\n',
	'\\': '\\'
};

/** `'Max take-off mass'` → `Max take-off mass`; basic names unchanged. */
export function unescapeName(text: string): string {
	if (text.length < 2 || !text.startsWith("'") || !text.endsWith("'")) return text;
	return text.slice(1, -1).replace(/\\(.)/g, (whole, c: string) => ESCAPES[c] ?? whole);
}

/** Unescape every segment of a qualified name or feature chain. */
export function displayReference(reference: string): string {
	return reference
		.split(/(::|\.)/)
		.map((part) => (part === '::' || part === '.' ? part : unescapeName(part)))
		.join('');
}

/** The last segment of a qualified name: `Priority::high` → `high`. */
export function lastSegment(reference: string): string {
	const parts = reference.split('::');
	return unescapeName(parts[parts.length - 1] ?? reference);
}

/** A string literal's value, or the expression unchanged if it is not one. */
export function stringValue(expression: string): string {
	const trimmed = expression.trim();
	if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
		return trimmed.slice(1, -1).replace(/\\(.)/g, (whole, c: string) => ESCAPES[c] ?? whole);
	}
	return trimmed;
}
