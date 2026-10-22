/**
 * An FMEA line's risk controls and mitigations, as model references in
 * the line (the `RiskAnalysis::Fmea` fields `riskControls` and
 * `mitigations`), and the new controls and mitigations a form can make for
 * it:
 *
 *   @Fmea about drone::battery {
 *       …
 *       riskControls = ('RC-001', 'RC-004');
 *       mitigations = batteryManagementSystem;
 *   }
 *   requirement <'RC-004'> 'Cell venting' : RiskControl { … }
 *   action cellVents : Mitigation {
 *       :>> kind = MitigationKind::prevention;
 *       :>> status = MitigationStatus::proposed;
 *   }
 */
import { docComment, name as sysmlName, skipTrivia } from './sysml';

/** The `@…` annotation written at a line (1-based): from its `@` to its closing `}` (or `;`). */
export function annotationAt(
	text: string,
	line: number
): { from: number; to: number; open: number } | null {
	let start = 0;
	for (let n = 1; n < line; n++) {
		const next = text.indexOf('\n', start);
		if (next < 0) return null;
		start = next + 1;
	}
	const end = text.indexOf('\n', start);
	const from = text.indexOf('@', start);
	if (from < 0 || (end >= 0 && from > end)) return null;
	let depth = 0;
	let open = -1;
	for (let i = from; i < text.length; i++) {
		const past = skipTrivia(text, i);
		if (past !== i) {
			i = past - 1;
			continue;
		}
		const c = text[i];
		if (c === ';' && depth === 0) return { from, to: i + 1, open: -1 };
		if (c === '{') {
			if (depth === 0) open = i;
			depth++;
		} else if (c === '}' && --depth === 0) return { from, to: i + 1, open };
	}
	return null;
}

/** `'RC-001'`, `(a, b)`: a reference field's value, written for its names. */
export function referenceValue(names: readonly string[]): string {
	return names.length === 1 ? names[0]! : `(${names.join(', ')})`;
}

/**
 * The text with an annotation's field set to these names (`field = (a, b);`),
 * or the field taken out when there are none. Null when the line holds no
 * annotation with a body.
 */
export function withLineField(
	text: string,
	line: number,
	field: string,
	names: readonly string[]
): string | null {
	const at = annotationAt(text, line);
	if (!at || at.open < 0) return null;
	const close = at.to - 1;
	// The field's statement at the top of the body, if it has one.
	let depth = 0;
	let found: { from: number; to: number } | null = null;
	const statement = new RegExp(`${field}\\s*=`, 'y');
	for (let i = at.open + 1; i < close; i++) {
		const past = skipTrivia(text, i);
		if (past !== i) {
			i = past - 1;
			continue;
		}
		const c = text[i]!;
		if (c === '{' || c === '(') depth++;
		else if (c === '}' || c === ')') depth--;
		else if (depth === 0 && !/[\w']/.test(text[i - 1] ?? ' ')) {
			statement.lastIndex = i;
			if (statement.test(text)) {
				let end = i;
				while (end < close && text[end] !== ';') {
					const skip = skipTrivia(text, end);
					end = skip !== end ? skip : end + 1;
				}
				found = { from: i, to: end + 1 };
				break;
			}
		}
	}
	const value = names.length ? `${field} = ${referenceValue(names)};` : '';
	if (found) {
		if (value) return text.slice(0, found.from) + value + text.slice(found.to);
		// Take the whole line out when the statement is alone on it.
		const lineStart = text.lastIndexOf('\n', found.from - 1) + 1;
		const lineEnd = text.indexOf('\n', found.to);
		const alone =
			!text.slice(lineStart, found.from).trim() &&
			!text.slice(found.to, lineEnd < 0 ? text.length : lineEnd).trim();
		return alone
			? text.slice(0, lineStart) + text.slice(lineEnd < 0 ? text.length : lineEnd + 1)
			: text.slice(0, found.from) + text.slice(found.to).replace(/^ /, '');
	}
	if (!value) return text;
	// A new statement before the closing brace, indented like the others.
	const body = text.slice(at.open + 1, close);
	const indent =
		/\n([ \t]+)\S/.exec(body)?.[1] ??
		`${/^[ \t]*/.exec(text.slice(text.lastIndexOf('\n', at.from) + 1))![0]}    `;
	const closeLineStart = text.lastIndexOf('\n', close - 1) + 1;
	if (!text.slice(closeLineStart, close).trim())
		return `${text.slice(0, closeLineStart)}${indent}${value}\n${text.slice(closeLineStart)}`;
	// `@Fmea about x { a = 1; }` on one line: the value goes before its `}`.
	const before = text.slice(0, close).replace(/\s*$/, '');
	return `${before} ${value} ${text.slice(close)}`;
}

export interface MitigationSpec {
	name: string;
	/** What the work is, in words (its doc). */
	description: string;
	/** A `MitigationKind` literal. */
	kind: 'prevention' | 'detection';
	owner: string;
}

/** A mitigation action: the work that lowers a risk. */
export function mitigationText(m: MitigationSpec): string {
	const lines = [`action ${sysmlName(m.name.trim())} : Mitigation {`];
	if (m.description.trim()) lines.push(`    ${docComment(m.description)}`);
	lines.push(`    :>> kind = MitigationKind::${m.kind};`);
	lines.push('    :>> status = MitigationStatus::proposed;');
	if (m.owner.trim()) lines.push(`    :>> owner = "${m.owner.trim().replace(/["\\]/g, '\\$&')}";`);
	lines.push('}');
	return lines.join('\n');
}
