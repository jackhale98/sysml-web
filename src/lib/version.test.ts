import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';
import { version } from './version';

describe('version', () => {
	it('matches package.json and looks like semver', () => {
		expect(version).toBe(pkg.version);
		expect(version).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/);
	});
});
