import { describe, expect, it } from 'vitest';
import { toSnippet } from './language.ts';

describe('toSnippet', () => {
	it('turns LSP placeholders into CodeMirror fields', () => {
		expect(toSnippet('part def ${1:Name} {\n\t$0\n}')).toBe('part def ${1:Name} {\n\t${}\n}');
		expect(toSnippet('connect $1 to $2;')).toBe('connect ${1} to ${2};');
	});
});
