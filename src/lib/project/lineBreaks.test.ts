import { describe, expect, it } from 'vitest';
import { inLineBreaksOf, lineBreakOf, withLineBreak } from './lineBreaks';

describe('line endings', () => {
	it('a file’s line ending is the one most of its lines use', () => {
		expect(lineBreakOf('a\nb\n')).toBe('\n');
		expect(lineBreakOf('a\r\nb\r\n')).toBe('\r\n');
		expect(lineBreakOf('a\r\nb\r\nc\n')).toBe('\r\n');
		expect(lineBreakOf('a\rb\r')).toBe('\r');
		expect(lineBreakOf('one line')).toBe('\n');
	});

	it('text written into a file takes its line ending', () => {
		expect(withLineBreak('a\nb\r\nc\rd', '\r\n')).toBe('a\r\nb\r\nc\r\nd');
		const crlf = 'package P {\r\n    part a;\r\n}\r\n';
		const at = crlf.indexOf('}');
		expect(inLineBreaksOf(crlf, [{ from: at, to: at, insert: '    part b;\n' }])).toEqual([
			{ from: at, to: at, insert: '    part b;\r\n' }
		]);
		// Into a Unix file, Windows line endings become Unix ones.
		expect(inLineBreaksOf('a\nb\n', [{ from: 2, to: 2, insert: 'x\r\n' }])).toEqual([
			{ from: 2, to: 2, insert: 'x\n' }
		]);
	});

	it('a break that completes one already there is left as it is', () => {
		// `\r` + `\n…`: inserted between the source's `\r` and what follows it.
		const text = 'a;\r\nb;\r\n';
		const change = { from: 3, to: 4, insert: '\n  x;\r\n' };
		expect(inLineBreaksOf(text, [change])).toEqual([change]);
		// `…\r` + `\n`: the inserted `\r` and the source's `\n` end a line.
		const before = { from: 2, to: 3, insert: '\r\n  x;\r' };
		expect(inLineBreaksOf(text, [before])).toEqual([before]);
	});
});
