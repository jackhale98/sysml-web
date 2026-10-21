/**
 * The toolkit's findings as the app's diagnostics: severities mapped, byte
 * positions turned into the app's spans (via `offsets.ts`, and back through
 * the repair when a unit didn't parse), and the noise a syntax error causes
 * kept out of the way while someone is typing:
 *
 * - **Parse errors** become the file's syntax errors. A parse error within
 *   two lines after another one in the same file is the parser recovering
 *   from the first, so only the first is shown.
 * - **Follow-on findings.** A unit that doesn't parse is repaired by cutting
 *   out the broken member and closing open bodies (`lenientSources`), which
 *   can move or drop declarations: other files then report their names as
 *   unresolved (an unclosed `{` gave 40 such warnings on the demo). While any
 *   file has a syntax error, an "unresolved reference" to a name written in
 *   a file with a syntax error is hidden, and the first syntax error says how
 *   many were hidden.
 */
import type { Diagnostic, Severity, SyntaxError } from '../types';
import type { TkFinding } from './api';
import type { UnitInfo } from './model';

export interface Problems {
	syntaxErrors: Map<string, SyntaxError[]>;
	diagnostics: Map<string, Diagnostic[]>;
	/** How many follow-on findings were hidden. */
	hidden: number;
}

/** Lines after a parse error within which another parse error counts as its echo. */
const ECHO_LINES = 2;

export function toProblems(
	parse: TkFinding[],
	session: TkFinding[],
	units: Map<string, UnitInfo>
): Problems {
	const syntaxErrors = new Map<string, SyntaxError[]>();
	const diagnostics = new Map<string, Diagnostic[]>();

	// Parse errors, in the person's text; echoes of an earlier error dropped.
	const byUnit = new Map<string, TkFinding[]>();
	for (const f of parse) {
		if (f.stage !== 'parse') continue;
		const list = byUnit.get(f.unit) ?? [];
		list.push(f);
		byUnit.set(f.unit, list);
	}
	const broken = new Set<string>();
	for (const [path, findings] of byUnit) {
		const unit = units.get(path);
		if (!unit) continue;
		broken.add(path);
		findings.sort((a, b) => a.line - b.line || a.col - b.col);
		const kept: SyntaxError[] = [];
		let lastLine = -Infinity;
		for (const f of findings) {
			if (f.line - lastLine > ECHO_LINES || f.line < lastLine)
				kept.push({ message: f.message, span: spanIn(unit, f, false) });
			lastLine = Math.max(lastLine, f.endLine);
		}
		syntaxErrors.set(path, kept);
	}

	// Names written in the files that don't parse: what a repair may have moved or dropped.
	const brokenWords = new Set<string>();
	for (const path of broken) {
		for (const word of words(units.get(path)!.original.text)) brokenWords.add(word);
	}

	let hidden = 0;
	for (const f of session) {
		const unit = units.get(f.unit);
		if (!unit) continue;
		if (broken.size && f.stage === 'referential' && followsFromRepair(f, unit, brokenWords)) {
			hidden++;
			continue;
		}
		const diagnostic: Diagnostic = {
			file: unit.path,
			span: spanIn(unit, f, true),
			severity: severityOf(f.severity),
			code: f.stage,
			message: f.message
		};
		const list = diagnostics.get(unit.path) ?? [];
		list.push(diagnostic);
		diagnostics.set(unit.path, list);
	}

	if (hidden) {
		const first = [...syntaxErrors.values()].flat()[0];
		if (first)
			first.message += ` (${hidden} follow-on ${hidden === 1 ? 'problem is' : 'problems are'} hidden until this is fixed)`;
	}
	return { syntaxErrors, diagnostics, hidden };
}

/** A finding's range in the person's text; `repaired` when it is in the session's text. */
function spanIn(unit: UnitInfo, f: TkFinding, repaired: boolean) {
	const index = repaired ? unit.repaired : unit.original;
	let start = index.byteOfLineCol(f.line, f.col);
	let end = index.byteOfLineCol(f.endLine, f.endCol);
	if (repaired && unit.repair) {
		start = unit.repair.toOriginal(start);
		end = unit.repair.toOriginal(end);
	}
	return unit.original.spanOfBytes(start, Math.max(start, end));
}

function severityOf(severity: string): Severity {
	return severity === 'error' ? 'error' : severity === 'warning' ? 'warning' : 'note';
}

/**
 * Whether an unresolved reference names something written in a broken file:
 * the name itself, or a name before it in its chain (`fc.motorControl.setPoint`
 * breaks when `fc`'s definition is in the broken file).
 */
function followsFromRepair(f: TkFinding, unit: UnitInfo, brokenWords: Set<string>): boolean {
	const match = /unresolved reference `([^`]+)`/.exec(f.message);
	if (!match) return false;
	const index = unit.repaired;
	const at = index.offsetOf(f.line, f.col, 'byte');
	// The whole reference as written: back over `a.b::'c d'.` from the reported name.
	let start = at;
	while (start > 0 && /[\w.:']/.test(index.text[start - 1]!)) start--;
	const written = index.text.slice(start, at) + match[1]!;
	return written
		.split(/::|\./)
		.map((segment) => segment.replace(/^'|'$/g, ''))
		.some((segment) => brokenWords.has(segment));
}

/** Identifiers and quoted names in a text. */
function words(text: string): Set<string> {
	const out = new Set<string>();
	for (const m of text.matchAll(/'((?:[^'\\]|\\.)*)'|[A-Za-z_][A-Za-z0-9_]*/g))
		out.add(m[1] ?? m[0]);
	return out;
}
