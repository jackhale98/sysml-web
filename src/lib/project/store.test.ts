/**
 * The stored project's format version. The fixture is a project as the
 * previous build kept it in IndexedDB (a "Small system" project with a
 * diagram node moved and another removed from the diagram), read back from
 * the browser before records carried a version: every later build must open it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAYOUT_FILE, layoutFormat, parseLayout, parseShown } from '#lib/diagram/positions.ts';
import { NEWER_FORMAT, PROJECT_FORMAT, readStored, type StoredProject } from './store.ts';

const fixture = (name: string): StoredProject =>
	JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/formats', name), 'utf8'));

describe('stored project format', () => {
	it('opens a project stored before records had a version, as version 1, unchanged', () => {
		const v1 = fixture('stored-project-v1.json');
		expect(v1.format).toBeUndefined();
		const read = readStored(v1)!;
		expect(read.format).toBe(1);
		expect({ ...read, format: undefined }).toEqual({ ...v1, format: undefined });
		expect(read.files.map((f) => f.path)).toContain(LAYOUT_FILE);
		// Its layout file, written before layout files had a version, reads as version 1.
		const layout = read.files.find((f) => f.path === LAYOUT_FILE)!.text;
		expect(layoutFormat(layout)).toBe(1);
		expect(Object.keys(parseLayout(layout))).not.toHaveLength(0);
		expect(Object.keys(parseShown(layout))).not.toHaveLength(0);
	});

	it('reads baselines kept with a project as they were, without a new format version', () => {
		const v1 = fixture('stored-project-v1.json');
		// Kept before there were baselines: none (the session reads a missing list as empty).
		expect(readStored(v1)!.baselines).toBeUndefined();
		const baselines = [
			{
				name: 'PDR',
				date: '2026-03-12',
				description: 'As presented',
				at: '2026-03-12T16:00:00Z',
				files: v1.files
			}
		];
		const read = readStored({ ...v1, format: PROJECT_FORMAT, baselines })!;
		expect(read.baselines).toEqual(baselines);
		// An optional field: older builds read the record and leave it be, so the number stays.
		expect(PROJECT_FORMAT).toBe(1);
	});

	it('opens its own version, and refuses a newer one rather than misread it', () => {
		const v1 = fixture('stored-project-v1.json');
		expect(readStored({ ...v1, format: PROJECT_FORMAT })?.format).toBe(PROJECT_FORMAT);
		expect(() => readStored({ ...v1, format: PROJECT_FORMAT + 1 })).toThrow(NEWER_FORMAT);
		expect(readStored(undefined)).toBeUndefined();
	});
});
