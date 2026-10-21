/**
 * The library browser's file list and search, on small fixtures and on the
 * toolkit's real library bundle (fetched by `scripts/fetch-toolkit.sh`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildCatalog, relocate, searchCatalog, type BundleFile, type Catalog } from './catalog';
import { LIBRARY_REVISION, licenseFor, libraryLicense } from './license';

const fixture: BundleFile[] = [
	{
		name: 'Systems Library/Ports.sysml',
		text: `standard library package Ports {
	abstract port def Port {
		doc /* The most general port. */
	}
	abstract port ports : Port[0..*];
}`
	},
	{
		name: 'Kernel Libraries/Kernel Data Type Library/ScalarValues.kerml',
		text: `standard library package ScalarValues {
	datatype Real;
	datatype UnitBoundedReal;
	feature portion;
}`
	},
	{ name: 'local-packages/StringPatterns.sysml', text: 'library package StringPatterns {}' }
];

describe('the library catalog', () => {
	const catalog = buildCatalog(fixture);

	it('lists the standard files in path order, with their package, kind and size', () => {
		expect(catalog.entries).toEqual([
			{
				path: 'Kernel Libraries/Kernel Data Type Library/ScalarValues.kerml',
				package: 'ScalarValues',
				kind: 'kerml',
				size: fixture[1]!.text.length
			},
			{
				path: 'Systems Library/Ports.sysml',
				package: 'Ports',
				kind: 'sysml',
				size: fixture[0]!.text.length
			}
		]);
		// The toolkit's own packages open (for navigation) but are not listed.
		expect(catalog.texts.has('local-packages/StringPatterns.sysml')).toBe(true);
	});

	it('ranks exact names, then prefixes, then words, definitions first', () => {
		const names = (q: string) => searchCatalog(catalog, q, 10).map((h) => h.qualifiedName);
		expect(names('port')).toEqual([
			'Ports::Port',
			'Ports',
			'Ports::ports',
			'ScalarValues::portion'
		]);
		expect(names('Real')).toEqual(['ScalarValues::Real', 'ScalarValues::UnitBoundedReal']);
		expect(names('ScalarValues::Real')).toEqual(['ScalarValues::Real']);
		expect(names('  ')).toEqual([]);
		expect(searchCatalog(catalog, 'port', 2)).toHaveLength(2);
	});

	it('returns what the UI shows for a hit', () => {
		expect(searchCatalog(catalog, 'Port', 1)).toEqual([
			{
				name: 'Port',
				qualifiedName: 'Ports::Port',
				kind: 'port def',
				isDefinition: true,
				path: 'Systems Library/Ports.sysml',
				line: 2,
				doc: 'The most general port.'
			}
		]);
	});

	it('finds a name near a line from another release of the library', () => {
		const text = fixture[0]!.text;
		expect(relocate(text, 2, 'Port')).toBe(2);
		expect(relocate(text, 9, 'ports')).toBe(5);
		expect(relocate(text, 3, undefined)).toBe(3);
		expect(relocate(text, 3, 'Nowhere')).toBe(3);
	});

	it('is EPL-2.0, and the toolkit’s own packages Apache-2.0', () => {
		expect(libraryLicense.spdx).toBe('EPL-2.0');
		expect(libraryLicense.notice).toMatch(/Eclipse Public License 2\.0/);
		expect(licenseFor('Systems Library/Ports.sysml')).toBe(libraryLicense);
		expect(licenseFor('local-packages/StringPatterns.sysml').spdx).toBe('Apache-2.0');
	});
});

const TOOLKIT = join(import.meta.dirname, '../../../static/toolkit');
const BUNDLE = join(TOOLKIT, 'stdlib/sysml-library.json.gz');

describe.skipIf(!existsSync(BUNDLE))('the toolkit’s standard library', () => {
	let catalog: Catalog;
	let ms: number;
	beforeAll(() => {
		const bundle = JSON.parse(gunzipSync(readFileSync(BUNDLE)).toString()) as BundleFile[];
		const start = performance.now();
		catalog = buildCatalog(bundle);
		ms = performance.now() - start;
	});

	it('names the release the notice cites', () => {
		const notices = readFileSync(join(TOOLKIT, 'THIRD-PARTY-NOTICES.md'), 'utf8');
		expect(notices).toContain(LIBRARY_REVISION);
		expect(notices).toContain('Eclipse Public License 2.0');
	});

	it('lists every standard file with the package it declares', () => {
		expect(catalog.entries.length).toBeGreaterThanOrEqual(90);
		expect(catalog.entries.every((e) => e.package)).toBe(true);
		const find = (end: string) => catalog.entries.find((e) => e.path.endsWith(end));
		expect(find('/Ports.sysml')).toMatchObject({
			path: 'Systems Library/Ports.sysml',
			package: 'Ports'
		});
		expect(find('/USCustomaryUnits.sysml')?.package).toBe('USCustomaryUnits');
		expect(find('/ScalarValues.kerml')?.kind).toBe('kerml');
		expect(ms).toBeLessThan(1000);
	});

	it('finds what the inspector, explorer and palette look for', () => {
		const first = (q: string) => searchCatalog(catalog, q, 1)[0];
		expect(first('Real')).toMatchObject({
			qualifiedName: 'ScalarValues::Real',
			kind: 'datatype',
			isDefinition: true,
			path: 'Kernel Libraries/Kernel Data Type Library/ScalarValues.kerml'
		});
		expect(first('Part')).toMatchObject({ qualifiedName: 'Parts::Part', kind: 'part def' });
		expect(first('port')).toMatchObject({ qualifiedName: 'Ports::Port', kind: 'port def' });
		expect(first('Port')!.doc).toMatch(/most general class/);
		expect(first('ScalarValues::Real')?.qualifiedName).toBe('ScalarValues::Real');
		expect(first('kg')).toMatchObject({ qualifiedName: 'SI::kilogram' });

		const mass = searchCatalog(catalog, 'Mass', 12).map((h) => h.qualifiedName);
		expect(mass[0]).toBe('ISQBase::mass');
		expect(mass).toContain('ISQBase::MassValue');
		const power = searchCatalog(catalog, 'Power', 12);
		expect(power.slice(0, 3).map((h) => h.qualifiedName)).toEqual([
			'ISQMechanics::power',
			'ISQMechanics::PowerUnit',
			'ISQMechanics::PowerValue'
		]);
		expect(searchCatalog(catalog, 'length', 3).map((h) => h.qualifiedName)).toContain(
			'ISQBase::length'
		);
	});

	it('gives lines where the declarations are', () => {
		for (const q of ['Port', 'MassValue', 'Real', 'kilogram']) {
			const hit = searchCatalog(catalog, q, 1)[0]!;
			const line = catalog.texts.get(hit.path)!.split('\n')[hit.line - 1]!;
			expect(line, q).toContain(hit.name);
		}
	});
});
