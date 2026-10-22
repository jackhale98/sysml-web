import { describe, expect, it } from 'vitest';
import type { Analysis } from '../types';
import { AnalysisReceiver, AnalysisSender } from './delta';

const analysis = (file: string, message?: string) =>
	({
		model: { file, definitions: [], usages: [] },
		diagnostics: message ? [{ message }] : []
	}) as unknown as Analysis;

describe('analyses sent only when they changed', () => {
	const files = [
		{ path: 'a.sysml', text: 'a' },
		{ path: 'b.sysml', text: 'b' }
	];

	it('sends everything first, then only what changed, and the page puts the rest back', () => {
		const sender = new AnalysisSender();
		const receiver = new AnalysisReceiver();
		const first = [analysis('a.sysml'), analysis('b.sysml')];
		expect(sender.send(files, first)).toEqual(first);
		const received = receiver.receive(files, first);

		const next = [analysis('a.sysml'), analysis('b.sysml', 'unresolved')];
		const sent = sender.send(files, next);
		expect(sent).toEqual([null, next[1]]);
		const again = receiver.receive(files, sent);
		// The unchanged analysis is the very object the page already had.
		expect(again[0]).toBe(received[0]);
		expect(again[1]).toEqual(next[1]);
	});

	it('sends a file again after it left the project and came back', () => {
		const sender = new AnalysisSender();
		const one = [analysis('a.sysml')];
		sender.send(files.slice(0, 1), one);
		sender.send(files.slice(1), [analysis('b.sysml')]);
		expect(sender.send(files.slice(0, 1), one)).toEqual(one);
	});

	it('refuses to make up an analysis it never received', () => {
		expect(() => new AnalysisReceiver().receive(files.slice(0, 1), [null])).toThrow(/a.sysml/);
	});
});
