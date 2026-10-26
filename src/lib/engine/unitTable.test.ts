/**
 * The app's unit table is the bundled standard library's: every unit `SI`
 * and `USCustomaryUnits` declare, with the factor and dimension their
 * definitions give. Regenerate it after a library update with
 * `UPDATE_UNITS=1 npx vitest run src/lib/engine/unitTable.test.ts`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { convert, parseUnit } from './quantity';
import { unitsFromLibrary, type LibraryUnit } from './unitLibrary';
import { ALIASES, UNITS, type UnitEntry } from './unitTable';

const ROOT = resolve(import.meta.dirname, '../../..');
const BUNDLE = join(ROOT, 'static/toolkit/stdlib/sysml-library.json.gz');
const TABLE = join(ROOT, 'src/lib/engine/unitTable.ts');

function library() {
	if (!existsSync(BUNDLE))
		throw new Error('static/toolkit is missing: run scripts/fetch-toolkit.sh');
	return unitsFromLibrary(
		JSON.parse(gunzipSync(readFileSync(BUNDLE)).toString()) as { name: string; text: string }[]
	);
}

const trim = (dims: number[]) => {
	const out = [...dims];
	while (out.length && out[out.length - 1] === 0) out.pop();
	return out;
};

const entryOf = (u: LibraryUnit): UnitEntry =>
	u.offset !== undefined
		? [u.factor, trim(u.dims), u.pkg, u.offset]
		: [u.factor, trim(u.dims), u.pkg];

function render(units: LibraryUnit[], aliases: Record<string, string>): string {
	const key = (k: string) => JSON.stringify(k);
	const lines = units.map((u) => `\t${key(u.symbol)}: ${JSON.stringify(entryOf(u))},`);
	const other = Object.entries(aliases).map(([a, s]) => `\t${key(a)}: ${key(s)},`);
	return `/**
 * The units of the bundled standard library (\`SI\`, \`USCustomaryUnits\`):
 * symbol → [factor to the coherent SI unit, dimension, package, zero shift
 * in kelvin for a temperature scale]. The dimension's exponents are of
 * length, mass, time, current, temperature, amount, luminous intensity,
 * angle and solid angle. Generated from the library by \`unitTable.test.ts\`
 * (\`UPDATE_UNITS=1\`), which checks it still matches: don't edit by hand.
 */
export type UnitEntry = [factor: number, dims: number[], pkg: string, offset?: number];

export const UNITS: Record<string, UnitEntry> = {
${lines.join('\n')}
};

/** Other spellings the library gives: a unit's name (\`metre\`) and its aliases (\`psi\`). */
export const ALIASES: Record<string, string> = {
${other.join('\n')}
};
`;
}

describe('the unit table', () => {
	it('is the bundled library’s', () => {
		const { units, aliases } = library();
		if (process.env.UPDATE_UNITS) {
			writeFileSync(TABLE, render(units, aliases));
			execFileSync(join(ROOT, 'node_modules/.bin/prettier'), ['--write', TABLE]);
		}
		expect(UNITS).toEqual(Object.fromEntries(units.map((u) => [u.symbol, entryOf(u)])));
		expect(ALIASES).toEqual(aliases);
	});

	it('follows the library’s definitions, also where they are approximate', () => {
		// The library's pound is 0.4535924 kg (the exact pound is 0.45359237 kg), its ounce
		// 0.02834952 kg, its degree 0.01745329 rad; the grain is 6.479891e-5 kg exactly.
		expect(convert(1, 'lb', 'kg')).toBe(0.4535924);
		expect(convert(1, 'oz', 'kg')).toBe(0.02834952);
		expect(convert(7000, 'gr', 'g')).toBeCloseTo(453.59237, 9);
		expect(convert(1, '°', 'rad')).toBe(0.01745329);
		expect(convert(1, 'ft', 'm')).toBe(0.3048);
		expect(convert(1, 'mi/h', 'km/h')).toBeCloseTo(1.609344, 12);
		expect(convert(1, 'psi', 'Pa')).toBeCloseTo(4.448222 / 0.0254 ** 2, 9);
		// Every unit the library declares is known, by its symbol as written in brackets.
		for (const symbol of Object.keys(UNITS)) expect(parseUnit(symbol), symbol).not.toBeNull();
		// What it leaves out: units defined as `one` (byte, bit, decibel…), which would
		// otherwise convert to one another and to plain numbers.
		expect(parseUnit('B')).toBeNull();
		expect(parseUnit('bit')).toBeNull();
	});
});
