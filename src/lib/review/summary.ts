/**
 * The semantic diff in plain language, grouped the way an engineer reads a
 * change: what it does to the requirement checks and budgets first, then
 * Requirements, Design, Behaviour, Verification, Risk and Other. Names and
 * values are marked with backticks (the review list sets them in code
 * type); the commit message and pull request text use the same sentences.
 */
import { CATEGORY_ORDER } from './semantic';
import type {
	Category,
	ElementChange,
	Location,
	ModelDiff,
	PropertyChange,
	RelationChange,
	VerdictChange
} from './types';

export type Tone =
	'added' | 'removed' | 'changed' | 'renamed' | 'moved' | 'fails' | 'meets' | 'impact';

export interface ReviewItem {
	/** Unique in the summary. */
	key: string;
	tone: Tone;
	/** A word for the change, so it never rests on colour alone. */
	badge: string;
	/** One sentence; names and values in backticks. */
	text: string;
	/** More lines: the other properties that changed, what came with an addition. */
	details: string[];
	/** The element to select (an id in the new version), when it is there. */
	target: string | null;
	/** Where it is written now and where it was (for the text snippet). */
	after: Location | null;
	before: Location | null;
	/** The element's id before (removed elements are marked by it). */
	beforeId: string | null;
	/** A short imperative phrase for a commit message. */
	phrase: string;
}

export interface ReviewGroup {
	category: Category;
	title: string;
	items: ReviewItem[];
}

export interface ReviewSummary {
	/** Verdicts, budgets and computed values that changed. */
	impact: ReviewItem[];
	groups: ReviewGroup[];
	counts: { added: number; removed: number; changed: number; failing: number };
	/** Nothing changed in the model (the text may still have: comments, layout). */
	empty: boolean;
}

export const CATEGORY_TITLES: Record<Category, string> = {
	requirements: 'Requirements',
	design: 'Design',
	behaviour: 'Behaviour',
	verification: 'Verification',
	risk: 'Risk',
	other: 'Other'
};

const KIND_WORDS: Record<string, string> = {
	use_case: 'use case',
	join_node: 'join',
	merge_node: 'merge',
	fork_node: 'fork',
	decision_node: 'decision',
	enum: 'enumeration'
};

/** `part`, `part definition`, `requirement`, `use case`. */
export function kindWord(kind: string, isDefinition: boolean): string {
	const word = KIND_WORDS[kind] ?? kind.replace(/_/g, ' ');
	return isDefinition && kind !== 'package' ? `${word} definition` : word;
}

const code = (text: string) => `\`${text.replace(/`/g, "'")}\``;

/** How a requirement is named in a sentence: `SYS-011` ‘Noise at night’. */
function named(label: string, title: string | null, shortName: string | null): string {
	return shortName && title && title !== label ? `${code(label)} ‘${title}’` : code(label);
}

export function summarize(diff: ModelDiff): ReviewSummary {
	const impact: ReviewItem[] = [
		...diff.verdicts.map(verdictItem),
		...diff.budgets.map((b, i): ReviewItem => {
			const text =
				b.before && b.after
					? `${b.title}: ${code(b.root)} adds up to ${code(b.after)} (was ${b.before})`
					: b.after
						? `New ${b.title.toLowerCase()}: ${code(b.root)} adds up to ${code(b.after)}`
						: `${b.title} is gone (it added up to ${b.before})`;
			return item(`budget:${i}`, 'impact', 'Budget', text, {
				phrase: `${b.title}: ${b.after ?? 'removed'}`
			});
		}),
		...diff.values.map((v): ReviewItem =>
			item(
				`value:${v.id}`,
				'impact',
				'Value',
				`${code(v.label)} is now ${code(v.after)} (was ${v.before})`,
				{
					target: v.id,
					after: v.at,
					phrase: `${v.label} now ${v.after}`
				}
			)
		)
	];

	const byCategory = new Map<Category, ReviewItem[]>();
	const add = (category: Category, it: ReviewItem) =>
		byCategory.set(category, [...(byCategory.get(category) ?? []), it]);
	diff.elements.forEach((c, i) => add(c.category, elementItem(c, i)));
	diff.relations.forEach((r, i) => add(r.category, relationItem(r, i)));
	const groups = CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((category) => ({
		category,
		title: CATEGORY_TITLES[category],
		items: byCategory.get(category)!
	}));

	const all = groups.flatMap((g) => g.items);
	return {
		impact,
		groups,
		counts: {
			added: all.filter((i) => i.tone === 'added').length,
			removed: all.filter((i) => i.tone === 'removed').length,
			changed: all.filter((i) => i.tone !== 'added' && i.tone !== 'removed').length,
			failing: diff.verdicts.filter((v) => v.after === 'violated' && v.before !== 'violated').length
		},
		empty: !all.length && !impact.length
	};
}

