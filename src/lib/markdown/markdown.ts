/**
 * A small Markdown reader for project documents (README, TOUR): headings,
 * paragraphs, lists, block quotes and code blocks with inline code,
 * emphasis and links. It produces tokens, not HTML, so nothing in a
 * document is ever injected into the page as markup.
 */

export type Inline =
	| { type: 'text'; text: string }
	| { type: 'code'; text: string }
	| { type: 'strong'; children: Inline[] }
	| { type: 'em'; children: Inline[] }
	| { type: 'link'; href: string; children: Inline[] };

export type Block =
	| { type: 'heading'; level: number; children: Inline[] }
	| { type: 'paragraph'; children: Inline[] }
	| { type: 'list'; ordered: boolean; items: Inline[][] }
	| { type: 'quote'; children: Inline[] }
	| { type: 'code'; lang: string; text: string }
	| { type: 'rule' };

export function parseBlocks(source: string): Block[] {
	const lines = source.replace(/\r\n?/g, '\n').split('\n');
	const blocks: Block[] = [];
	let i = 0;
	const isListItem = (line: string) => /^\s*([-*+]|\d+[.)])\s+/.test(line);
	while (i < lines.length) {
		const line = lines[i]!;
		if (!line.trim()) {
			i++;
			continue;
		}
		const fence = /^\s*(```|~~~)(.*)$/.exec(line);
		if (fence) {
			const body: string[] = [];
			i++;
			while (i < lines.length && !lines[i]!.trim().startsWith(fence[1]!)) body.push(lines[i++]!);
			i++;
			blocks.push({ type: 'code', lang: fence[2]!.trim(), text: body.join('\n') });
			continue;
		}
		const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
		if (heading) {
			blocks.push({
				type: 'heading',
				level: heading[1]!.length,
				children: parseInline(heading[2]!)
			});
			i++;
			continue;
		}
		if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
			blocks.push({ type: 'rule' });
			i++;
			continue;
		}
		if (isListItem(line)) {
			const ordered = /^\s*\d/.test(line);
			const items: string[] = [];
			while (i < lines.length && lines[i]!.trim()) {
				const current = lines[i]!;
				if (isListItem(current)) items.push(current.replace(/^\s*([-*+]|\d+[.)])\s+/, ''));
				else items[items.length - 1] += ' ' + current.trim();
				i++;
			}
			blocks.push({ type: 'list', ordered, items: items.map(parseInline) });
			continue;
		}
		const paragraph: string[] = [];
		const quote = line.startsWith('>');
		while (
			i < lines.length &&
			lines[i]!.trim() &&
			!/^(#{1,6}\s|\s*```|\s*~~~)/.test(lines[i]!) &&
			!isListItem(lines[i]!) &&
			lines[i]!.startsWith('>') === quote
		) {
			paragraph.push(quote ? lines[i]!.replace(/^>\s?/, '') : lines[i]!.trim());
			i++;
		}
		const children = parseInline(paragraph.join(' '));
		blocks.push(quote ? { type: 'quote', children } : { type: 'paragraph', children });
	}
	return blocks;
}

export function parseInline(text: string): Inline[] {
	const out: Inline[] = [];
	let rest = text;
	const pattern =
		/`([^`]+)`|\*\*(.+?)\*\*|__(.+?)__|\*([^*\s][^*]*?)\*|_([^_\s][^_]*?)_|\[([^\]]+)\]\(([^)\s]+)\)/;
	while (rest) {
		const m = pattern.exec(rest);
		if (!m) {
			out.push({ type: 'text', text: rest });
			break;
		}
		if (m.index > 0) out.push({ type: 'text', text: rest.slice(0, m.index) });
		if (m[1] !== undefined) out.push({ type: 'code', text: m[1] });
		else if (m[2] !== undefined || m[3] !== undefined)
			out.push({ type: 'strong', children: parseInline((m[2] ?? m[3])!) });
		else if (m[4] !== undefined || m[5] !== undefined)
			out.push({ type: 'em', children: parseInline((m[4] ?? m[5])!) });
		else out.push({ type: 'link', href: m[7]!, children: parseInline(m[6]!) });
		rest = rest.slice(m.index + m[0].length);
	}
	return out;
}
