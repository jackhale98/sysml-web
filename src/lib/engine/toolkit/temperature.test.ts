/**
 * A limit on a temperature written on a scale with a zero offset (°C, °F) is
 * decided from the scale's zero: the toolkit (0.10.10) compares such values
 * as if they were differences, so 60 °C read as within 330 K.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ToolkitHost } from './host';
import { loadHost } from './testing';

let host: ToolkitHost;
beforeAll(async () => {
	host = await loadHost();
}, 60_000);

const model = (value: string, limit: string) => [
	{
		path: 't.sysml',
		text: `package T {
	private import SI::*;
	private import ISQ::*;
	part def Box { attribute t :> ISQ::thermodynamicTemperature; }
	requirement def Cool { subject b : Box; require constraint { b.t <= ${limit} } }
	part box : Box { attribute :>> t = ${value}; }
	requirement <'T-1'> cool : Cool;
	satisfy cool by box;
}`
	}
];
const statusOf = (value: string, limit: string) =>
	host.checks(model(value, limit)).checks.find((c) => c.requirement?.id === 'T-1')?.status;

describe('temperature limits', () => {
	it('60 °C is over 330 K (333.15 K)', () => {
		expect(statusOf("60 ['°C']", '330 [K]')).toBe('violated');
	});

	it('50 °C is within 330 K (323.15 K)', () => {
		expect(statusOf("50 ['°C']", '330 [K]')).toBe('satisfied');
	});

	it('kelvin against kelvin is left as it was', () => {
		expect(statusOf('320 [K]', '330 [K]')).toBe('satisfied');
		expect(statusOf('340 [K]', '330 [K]')).toBe('violated');
	});
});
