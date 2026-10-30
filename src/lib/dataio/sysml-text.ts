/**
 * SysML text for imported requirements, written the way the engine's own
 * edits and the demo model write it: four-space indents, `doc /* … *\/`
 * comments aligned on their stars, `:>> attribute = Enum::literal;`
 * redefinitions, then `@StatusInfo`, `@Rationale` and `@Issue` metadata, and
 * `@ReqIF` for requirements imported from a ReqIF file.
 */

export { sysmlName } from '#lib/project/names.ts';
import { sysmlName } from '#lib/project/names.ts';

/** A string literal: `"…"` with `\"`, `\\` and line breaks escaped. */
export function sysmlString(value: string): string {
	return `"${value
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"')
		.replace(/\r\n?/g, '\n')
		.replace(/\n/g, '\\n')
		.replace(/\t/g, '\\t')}"`;
}

/** Break text into lines of at most `width` characters, keeping its own line breaks. */
export function wrap(text: string, width = 80): string[] {
	const lines: string[] = [];
	for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
		const words = paragraph
			.trim()
			.split(/[ \t]+/)
			.filter(Boolean);
		if (!words.length) {
			lines.push('');
			continue;
		}
		let line = '';
		for (const word of words) {
			if (line && line.length + 1 + word.length > width) {
				lines.push(line);
				line = word;
			} else line = line ? `${line} ${word}` : word;
		}
		lines.push(line);
	}
	while (lines.length && lines.at(-1) === '') lines.pop();
	while (lines.length && lines[0] === '') lines.shift();
	return lines;
}

/**
 * A `doc` comment at the given indent. Continuation lines put their star
 * under the opening one; `*\/` inside the text becomes `* /` so the comment
 * cannot end early.
 */
export function docComment(text: string, indent = ''): string {
	const safe = text.replace(/\*\//g, '* /');
	const lines = wrap(safe);
	if (!lines.length) return '';
	const rest = `${indent}     *`;
	return (
		`${indent}doc /* ${lines[0]}` +
		lines
			.slice(1)
			.map((line) => `\n${rest}${line ? ` ${line}` : ''}`)
			.join('') +
		' */'
	);
}

/** One attribute value: an enum literal reference, a list of them, or a literal. */
export type AttributeValue =
	| { kind: 'enum'; enumName: string; literals: string[]; many: boolean }
	| { kind: 'string'; value: string }
	| { kind: 'number'; value: string }
	| { kind: 'boolean'; value: boolean };

export interface RequirementSpec {
	id?: string;
	name: string;
	/** Name of the requirement definition it is typed by, as it resolves in the package. */
	type?: string;
	doc?: string;
	/** Attribute redefinitions, in the definition's order. */
	attributes: { name: string; value: AttributeValue }[];
	status?: string;
	owner?: string;
	originator?: string;
	rationale?: string;
	issues?: string[];
	/** The IDENTIFIER of the ReqIF object it comes from, kept so a later import updates it. */
	reqif?: string;
}

function attributeValue(value: AttributeValue): string {
	switch (value.kind) {
		case 'enum': {
			// A literal spelled like a keyword is quoted, as its declaration is (`V::'analysis'`).
			const refs = value.literals.map((l) => `${value.enumName}::${sysmlName(l)}`);
			return refs.length > 1 ? `(${refs.join(', ')})` : refs[0]!;
		}
		case 'string':
			return sysmlString(value.value);
		case 'number':
			return value.value;
		case 'boolean':
			return String(value.value);
	}
}

/** A `requirement` usage with its body, indented for the top of a package body. */
export function requirementText(spec: RequirementSpec): string {
	const header =
		'requirement ' +
		(spec.id ? `<${sysmlName(spec.id)}> ` : '') +
		sysmlName(spec.name) +
		(spec.type ? ` : ${spec.type}` : '');
	const body: string[] = [];
	if (spec.doc?.trim()) body.push(docComment(spec.doc, '    '));
	for (const { name, value } of spec.attributes) {
		if (value.kind === 'enum' && !value.literals.length) continue;
		body.push(`    :>> ${sysmlName(name)} = ${attributeValue(value)};`);
	}
	const status = [
		spec.status ? `status = StatusKind::${spec.status};` : '',
		spec.owner ? `owner = ${sysmlString(spec.owner)};` : '',
		spec.originator ? `originator = ${sysmlString(spec.originator)};` : ''
	].filter(Boolean);
	if (status.length) body.push(`    @StatusInfo { ${status.join(' ')} }`);
	if (spec.rationale?.trim()) {
		body.push(`    @Rationale { text = ${sysmlString(spec.rationale.trim())}; }`);
	}
	for (const issue of spec.issues ?? []) {
		if (issue.trim()) body.push(`    @Issue { text = ${sysmlString(issue.trim())}; }`);
	}
	if (spec.reqif) body.push(`    ${reqifAnnotation(spec.reqif)}`);
	return body.length ? `${header} {\n${body.join('\n')}\n}` : `${header};`;
}

/** `@ReqIF { identifier = "…"; }`: where an element came from in a ReqIF file. */
export function reqifAnnotation(identifier: string): string {
	return `@ReqIF { identifier = ${sysmlString(identifier)}; }`;
}

/** A derivation: the original requirement and the ones derived from it. */
export function derivationText(original: string, derived: string[]): string {
	return [
		'#derivation connection {',
		`    end #original ::> ${original};`,
		...derived.map((d) => `    end #derive ::> ${d};`),
		'}'
	].join('\n');
}
