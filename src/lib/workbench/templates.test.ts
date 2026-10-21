import { describe, expect, it } from 'vitest';
import { canOwnMembers, elementText, formatName } from './templates';

describe('templates', () => {
	it('quotes names that are not basic identifiers', () => {
		expect(formatName('Battery')).toBe('Battery');
		expect(formatName(' flight controller ')).toBe("'flight controller'");
		expect(formatName("it's")).toBe("'it’s'");
		expect(formatName('interface')).toBe("'interface'");
	});

	it('writes idiomatic SysML for each kind', () => {
		expect(elementText('part def', 'Battery')).toBe('part def Battery {\n}');
		expect(elementText('part', 'battery', 'Battery')).toBe('part battery : Battery;');
		expect(elementText('port', 'powerIn', '')).toBe('port powerIn;');
		expect(elementText('requirement', 'max mass')).toContain("requirement 'max mass' {");
	});

	it('knows which elements can own members', () => {
		expect(canOwnMembers('package', true)).toBe(true);
		expect(canOwnMembers('part', true)).toBe(true);
		expect(canOwnMembers('part', false)).toBe(false);
		expect(canOwnMembers('enum', true)).toBe(false);
	});
});
