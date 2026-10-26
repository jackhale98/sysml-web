import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { fileLineBreaks, fileText, toDoc, toFile } from './lineBreaks';

const stateOf = (text: string, lineBreak: '\n' | '\r\n') =>
	EditorState.create({ doc: text, extensions: fileLineBreaks(lineBreak) });

describe('the editor keeps a file’s line endings', () => {
	it('gives back the file’s text, byte for byte', () => {
		for (const text of [
			'package P {\r\n    part a;\r\n}\r\n',
			'package P {\n\tpart a;\n}',
			// Mixed: the stray Unix line ending stays in its line.
			'package P {\r\n    part a;\n    part b;\r\n}\r\n'
		]) {
			const state = stateOf(text, text.includes('\r\n') ? '\r\n' : '\n');
			expect(fileText(state)).toBe(text);
		}
	});

	it('Enter and typed line breaks write the file’s line ending', () => {
		const state = stateOf('a;\r\nb;\r\n', '\r\n');
		const typed = state.update(state.replaceSelection(state.toText('x;\r\ny;'))).state;
		expect(fileText(typed)).toBe('x;\r\ny;a;\r\nb;\r\n');
		expect(typed.lineBreak).toBe('\r\n');
	});

	it('maps offsets in the file’s text to editor positions and back', () => {
		const text = 'ab\r\ncd\r\n\r\nef';
		const state = stateOf(text, '\r\n');
		for (const word of ['ab', 'cd', 'ef']) {
			const offset = text.indexOf(word);
			const pos = toDoc(state, offset);
			expect(state.sliceDoc(pos, pos + 2)).toBe(word);
			expect(toFile(state, pos)).toBe(offset);
		}
		// Between `\r` and `\n`: the end of the line.
		expect(toDoc(state, 3)).toBe(2);
		expect(toDoc(state, text.length)).toBe(state.doc.length);
		// Unix files: the same numbers.
		const unix = stateOf('ab\ncd', '\n');
		expect(toDoc(unix, 4)).toBe(4);
		expect(toFile(unix, 4)).toBe(4);
	});
});
