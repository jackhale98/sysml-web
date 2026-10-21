import { describe, expect, it } from 'vitest';
import type { TkDropped } from './api';
import { RepairMap } from './repair';

const bytes = (s: string) => new TextEncoder().encode(s).length;
const at = (text: string, needle: string) => bytes(text.slice(0, text.indexOf(needle)));

function dropped(partial: Partial<TkDropped>): TkDropped {
	return {
		unit: 'a.sysml',
		start: 0,
		end: 0,
		line: 1,
		col: 1,
		endLine: 1,
		endCol: 1,
		text: '',
		inserted: '',
		linesRemoved: 0,
		wholeLines: false,
		message: '',
		...partial
	};
}

describe('RepairMap', () => {
	it('maps positions past removed whole lines back to the original text', () => {
		const original = 'package P {\n    part x : \n    part déf;\n}\n';
		const repaired = 'package P {\n    part déf;\n}\n';
		const map = RepairMap.build(original, repaired, [
			dropped({ line: 2, linesRemoved: 1, wholeLines: true, start: 16, end: 24 })
		]);
		expect(map.toOriginal(at(repaired, 'part déf'))).toBe(at(original, 'part déf'));
		expect(map.toOriginal(at(repaired, '}'))).toBe(at(original, '}'));
		expect(map.toOriginal(5)).toBe(5);
		expect(map.isRemoved(at(original, 'part x'))).toBe(true);
		expect(map.isRemoved(at(original, 'part déf'))).toBe(false);
	});

	it('maps appended closers to where they were appended', () => {
		const original = 'package P {\n    part def A {\n';
		const repaired = original + '}\n}\n';
		const map = RepairMap.build(original, repaired, [
			dropped({ start: bytes(original), end: bytes(original), inserted: '}\n}\n' })
		]);
		expect(map.toOriginal(bytes(repaired))).toBe(bytes(original));
		expect(map.toOriginal(at(original, 'part'))).toBe(at(original, 'part'));
	});

	it('falls back to a common start and end when the report does not match the text', () => {
		const original = 'abc XYZ def';
		const repaired = 'abc def';
		const map = RepairMap.build(original, repaired, []);
		expect(map.toOriginal(0)).toBe(0);
		expect(map.toOriginal(repaired.indexOf('def'))).toBe(original.indexOf('def'));
		expect(map.isRemoved(original.indexOf('XYZ'))).toBe(true);
	});
});
