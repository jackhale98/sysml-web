/**
 * The editor keeps a file's line endings (`#lib/project/lineBreaks.ts`): the
 * document splits lines only at the file's own line ending, so the text it
 * gives back (`fileText`) is the file's, byte for byte, and Enter, paste and
 * drop write that line ending. A stray line ending of another kind (in a
 * file with mixed line endings) stays in its line, shown as a marker.
 *
 * A document position counts a line break as one character, the file's text
 * counts `\r\n` as two: positions the rest of the app gives (spans, edits,
 * the language service's answers) are offsets in the file's text, turned
 * into document positions with `toDoc`, and back with `toFile`.
 */
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, highlightSpecialChars } from '@codemirror/view';
import { withLineBreak, type LineBreak } from '#lib/project/lineBreaks.ts';

/** The editor's side of a file's line endings. */
export function fileLineBreaks(lineBreak: LineBreak): Extension {
	return [
		EditorState.lineSeparator.of(lineBreak),
		EditorView.clipboardInputFilter.of((text) => withLineBreak(text, lineBreak)),
		highlightSpecialChars({ specialChars: /[\r\n]/ })
	];
}

/** The file's text, with its own line endings. */
export function fileText(state: EditorState): string {
	return state.sliceDoc();
}

/** Characters a line break has more in the file than in the document. */
const extra = (state: EditorState) => state.lineBreak.length - 1;

/** A document position as an offset (UTF-16) in the file's text. */
export function toFile(state: EditorState, pos: number): number {
	const k = extra(state);
	return k ? pos + (state.doc.lineAt(pos).number - 1) * k : pos;
}

/** An offset (UTF-16) in the file's text as a document position. */
export function toDoc(state: EditorState, offset: number): number {
	const k = extra(state);
	if (!k) return Math.min(offset, state.doc.length);
	const { doc } = state;
	// The last line starting at or before the offset.
	let low = 1;
	let high = doc.lines;
	while (low < high) {
		const mid = (low + high + 1) >> 1;
		if (doc.line(mid).from + (mid - 1) * k <= offset) low = mid;
		else high = mid - 1;
	}
	const line = doc.line(low);
	return Math.min(Math.max(offset - (low - 1) * k, line.from), line.to);
}
