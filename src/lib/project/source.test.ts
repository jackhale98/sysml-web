import { describe, expect, it } from 'vitest';
import { excerpt, sliceBytes } from './source';

describe('sliceBytes', () => {
	it('slices by UTF-8 byte offsets', () => {
		const text = 'a °C b';
		// 'a ' is 2 bytes, '°' is 2 bytes, 'C' is 1.
		expect(sliceBytes(text, 2, 5)).toBe('°C');
	});
});

describe('excerpt', () => {
	it('aligns the first line with the rest and removes common indentation', () => {
		const text = 'requirement r {\n        doc /* x */\n    }';
		expect(excerpt(text, 5)).toBe('requirement r {\n    doc /* x */\n}');
	});
});
