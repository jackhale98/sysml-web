import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUIDE_ACTIONS } from '#lib/workbench/guide.ts';
import { ALL_TOPICS, HELP, inlineParts, searchHelp, topicText } from './content.ts';
import { anchor, userGuideMarkdown } from './markdown.ts';

const GUIDE = resolve(import.meta.dirname, '../../../docs/user-guide.md');

describe('the help', () => {
	it('has the sections asked for, each topic once', () => {
		expect(HELP.map((s) => s.title)).toEqual([
			'Getting started',
			'Ideas in plain words',
			'How do I…',
			'Keyboard shortcuts',
			'Where’s my data?'
		]);
		const ids = ALL_TOPICS.map((t) => t.id);
		expect(new Set(ids).size).toBe(ids.length);
		const howTo = HELP.find((s) => s.id === 'how-do-i')!.topics.map((t) => t.title);
		expect(howTo).toEqual([
			'Add a part',
			'Connect ports',
			'Write a requirement',
			'Link a requirement to the design',
			'Record a test result',
			'Check a budget',
			'Compare options',
			'Analyse what can fail (FMEA)',
			'Log hazards and their controls',
			'See what depends on what (DSM)',
			'Check modelling conventions',
			'Draw a state machine',
			'Make a report',
			'Import from Excel',
			'Save to GitHub',
			'Mark a baseline (PDR, CDR…)',
			'Exchange models with other tools',
			'Install it on my phone',
			'Switch projects'
		]);
		// Every answer can be started from the help.
		for (const t of HELP.find((s) => s.id === 'how-do-i')!.topics)
			expect(t.action, t.id).toBeTruthy();
		for (const t of ALL_TOPICS)
			if (t.action) expect(GUIDE_ACTIONS, t.id).toContain(t.action.action);
	});

	it('explains ideas in plain words, glossing SysML’s own', () => {
		const all = ALL_TOPICS.map(topicText).join(' ');
		expect(all).not.toMatch(/redefinition|feature chain/i);
		// "Usage" is explained before it is used.
		const first = ALL_TOPICS.findIndex((t) => /\busage\b/i.test(topicText(t)));
		expect(ALL_TOPICS[first]?.id).toBe('definition-usage');
		expect(topicText(ALL_TOPICS[first]!)).toMatch(/usage is SysML’s word for/);
	});

	it('finds topics by their words, titles first', () => {
		expect(searchHelp('budget')[0]?.id).toBe('check-budget');
		expect(searchHelp('github').map((t) => t.id)).toContain('save-github');
		expect(searchHelp('kpar').map((t) => t.id)).toContain('keep-copy');
		expect(searchHelp('json')[0]?.id).toBe('exchange-models');
		expect(searchHelp('syson').map((t) => t.id)).toContain('exchange-models');
		expect(searchHelp('state machine')[0]?.id).toBe('concept-state-machine');
		expect(searchHelp('fmea')[0]?.id).toBe('fmea');
		expect(searchHelp('hazard')[0]?.id).toBe('hazards');
		expect(searchHelp('xyzzy')).toEqual([]);
		expect(searchHelp('')).toHaveLength(ALL_TOPICS.length);
	});

	it('reads bold and code inline', () => {
		expect(inlineParts('Choose **Add**, then `part a;` here')).toEqual([
			{ text: 'Choose ', kind: 'plain' },
			{ text: 'Add', kind: 'bold' },
			{ text: ', then ', kind: 'plain' },
			{ text: 'part a;', kind: 'code' },
			{ text: ' here', kind: 'plain' }
		]);
	});

	it('is in docs/user-guide.md, word for word', () => {
		const markdown = userGuideMarkdown();
		if (process.env.UPDATE_USER_GUIDE) writeFileSync(GUIDE, markdown);
		expect(existsSync(GUIDE)).toBe(true);
		expect(readFileSync(GUIDE, 'utf8')).toBe(markdown);
		expect(anchor('Where’s my data?')).toBe('wheres-my-data');
		expect(anchor('How do I…')).toBe('how-do-i');
	});
});
