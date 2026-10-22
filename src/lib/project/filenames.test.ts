import { describe, expect, it } from 'vitest';
import {
	checkFilePath,
	folderOf,
	foldersOf,
	nameOf,
	newFileText,
	withExtension
} from './filenames.ts';

const existing = [
	'model/Drone.sysml',
	'structure/Frame.sysml',
	'README.md',
	'libraries/Views.sysml'
];

describe('file names', () => {
	it('adds .sysml when it is left off', () => {
		expect(withExtension('Power')).toBe('Power.sysml');
		expect(withExtension('Power.sysml')).toBe('Power.sysml');
		expect(withExtension('Core.kerml')).toBe('Core.kerml');
		expect(checkFilePath('structure', 'Power', existing)).toEqual({
			path: 'structure/Power.sysml',
			error: null
		});
		expect(checkFilePath('', ' Power supply ', existing)).toEqual({
			path: 'Power supply.sysml',
			error: null
		});
	});

	it('takes a new folder, nested, and tidies its slashes', () => {
		expect(checkFilePath('/systems/power/ ', 'Battery', existing).path).toBe(
			'systems/power/Battery.sysml'
		);
		expect(checkFilePath('a\\b', 'C', existing).path).toBe('a/b/C.sysml');
	});

	it('refuses unsafe names', () => {
		const error = (folder: string, name: string) => checkFilePath(folder, name, existing).error;
		expect(error('', '')).toMatch(/Give the file a name/);
		expect(error('', '   ')).toMatch(/Give the file a name/);
		expect(error('', '.hidden')).toMatch(/start with a dot/);
		expect(error('', '.sysml')).toMatch(/start with a dot/);
		expect(error('', 'a/b')).toMatch(/folder separately/);
		expect(error('', 'Power?')).toMatch(/letters, digits.*"\?"/);
		expect(error('', 'Power:Supply')).toMatch(/":"/);
		expect(error('', 'Power.')).toMatch(/end with a dot/);
		expect(error('', 'con')).toMatch(/Windows/);
		expect(error('', 'COM1.sysml')).toMatch(/Windows/);
		expect(error('a//b', 'X')).toMatch(/folder name is empty/);
		expect(error('../up', 'X')).toMatch(/start with a dot/);
		expect(error('.git', 'X')).toMatch(/start with a dot/);
		expect(error('', 'x'.repeat(121))).toMatch(/too long/);
		expect(error('', 'Ünïcode_ok-1')).toBeNull();
	});

	it('refuses a clash, also one only in capitals', () => {
		expect(checkFilePath('model', 'Drone', existing).error).toBe(
			'There is a file model/Drone.sysml already.'
		);
		expect(checkFilePath('MODEL', 'drone.sysml', existing).error).toMatch(
			/model\/Drone.sysml already .*capitals/
		);
		expect(checkFilePath('model/Drone.sysml', 'X', existing).error).toMatch(/is a file/);
		expect(checkFilePath('', 'model.sysml', ['model.sysml/x.sysml']).error).toMatch(/is a folder/);
	});

	it('lets a file keep its own name, or change only its capitals, when renamed', () => {
		expect(checkFilePath('model', 'Drone', existing, 'model/Drone.sysml').error).toBeNull();
		expect(checkFilePath('model', 'drone', existing, 'model/Drone.sysml')).toEqual({
			path: 'model/drone.sysml',
			error: null
		});
	});

	it('splits paths and lists folders', () => {
		expect(folderOf('a/b/C.sysml')).toBe('a/b');
		expect(folderOf('C.sysml')).toBe('');
		expect(nameOf('a/b/C.sysml')).toBe('C.sysml');
		expect(foldersOf(['a/b/C.sysml', 'x.sysml', 'a/D.sysml', 'z/E.sysml'])).toEqual([
			'a',
			'a/b',
			'z'
		]);
	});
});

describe('a new file', () => {
	it('starts as a package named after the file', () => {
		expect(newFileText('structure/Power.sysml')).toBe('package Power {\n}\n');
		expect(newFileText('power-supply.sysml')).toBe('package PowerSupply {\n}\n');
		expect(newFileText('2nd stage.sysml')).toBe("package '2nd stage' {\n}\n");
	});

	it('gets a number when a top-level package has its name already', () => {
		expect(newFileText('x/Power.sysml', ['Power'])).toBe('package Power2 {\n}\n');
		expect(newFileText('x/Power.sysml', ['Power', 'Power2'])).toBe('package Power3 {\n}\n');
	});
});
