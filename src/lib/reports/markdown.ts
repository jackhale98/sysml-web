/** A report as Markdown (GitHub-flavoured tables), for wikis, pull requests and email. */
import {
	plain,
	type Block,
	type ReportDocument,
	type Section,
	type Text,
	type TreeItem
} from './document.ts';

function inline(text: Text): string {
	return text
		.map((run) => (run.code ? '`' + run.text.replace(/`/g, "'") + '`' : escape(run.text)))
		.join('');
}

/** Escape what Markdown would read as formatting at the start of a line or inline. */
function escape(text: string): string {
	return text.replace(/([\\*_[\]<>|`])/g, '\\$1').replace(/\s*\n\s*/g, ' ');
}

function cell(text: Text): string {
	return inline(text).trim() || ' ';
}

function tree(items: TreeItem[], depth: number): string[] {
	return items.flatMap((item) => [
		`${'  '.repeat(depth)}- ${inline(item.text)}`,
		...tree(item.children, depth + 1)
	]);
}

function block(b: Block): string {
	switch (b.type) {
		case 'paragraph':
			return b.muted ? `*${inline(b.text)}*` : inline(b.text);
		case 'statement':
			return `> ${inline(b.text)}`;
		case 'facts':
			return b.facts.map((f) => `- **${escape(f.label)}:** ${inline(f.value)}`).join('\n');
		case 'table': {
			const head = `| ${b.columns.map(escape).join(' | ')} |`;
			const rule = `| ${b.columns.map((_, i) => (b.numeric?.[i] ? '---:' : '---')).join(' | ')} |`;
			const rows = b.rows.map((r) => `| ${r.map(cell).join(' | ')} |`);
			return [...(b.caption ? [`**${escape(b.caption)}**`, ''] : []), head, rule, ...rows].join(
				'\n'
			);
		}
		case 'metrics':
			return b.items
				.map(
					(m) =>
						`- **${escape(m.label)}:** ${escape(m.value)}${m.detail ? ` (${escape(m.detail)})` : ''}`
				)
				.join('\n');
		case 'tree':
			return tree(b.items, 0).join('\n');
		case 'note':
			return `**${escape(b.label)}:** ${inline(b.text)}`;
		case 'diagram':
			return `*${escape(b.caption)}: the diagram is in the HTML and printed versions.*`;
	}
}

function section(s: Section, depth: number): string[] {
	const hashes = '#'.repeat(Math.min(6, depth + 1));
	const tag = s.tag ? `${escape(s.tag)} ` : '';
	const badge = s.badge ? ` (${escape(s.badge.text)})` : '';
	return [
		`${hashes} ${s.number} ${tag}${escape(s.title)}${badge}`,
		...s.blocks.map(block),
		...s.sections.flatMap((child) => section(child, depth + 1))
	];
}

function contents(sections: Section[], depth: number): string[] {
	return sections.flatMap((s) => [
		`${'  '.repeat(depth)}- ${s.number} ${s.tag ? `${escape(s.tag)} ` : ''}${escape(s.title)}`,
		...(depth < 1 ? contents(s.sections, depth + 1) : [])
	]);
}

export function toMarkdown(doc: ReportDocument): string {
	const details = [
		doc.number && `Document ${doc.number}`,
		doc.version && `Version ${doc.version}`,
		doc.status,
		doc.author && `Author ${doc.author}`,
		doc.date
	].filter(Boolean) as string[];
	const parts = [
		`# ${escape(doc.title)}`,
		`*${escape(doc.kindLabel)} · ${escape(doc.project)}*`,
		...(doc.description ? [escape(doc.description)] : []),
		details.map(escape).join(' · '),
		...(doc.summary.length
			? [
					doc.summary
						.map((s) => `**${escape(s.value)}** ${escape(s.label.toLowerCase())}`)
						.join(' · ')
				]
			: []),
		'## Contents',
		contents(doc.sections, 0).join('\n'),
		...doc.sections.flatMap((s) => section(s, 1))
	];
	return parts.filter((p) => p !== '').join('\n\n') + '\n';
}

/** A file name from a title: `Drone UAV specification` → `drone-uav-specification`. */
export function fileName(doc: ReportDocument, extension: string): string {
	const base = plain([{ text: doc.number ? `${doc.number} ${doc.title}` : doc.title }])
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
	return `${base || 'report'}.${extension}`;
}
