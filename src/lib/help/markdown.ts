/**
 * The help as Markdown, for `docs/user-guide.md`: the same words as the app,
 * so the two never drift apart (`guide.test.ts` checks the file is current).
 */
import { HELP, type Block, type HelpTopic } from './content.ts';

function block(b: Block): string {
	if (typeof b === 'string') return b;
	if ('list' in b) return b.list.map((item) => `- ${item}`).join('\n');
	if ('steps' in b) return b.steps.map((item, i) => `${i + 1}. ${item}`).join('\n');
	if ('code' in b) return '```sysml\n' + b.code + '\n```';
	if ('keys' in b)
		return [
			'| Keys | What they do |',
			'| --- | --- |',
			...b.keys.map(([keys, does]) => `| <kbd>${keys}</kbd> | ${does} |`)
		].join('\n');
	return [`> **${b.label}**: ${b.summary}`, ...(b.analogy ? [`>`, `> _${b.analogy}_`] : [])].join(
		'\n'
	);
}

function topic(t: HelpTopic): string {
	const parts = [`### ${t.title}`, ...t.blocks.map(block)];
	if (t.action) parts.push(`In the app: **${t.action.label}**.`);
	return parts.join('\n\n');
}

export function userGuideMarkdown(): string {
	const out = [
		'# Fairtide user guide',
		'',
		'<!-- Made from src/lib/help/content.ts, the help in the app: change it there, then run',
		'     UPDATE_USER_GUIDE=1 npx vitest run src/lib/help -->',
		'',
		'Fairtide is a workbench for SysML v2 models, in the browser, on a phone or a computer. This is',
		'the help that comes with it: open it in the app with **Help** in the project menu, by pressing',
		'<kbd>?</kbd>, or by typing `?` in search.',
		'',
		'## Contents',
		'',
		...HELP.map((s) => `- [${s.title}](#${anchor(s.title)})`),
		''
	];
	for (const section of HELP) {
		out.push(`## ${section.title}`, '', section.intro, '');
		for (const t of section.topics) out.push(topic(t), '');
	}
	return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** GitHub's heading anchors: lower case, punctuation dropped, spaces as dashes. */
export function anchor(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s-]/gu, '')
		.trim()
		.replace(/\s/g, '-');
}
