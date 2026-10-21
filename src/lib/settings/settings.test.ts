import { describe, expect, it } from 'vitest';
import { DEFAULTS, parseSettings } from './settings.svelte.ts';

describe('settings', () => {
	it('falls back to defaults for missing or broken storage', () => {
		expect(parseSettings(null)).toEqual(DEFAULTS);
		expect(parseSettings('{not json')).toEqual(DEFAULTS);
	});

	it('keeps valid values and replaces invalid ones one by one', () => {
		expect(
			parseSettings(
				JSON.stringify({
					density: 'compact',
					motion: 'loud',
					editorFontSize: 99,
					lineWrapping: true,
					lineNumbers: 'yes',
					phoneStart: 'diagram'
				})
			)
		).toEqual({
			...DEFAULTS,
			density: 'compact',
			lineWrapping: true,
			phoneStart: 'diagram'
		});
		expect(parseSettings(JSON.stringify({ editorFontSize: 15.4 })).editorFontSize).toBe(15);
	});
});
