/**
 * A light declaration scanner for SysML v2 and KerML text: the named
 * definitions, usages and packages of a file, with their kind, qualified
 * name, short name, documentation and line. It reads the textual notation
 * well enough to index the standard library and to list a file's top-level
 * names; it is not a parser (expressions, relationships and anonymous
 * elements are skipped).
 */

export interface Declaration {
	name: string;
	/** `<m>` in `attribute <m> metre`. */
	shortName?: string;
	/** Names of the enclosing elements and this one, joined with `::`. */
	qualifiedName: string;
	/** `part def`, `attribute`, `package`, `datatype`, … */
	kind: string;
	isDefinition: boolean;
	/** 1-based line where the declaration starts. */
	line: number;
	/** Nesting depth: 0 for a file's top-level elements. */
	depth: number;
	/** The first `doc` comment in its body, without the comment markers. */
	doc?: string;
}

/** Token types. */
const T = { Word: 0, Name: 1, String: 2, Comment: 3, Punct: 4 } as const;

interface Token {
	type: (typeof T)[keyof typeof T];
	text: string;
	line: number;
}

const isWordStart = (c: number) =>
	(c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c > 127;
const isWordPart = (c: number) => isWordStart(c) || (c >= 48 && c <= 57);

/** Split text into words, quoted names, strings, block comments and punctuation. */
function tokenize(text: string): Token[] {
	const tokens: Token[] = [];
	const n = text.length;
	let line = 1;
	let i = 0;
	const countLines = (from: number, to: number) => {
		for (let k = from; k < to; k++) if (text.charCodeAt(k) === 10) line++;
	};
	while (i < n) {
		const c = text.charCodeAt(i);
		if (c === 10) {
			line++;
			i++;
		} else if (c === 32 || c === 9 || c === 13) {
			i++;
		} else if (c === 47 && text.charCodeAt(i + 1) === 47) {
			// `//` note to the end of the line, or a `//* … */` note.
			if (text.charCodeAt(i + 2) === 42) {
				const end = text.indexOf('*/', i + 3);
				const stop = end < 0 ? n : end + 2;
				countLines(i, stop);
				i = stop;
			} else {
				const end = text.indexOf('\n', i);
				i = end < 0 ? n : end;
			}
		} else if (c === 47 && text.charCodeAt(i + 1) === 42) {
			const end = text.indexOf('*/', i + 2);
			const stop = end < 0 ? n : end + 2;
			tokens.push({ type: T.Comment, text: text.slice(i + 2, end < 0 ? n : end), line });
			countLines(i, stop);
			i = stop;
		} else if (c === 39 || c === 34) {
			// 'quoted name' or "string", with backslash escapes.
			const start = i;
			const startLine = line;
			i++;
			while (i < n) {
				const d = text.charCodeAt(i);
				if (d === 92) i += 2;
				else if (d === c) break;
				else {
					if (d === 10) line++;
					i++;
				}
			}
			const body = text.slice(start + 1, Math.min(i, n));
			i++;
			tokens.push({
				type: c === 39 ? T.Name : T.String,
				text: c === 39 ? body.replace(/\\(.)/g, '$1') : body,
				line: startLine
			});
		} else if (isWordStart(c)) {
			const start = i;
			while (i < n && isWordPart(text.charCodeAt(i))) i++;
			tokens.push({ type: T.Word, text: text.slice(start, i), line });
		} else if (c >= 48 && c <= 57) {
			while (i < n && (isWordPart(text.charCodeAt(i)) || text.charCodeAt(i) === 46)) i++;
		} else {
			// `:>>`, `::>`, `:>` and `::` matter; other punctuation is one character.
			let p = text[i]!;
			if (p === ':') {
				if (text.startsWith(':>>', i)) p = ':>>';
				else if (text.startsWith('::>', i)) p = '::>';
				else if (text.startsWith(':>', i)) p = ':>';
				else if (text.startsWith('::', i)) p = '::';
			}
			tokens.push({ type: T.Punct, text: p, line });
			i += p.length;
		}
	}
	return tokens;
}

const VISIBILITY = new Set(['public', 'private', 'protected']);
/** Words that start a statement before a declaration (`then action a`, `entry state s`). */
const LEADING = new Set(['then', 'entry', 'exit', 'do', 'event']);
/** Words that may come before the kind keyword without changing what is declared. */
const MODIFIERS = new Set([
	'abstract',
	'variation',
	'individual',
	'readonly',
	'derived',
	'constant',
	'composite',
	'portion',
	'var',
	'const',
	'standard',
	'library',
	'nonunique',
	'ordered',
	'snapshot',
	'timeslice',
	'end',
	'in',
	'out',
	'inout',
	'ref'
]);
/** SysML kinds with both a definition (`part def`) and a usage (`part`). */
const SYSML_KINDS = new Set([
	'attribute',
	'enum',
	'occurrence',
	'item',
	'part',
	'port',
	'connection',
	'flow',
	'interface',
	'allocation',
	'action',
	'state',
	'calc',
	'constraint',
	'requirement',
	'concern',
	'case',
	'analysis',
	'verification',
	'view',
	'viewpoint',
	'rendering',
	'metadata'
]);
/** KerML classifiers: definitions. */
const KERML_DEFINITIONS = new Set([
	'type',
	'classifier',
	'class',
	'struct',
	'datatype',
	'assoc',
	'behavior',
	'function',
	'predicate',
	'interaction',
	'metaclass'
]);
/** Other kinds of named usage (KerML features and SysML special usages). */
const OTHER_USAGES = new Set([
	'feature',
	'step',
	'expr',
	'bool',
	'inv',
	'connector',
	'binding',
	'succession',
	'multiplicity',
	'message',
	'transition',
	'subject',
	'actor',
	'stakeholder',
	'objective',
	'return',
	'join',
	'fork',
	'merge',
	'decide'
]);
/** `perform action a`: the usage keyword follows. */
const USAGE_PREFIXES = new Set([
	'perform',
	'exhibit',
	'include',
	'assert',
	'satisfy',
	'verify',
	'require',
	'assume',
	'frame'
]);
/** Words that follow an anonymous declaration's keyword, so they are not its name. */
const NOT_NAMES = new Set([
	'specializes',
	'subsets',
	'redefines',
	'references',
	'typed',
	'defined',
	'conjugates',
	'chains',
	'inverse',
	'featured',
	'by',
	'of',
	'all',
	'default',
	'about',
	'for',
	'from',
	'to',
	'then',
	'first',
	'if',
	'else',
	'new',
	'null',
	'true',
	'false',
	'ordered',
	'nonunique',
	'crosses',
	'disjoint',
	'unions',
	'differences',
	'intersects',
	'connect',
	'bind',
	'allocate',
	'def'
]);
const PACKAGE_KINDS = new Set(['package', 'namespace']);

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** A name as it is written in a qualified name: quoted unless it is a plain identifier. */
export function nameSegment(name: string): string {
	return IDENTIFIER.test(name) ? name : `'${name.replace(/(['\\])/g, '\\$1')}'`;
}

/** A doc comment's text without `*` margins and surrounding blank lines. */
export function cleanDoc(body: string): string {
	return body
		.split('\n')
		.map((l) => l.replace(/^\s*\*?[ \t]?/, '').trimEnd())
		.join('\n')
		.replace(/^\n+|\n+$/g, '')
		.trim();
}

interface Scope {
	/** The element's name, or null for an anonymous body (its members are skipped). */
	name: string | null;
	kind: string;
	decl?: Declaration;
}

const isName = (t: Token | undefined): t is Token =>
	!!t && (t.type === T.Name || (t.type === T.Word && !NOT_NAMES.has(t.text)));

/**
 * What a statement declares, if it is a named element: its kind and name,
 * or, for `:>> x` and `redefines x`, the name it redefines (used to qualify
 * what its body declares).
 */
function readStatement(
	tokens: Token[],
	inEnum: boolean
): { kind: string; name?: string; shortName?: string; redefines?: string } | null {
	let i = 0;
	const at = (k: number) => tokens[k];
	const word = (k: number) => (at(k)?.type === T.Word ? at(k)!.text : undefined);
	const modifiers: string[] = [];
	// Visibility, leading words, `#Meta` prefixes (possibly qualified) and modifiers, in any order.
	for (;;) {
		const w = word(i);
		if (w && (VISIBILITY.has(w) || LEADING.has(w))) i++;
		else if (w && MODIFIERS.has(w)) modifiers.push(tokens[i++]!.text);
		else if (at(i)?.type === T.Punct && at(i)!.text === '#') {
			i += 2;
			while (at(i)?.text === '::') i += 2;
		} else break;
	}
	let kind: string | undefined;
	const w = word(i);
	const next = word(i + 1);
	if (w && USAGE_PREFIXES.has(w) && next && SYSML_KINDS.has(next)) {
		kind = next;
		i += 2;
	} else if (w && USAGE_PREFIXES.has(w) && next === 'use' && word(i + 2) === 'case') {
		kind = 'use case';
		i += 3;
	} else if (w && USAGE_PREFIXES.has(w) && !modifiers.length) {
		return null;
	} else if (w === 'use' && word(i + 1) === 'case') {
		kind = word(i + 2) === 'def' ? 'use case def' : 'use case';
		i += kind === 'use case def' ? 3 : 2;
	} else if (w && SYSML_KINDS.has(w)) {
		if (word(i + 1) === 'def') {
			kind = `${w} def`;
			i += 2;
		} else {
			kind = w;
			i++;
			// `analysis case`, `verification case`, `succession flow`
			if ((w === 'analysis' || w === 'verification') && word(i) === 'case') i++;
		}
	} else if (w === 'assoc' && word(i + 1) === 'struct') {
		kind = 'assoc struct';
		i += 2;
	} else if (w && (KERML_DEFINITIONS.has(w) || OTHER_USAGES.has(w) || PACKAGE_KINDS.has(w))) {
		kind = w;
		i++;
		if (w === 'succession' && word(i) === 'flow') {
			kind = 'succession flow';
			i++;
		}
	} else if (modifiers.length) {
		// `end x : T`, `in x : Real`, `ref x : T`: named by their last modifier.
		const last = modifiers.at(-1)!;
		kind = ['end', 'in', 'out', 'inout', 'ref'].includes(last) ? last : undefined;
		if (!kind) return null;
	} else if (inEnum && isName(at(i)) && (!at(i + 1) || /^[;={]$/.test(at(i + 1)!.text))) {
		// A bare enumeration literal: `enum def Colour { red; green; }`.
		return { kind: 'enum', name: at(i)!.text };
	} else {
		const first = at(i);
		if (first?.text === ':>>' || first?.text === 'redefines') {
			const target = at(i + 1);
			if (target && (target.type === T.Word || target.type === T.Name))
				return { kind: '', redefines: target.text };
		}
		return null;
	}
	// `type all T` (sufficient), `feature all portions`
	if (word(i) === 'all') i++;
	let shortName: string | undefined;
	if (at(i)?.text === '<' && at(i + 2)?.text === '>') {
		const t = at(i + 1)!;
		if (t.type === T.Word || t.type === T.Name) shortName = t.text;
		i += 3;
	}
	const name = isName(at(i)) ? at(i)!.text : undefined;
	if (!name) {
		const after = at(i);
		const target = at(i + 1);
		if (
			(after?.text === ':>>' || after?.text === 'redefines') &&
			target &&
			(target.type === T.Word || target.type === T.Name)
		) {
			return { kind, shortName, redefines: target.text };
		}
	}
	return { kind, name: name ?? shortName, shortName: name ? shortName : undefined };
}

const isDefinitionKind = (kind: string) =>
	kind.endsWith(' def') ||
	PACKAGE_KINDS.has(kind) ||
	KERML_DEFINITIONS.has(kind) ||
	kind === 'assoc struct';

/** Every named element declared in `text`, in order. */
export function scanDeclarations(text: string): Declaration[] {
	const tokens = tokenize(text);
	const out: Declaration[] = [];
	const scopes: Scope[] = [];
	let statement: Token[] = [];

	const qualified = (name: string): string | null => {
		const parts: string[] = [];
		for (const scope of scopes) {
			if (scope.name === null) return null;
			parts.push(nameSegment(scope.name));
		}
		parts.push(nameSegment(name));
		return parts.join('::');
	};
	const inEnum = () => scopes.at(-1)?.kind === 'enum def';

	/** Record the statement's declaration; returns the scope its body (if any) opens. */
	const finish = (): Scope => {
		const tokens = statement;
		statement = [];
		const read = tokens.length ? readStatement(tokens, inEnum()) : null;
		if (!read) return { name: null, kind: '' };
		if (!read.name) {
			return { name: read.redefines ?? null, kind: read.kind };
		}
		const qualifiedName = qualified(read.name);
		if (qualifiedName === null) return { name: null, kind: read.kind };
		const decl: Declaration = {
			name: read.name,
			qualifiedName,
			kind: read.kind,
			isDefinition: isDefinitionKind(read.kind),
			line: tokens[0]!.line,
			depth: scopes.length
		};
		if (read.shortName) decl.shortName = read.shortName;
		out.push(decl);
		return { name: read.name, kind: read.kind, decl };
	};

	for (const token of tokens) {
		if (token.type === T.Punct) {
			if (token.text === ';') {
				finish();
				continue;
			}
			if (token.text === '{') {
				scopes.push(finish());
				continue;
			}
			if (token.text === '}') {
				finish();
				scopes.pop();
				continue;
			}
		}
		if (token.type === T.Comment) {
			const head = statement.find((t) => t.type === T.Word && !VISIBILITY.has(t.text))?.text;
			if (!statement.length) continue; // a comment on its own
			if (head === 'doc') {
				const owner = scopes.at(-1)?.decl;
				if (owner && owner.doc === undefined) {
					const doc = cleanDoc(token.text);
					if (doc) owner.doc = doc;
				}
				statement = [];
				continue;
			}
			if (head === 'comment' || head === 'rep' || head === 'language') {
				statement = [];
				continue;
			}
			continue; // inside an expression or a relationship
		}
		statement.push(token);
	}
	return out;
}

/**
 * The names (and short names) a file declares at its top level, as a
 * `.kpar`'s `.meta.json` index records them.
 */
export function topLevelNames(text: string): string[] {
	const names: string[] = [];
	for (const d of scanDeclarations(text)) {
		if (d.depth !== 0) continue;
		names.push(d.name);
		if (d.shortName) names.push(d.shortName);
	}
	return names;
}

/** The first package a file declares (`standard library package ISQ {` → `ISQ`). */
export function declaredPackage(declarations: readonly Declaration[]): string {
	return declarations.find((d) => d.depth === 0 && d.kind === 'package')?.name ?? '';
}
