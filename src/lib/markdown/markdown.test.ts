import { describe, expect, it } from 'vitest';
import { parseBlocks, parseInline } from './markdown.ts';

describe('markdown', () => {
	it('reads headings, paragraphs, lists and code', () => {
		const blocks = parseBlocks(
			'# Title\n\nSome *text*\nwrapped.\n\n- one\n- two\n  more\n\n```sysml\npart def A;\n```\n'
		);
		expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'code']);
		expect(blocks[2]).toMatchObject({ items: [[{ text: 'one' }], [{ text: 'two more' }]] });
		expect(blocks[3]).toEqual({ type: 'code', lang: 'sysml', text: 'part def A;' });
	});

	it('reads inline code, strong emphasis and links', () => {
		expect(parseInline('Open **`A::b`** or [docs](https://x.org).')).toEqual([
			{ type: 'text', text: 'Open ' },
			{ type: 'strong', children: [{ type: 'code', text: 'A::b' }] },
			{ type: 'text', text: ' or ' },
			{ type: 'link', href: 'https://x.org', children: [{ type: 'text', text: 'docs' }] },
			{ type: 'text', text: '.' }
		]);
	});
});
