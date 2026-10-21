import { describe, expect, it } from 'vitest';
import {
	findStatement,
	headerEnd,
	insertIntoBody,
	matchBrace,
	removeStatement
} from './textpatch.ts';

const span = (text: string, needle: string): [number, number] => {
	const from = text.indexOf(needle);
	return [from, from + needle.length];
};

describe('braces and headers', () => {
	it('skips comments and quoted names', () => {
		const text = "part def A { doc /* } */ attribute 'x}' : B; }";
		expect(matchBrace(text, text.indexOf('{'))).toBe(text.length - 1);
		expect(headerEnd("part def 'a;b' :> C { }", 0)).toEqual({ index: 20, char: '{' });
	});
});

describe('insertIntoBody', () => {
	it('adds a member before the closing brace with the body indentation', () => {
		const text = 'package P {\n    part def A {\n        attribute x;\n    }\n}\n';
		const [from, to] = span(text, 'part def A {\n        attribute x;\n    }');
		const out = insertIntoBody(text, from, to, 'part b : B;')!;
		expect(out.text).toBe(
			'package P {\n    part def A {\n        attribute x;\n        part b : B;\n    }\n}\n'
		);
		expect(out.text.slice(out.from, out.to)).toBe('part b : B;');
	});

	it('gives a declaration without a body one', () => {
		const text = 'package P {\n    part drone : D;\n}\n';
		const [from, to] = span(text, 'part drone : D;');
		const out = insertIntoBody(text, from, to, 'part b : B;')!;
		expect(out.text).toBe('package P {\n    part drone : D {\n        part b : B;\n    }\n}\n');
		expect(out.text.slice(out.from, out.to)).toBe('part b : B;');
	});

	it('keeps a short one-line body on one line', () => {
		const text = "    objective { verify 'A'; }\n";
		const [from, to] = span(text, "objective { verify 'A'; }");
		const out = insertIntoBody(text, from, to, "verify 'B';")!;
		expect(out.text).toBe("    objective { verify 'A'; verify 'B'; }\n");
		expect(out.text.slice(out.from, out.to)).toBe("verify 'B';");
	});

	it('opens up a one-line body that would get too long', () => {
		const text = "    objective { verify 'A very long requirement name that goes on and on'; }\n";
		const [from, to] = span(text, text.trim());
		const out = insertIntoBody(text, from, to, "verify 'Another long requirement name';")!;
		expect(out.text).toBe(
			"    objective {\n        verify 'A very long requirement name that goes on and on';\n        verify 'Another long requirement name';\n    }\n"
		);
	});
});

describe('removeStatement', () => {
	it('removes the whole line when the statement is alone on it', () => {
		const text = 'package P {\n    satisfy R by x;\n    satisfy S by y;\n}\n';
		const [from, to] = span(text, 'satisfy R by x;');
		expect(removeStatement(text, from, to)).toBe('package P {\n    satisfy S by y;\n}\n');
	});

	it('removes a statement inside a line', () => {
		const text = "objective { verify 'A'; verify 'B'; }";
		const [from, to] = span(text, "verify 'A';");
		expect(removeStatement(text, from, to)).toBe("objective { verify 'B'; }");
	});
});

describe('findStatement', () => {
	it('ignores matches inside comments', () => {
		const text = '// connect a.p to b.q;\nconnect a.p to b.q;';
		expect(findStatement(text, /connect\s+a\.p\s+to\s+b\.q;/)).toEqual([23, 42]);
	});
});