function item(
	key: string,
	tone: Tone,
	badge: string,
	text: string,
	more: Partial<Omit<ReviewItem, 'key' | 'tone' | 'badge' | 'text'>> = {}
): ReviewItem {
	return {
		key,
		tone,
		badge,
		text,
		details: [],
		target: null,
		after: null,
		before: null,
		beforeId: null,
		phrase: text.replace(/`/g, ''),
		...more
	};
}

function verdictItem(v: VerdictChange, i: number): ReviewItem {
	const requirement = named(v.label, v.title, v.title ? v.label : null);
	const who = v.subject ?? v.by;
	const because = (reason: string | null) => (reason ? ` (${reason})` : '');
	let tone: Tone = 'impact';
	let badge: string;
	let text: string;
	let phrase: string;
	if (v.before === v.after) {
		text = `${requirement} is still ${v.after === 'satisfied' ? 'met' : v.after === 'violated' ? 'not met' : 'undecided'}; the margin went from ${v.marginBefore ?? 'none'} to ${code(v.marginAfter ?? 'none')}`;
		badge = 'Margin';
		phrase = `${v.label} margin now ${v.marginAfter ?? 'none'}`;
	} else if (v.after === 'violated') {
		tone = 'fails';
		badge = 'Now fails';
		text = who
			? `${code(who)} now violates ${requirement}${because(v.afterReason)}`
			: `${requirement} is no longer met${because(v.afterReason)}`;
		if (v.before === null)
			text = `${who ? code(who) : 'The design'} doesn't meet the new requirement ${requirement}${because(v.afterReason)}`;
		phrase = `${v.label} now fails`;
	} else if (v.after === 'satisfied') {
		tone = 'meets';
		badge = 'Now met';
		text = who
			? `${code(who)} now meets ${requirement}${because(v.afterReason)}`
			: `${requirement} is now met${because(v.afterReason)}`;
		phrase = `${v.label} now met`;
	} else if (v.after === 'undecided') {
		badge = 'Undecided';
		text = `${requirement} can no longer be checked (it was ${v.before === 'satisfied' ? 'met' : 'not met'})`;
		phrase = `${v.label} no longer checked`;
	} else {
		badge = 'Check';
		text = `${requirement} is no longer checked`;
		phrase = `${v.label} no longer checked`;
	}
	return item(`verdict:${i}`, tone, badge, text, {
		target: v.requirementId,
		after: v.at,
		phrase
	});
}

/** A property as people call it. */
export function propertyWord(property: string): string {
	if (property.startsWith('metadata:')) {
		const [type, field] = property.slice('metadata:'.length).split('.');
		const words = (field ?? type ?? '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
		return /^Fmea/.test(type ?? '') ? `FMEA ${words}` : words;
	}
	return (
		{
			shortName: 'ID',
			type: 'type',
			multiplicity: 'multiplicity',
			value: 'value',
			constraint: 'constraint',
			specializes: 'specializes',
			redefines: 'redefines',
			direction: 'direction',
			abstract: 'abstract',
			exposes: 'shows',
			filters: 'filter',
			doc: 'description',
			comments: 'comment',
			kind: 'kind'
		}[property] ?? property
	);
}

const shorten = (text: string, max = 80) =>
	text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** One property change as a phrase: `value 120 g → 190 g`. */
export function propertyPhrase(p: PropertyChange): string {
	const word = propertyWord(p.property);
	if (p.property === 'abstract') return p.after ? 'now abstract' : 'no longer abstract';
	if (p.property === 'derived' || p.property === 'readonly')
		return p.after ? `now ${p.property}` : `no longer ${p.property}`;
	if (p.property === 'valueKind') {
		const kind = (k: string | null) => (k === 'default' ? 'a default' : 'an initial value');
		return p.after ? `value now ${kind(p.after)}` : `value no longer ${kind(p.before)}`;
	}
	if (p.property === 'doc' || p.property === 'comments')
		return p.before && p.after ? `${word} reworded` : p.after ? `${word} added` : `${word} removed`;
	if (p.before === null) return `${word} set to ${code(shorten(p.after ?? ''))}`;
	if (p.after === null) return `${word} removed (was ${shorten(p.before)})`;
	return `${word} ${shorten(p.before, 60)} → ${code(shorten(p.after, 60))}`;
}

function elementItem(c: ElementChange, i: number): ReviewItem {
	const side = c.after ?? c.before!;
	const kind = kindWord(c.kind, c.isDefinition);
	const name = named(side.label, side.title, c.shortName);
	const common = {
		target: c.after?.id ?? null,
		after: c.after ?? null,
		before: c.before ?? null,
		beforeId: c.before?.id ?? null
	};
	const membersLine = (verb: string) =>
		c.members.length
			? [
					`${verb} ${c.members.length === 1 ? 'it' : `them`}: ${c.members.slice(0, 8).join(', ')}${c.members.length > 8 ? ` and ${c.members.length - 8} more` : ''}`
				]
			: [];
	switch (c.change) {
		case 'added':
			return item(
				`element:${i}`,
				'added',
				'Added',
				`Added ${kind} ${name}${c.after?.owner && !side.label.includes('.') ? ` to ${code(c.after.owner)}` : ''}`,
				{
					...common,
					details: membersLine('With'),
					phrase: `Add ${kind} ${side.label}`
				}
			);
		case 'removed':
			return item(
				`element:${i}`,
				'removed',
				'Removed',
				`Removed ${kind} ${name}${c.before?.owner && !side.label.includes('.') ? ` from ${code(c.before.owner)}` : ''}`,
				{
					...common,
					details: membersLine('With'),
					phrase: `Remove ${kind} ${side.label}`
				}
			);
		case 'renamed':
			return item(
				`element:${i}`,
				'renamed',
				'Renamed',
				`Renamed ${kind} ${code(c.before!.label)} to ${code(c.after!.title)}${c.before!.owner !== c.after!.owner && c.after!.owner ? ` and moved it to ${code(c.after!.owner)}` : ''}`,
				{
					...common,
					details: c.properties.map(propertyPhrase),
					phrase: `Rename ${c.before!.label} to ${c.after!.title}`
				}
			);
		case 'moved': {
			const ownerMoved = c.before!.owner !== c.after!.owner;
			const text = ownerMoved
				? `Moved ${kind} ${name} from ${code(c.before!.owner ?? 'the top')} to ${code(c.after!.owner ?? 'the top')}`
				: `Moved ${kind} ${name} to the file ${code(c.after!.path)}`;
			return item(`element:${i}`, 'moved', 'Moved', text, {
				...common,
				details: c.properties.map(propertyPhrase),
				phrase: ownerMoved
					? `Move ${c.after!.label} to ${c.after!.owner ?? 'the top'}`
					: `Move ${c.after!.label} to ${c.after!.path}`
			});
		}
		default: {
			const [first, ...rest] = c.properties;
			const fmea = c.properties.every((p) => /^metadata:Fmea/.test(p.property));
			const subject = fmea ? `FMEA of ${name}` : name;
			if (first && !rest.length) {
				const text =
					first.property === 'value' && first.before !== null && first.after !== null
						? `${subject} changed ${shorten(first.before, 60)} → ${code(shorten(first.after, 60))}`
						: `${subject}: ${fmea ? propertyPhrase(first).replace(/^FMEA /, '') : propertyPhrase(first)}`;
				return item(`element:${i}`, 'changed', 'Changed', text, {
					...common,
					details: first.property === 'doc' ? docDetails(first) : [],
					phrase:
						first.property === 'value' && first.after !== null
							? `Set ${side.label} to ${first.after}`
							: `Update ${propertyWord(first.property)} of ${side.label}`
				});
			}
			return item(
				`element:${i}`,
				'changed',
				'Changed',
				`Changed ${subject}: ${c.properties.length} ${c.properties.length === 1 ? 'property' : 'properties'}`,
				{
					...common,
					details: c.properties.map((p) =>
						fmea ? propertyPhrase(p).replace(/^FMEA /, '') : propertyPhrase(p)
					),
					phrase: `Update ${side.label}`
				}
			);
		}
	}
}

function docDetails(p: PropertyChange): string[] {
	return [
		...(p.before ? [`Was: ${shorten(p.before, 160)}`] : []),
		...(p.after ? [`Now: ${shorten(p.after, 160)}`] : [])
	];
}

const RELATION_WORDS: Record<
	RelationChange['relation'],
	{ added: string; removed: string; noun: string }
> = {
	satisfy: { added: 'New claim', removed: 'Dropped the claim', noun: 'satisfy claim' },
	verify: { added: 'Now verifies', removed: 'No longer verifies', noun: 'verification' },
	allocate: { added: 'Allocated', removed: 'Removed the allocation', noun: 'allocation' },
	connect: { added: 'Connected', removed: 'Removed the connection', noun: 'connection' },
	interface: { added: 'Added the interface', removed: 'Removed the interface', noun: 'interface' },
	flow: { added: 'Added the flow', removed: 'Removed the flow', noun: 'flow' },
	bind: { added: 'Bound', removed: 'Removed the binding', noun: 'binding' },
	derive: { added: 'Derived', removed: 'No longer derived:', noun: 'derivation' },
	succession: { added: 'Added the step', removed: 'Removed the step', noun: 'step' },
	transition: {
		added: 'Added the transition',
		removed: 'Removed the transition',
		noun: 'transition'
	},
	other: { added: 'Added', removed: 'Removed', noun: 'statement' }
};

function relationItem(r: RelationChange, i: number): ReviewItem {
	const words = RELATION_WORDS[r.relation];
	const where = r.owner ? ` in ${code(r.owner)}` : '';
	let text: string;
	if (r.relation === 'satisfy')
		text =
			r.change === 'added'
				? `New claim: ${satisfyText(r.text)}`
				: `Dropped the claim: ${satisfyText(r.text)}`;
	else if (r.relation === 'verify')
		text = `${code(r.owner ?? 'A verification case')} ${r.change === 'added' ? 'now verifies' : 'no longer verifies'} ${code(r.text)}`;
	else if (r.relation === 'derive')
		text = `${r.change === 'added' ? 'Derived' : 'No longer derived:'} ${derivedText(r.text)}`;
	else text = `${r.change === 'added' ? words.added : words.removed} ${code(r.text)}${where}`;
	return item(`relation:${i}`, r.change, r.change === 'added' ? 'Added' : 'Removed', text, {
		target: r.ownerId ?? (r.refs[0] && r.change === 'added' ? r.refs[0] : null),
		after: r.change === 'added' ? r.at : null,
		before: r.change === 'removed' ? r.at : null,
		phrase: `${r.change === 'added' ? 'Add' : 'Remove'} ${words.noun} ${r.text}`
	});
}

/** `SYS-005 ‘Ingress protection’ by drone.body` → `drone.body` satisfies `SYS-005` ‘Ingress protection’. */
function satisfyText(text: string): string {
	const match = /^(\S+)(?: (‘[^’]*’))? by (.+)$/.exec(text);
	if (!match) return code(text);
	return `${code(match[3]!)} satisfies ${code(match[1]!)}${match[2] ? ` ${match[2]}` : ''}`;
}

function derivedText(text: string): string {
	const match = /^(.+) from (.+)$/.exec(text);
	return match ? `${code(match[1]!)} from ${code(match[2]!)}` : code(text);
}

/** A commit message: a headline of the main changes, then every change on its own line. */
export function commitMessage(summary: ReviewSummary, max = 72): string {
	const items = summary.groups.flatMap((g) => g.items);
	if (!items.length && !summary.impact.length) return '';
	const phrases = items.map((i) => i.phrase);
	let headline = phrases[0] ?? 'Update the model';
	for (const p of phrases.slice(1)) {
		const next = `${headline}; ${lowerFirst(p)}`;
		if (next.length > max) break;
		headline = next;
	}
	const rest = items.length - headline.split('; ').length;
	if (rest > 0 && headline.length + 12 <= max) headline += ` and ${rest} more`;
	const lines = [
		...summary.impact.filter((i) => i.tone === 'fails' || i.tone === 'meets').map((i) => i.text),
		...items.map((i) => i.text)
	].map((t) => `- ${t.replace(/`/g, '')}`);
	return [
		headline,
		'',
		...lines.slice(0, 30),
		...(lines.length > 30 ? [`- … and ${lines.length - 30} more`] : [])
	].join('\n');
}

/** A pull request description: the change summary in Markdown, impact first. */
export function markdownSummary(summary: ReviewSummary): string {
	const out: string[] = [];
	if (summary.impact.length) {
		out.push('### Impact', '', ...summary.impact.map((i) => `- ${i.text}`), '');
	}
	for (const group of summary.groups) {
		out.push(`### ${group.title}`, '');
		for (const i of group.items) {
			out.push(`- **${i.badge}:** ${i.text}`);
			for (const d of i.details) out.push(`  - ${d}`);
		}
		out.push('');
	}
	return out.join('\n').trim();
}

const lowerFirst = (text: string) =>
	/^[A-Z][a-z]/.test(text) ? text[0]!.toLowerCase() + text.slice(1) : text;
