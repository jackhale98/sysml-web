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

/** SysML v2 / KerML reserved words: a name spelled like one must be quoted. */
const KEYWORDS = new Set(
	(
		'about abstract accept action actor after alias all allocate allocation analysis and as ' +
		'assert assign assoc assume at attribute behavior bind binding bool by calc case chains ' +
		'class classifier comment composite concern conjugate conjugates conjugation connect ' +
		'connection connector const constant constraint crosses datatype decide def default ' +
		'defined dependency derived differences disjoining disjoint do doc else end entry enum ' +
		'event exhibit exit expose expr false feature featured featuring filter first flow for ' +
		'fork frame from function hastype if implies import in include individual inout interaction ' +
		'interface intersects inv inverse inverting istype item join language library locale loop ' +
		'member merge message meta metaclass metadata multiplicity namespace new nonunique not null ' +
		'objective occurrence of or ordered out package parallel part perform port portion predicate ' +
		'private protected public readonly redefines redefinition ref references render rendering ' +
		'rep require requirement return satisfy send snapshot specialization specializes stakeholder ' +
		'standard state step struct subclassifier subject subset subsets subtype succession ' +
		'terminate then timeslice to transition true type typed typing unions until use var variant ' +
		'variation verification verify via view viewpoint when while xor'
	).split(' ')
);

/** Whether `word` is a SysML v2 / KerML reserved word. */
export function isReservedWord(word: string): boolean {
	return KEYWORDS.has(word);
}

/**
 * A name as SysML text: as-is when it is a basic name that is not a reserved
 * word, otherwise single-quoted
 * with backslashes escaped. An apostrophe becomes a typographic one (’): KerML
 * allows `\'` in a quoted name, but the engine's parser does not read it yet.
 */
export function sysmlName(raw: string): string {
	const name = raw.replace(/\s+/g, ' ').trim();
	if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !KEYWORDS.has(name)) return name;
	return `'${name.replace(/\\/g, '\\\\').replace(/'/g, '’')}'`;
}
