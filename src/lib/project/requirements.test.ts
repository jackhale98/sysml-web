import { describe, expect, it } from 'vitest';
import type { Analysis, Span } from '#lib/engine/types.ts';
import { collectRequirements } from './requirements';
import { displayReference, stringValue, unescapeName } from './names';

const span = (start_byte: number): Span => ({
	start_row: 1,
	start_col: 1,
	end_row: 1,
	end_col: 1,
	start_byte,
	end_byte: start_byte + 1
});

const analysis: Analysis = {
	diagnostics: [],
	model: {
		file: 'requirements/System.sysml',
		definitions: [],
		syntax_errors: [],
		usages: [
			{
				kind: 'requirement',
				name: "'Max take-off mass'",
				short_name: "'SYS-002'",
				type_ref: 'EngineeringRequirement',
				doc: 'The MTOW shall not exceed 2 kg.',
				span: span(10)
			},
			{
				kind: 'attribute',
				name: 'priority',
				type_ref: null,
				parent_def: "'Max take-off mass'",
				redefinition: 'priority',
				value_expr: 'Priority::high',
				span: span(20)
			},
			{
				kind: 'attribute',
				name: 'verificationMethod',
				type_ref: null,
				parent_def: "'Max take-off mass'",
				redefinition: 'verificationMethod',
				value_expr: '(VerificationMethod::test, VerificationMethod::analysis)',
				span: span(30)
			},
			{
				kind: 'requirement',
				name: 'geofence',
				type_ref: null,
				span: span(40)
			}
		],
		annotations: [
			{
				metadata_type: 'StatusInfo',
				values: [
					['status', 'StatusKind::open'],
					['owner', '"J. Hale"']
				],
				target: "'Max take-off mass'",
				span: span(50)
			},
			{
				metadata_type: 'ModelingMetadata::Rationale',
				values: [['text', '"Class C1 limit."']],
				target: "'Max take-off mass'",
				span: span(60)
			}
		],
		satisfactions: [
			{ requirement: "'Max take-off mass'", by: 'droneSystem.airframe', span: span(70) },
			{ requirement: "Reqs::'SYS-002'", by: "droneSystem.'flight controller'", span: span(80) }
		],
		verifications: []
	}
};

describe('collectRequirements', () => {
	const [mtow, geofence] = collectRequirements([analysis]);

	it('reads ids, titles and text', () => {
		expect(mtow).toMatchObject({
			id: 'SYS-002',
			title: 'Max take-off mass',
			text: 'The MTOW shall not exceed 2 kg.'
		});
	});

	it('reads attributes and standard metadata', () => {
		expect(mtow).toMatchObject({
			priority: 'high',
			kind: null,
			verificationMethods: ['test', 'analysis'],
			status: 'open',
			owner: 'J. Hale',
			rationale: 'Class C1 limit.'
		});
	});

	it('matches trace links by name, short name and qualified name', () => {
		expect(mtow?.satisfiedBy).toEqual(['droneSystem.airframe', 'droneSystem.flight controller']);
		expect(mtow?.verifiedBy).toEqual([]);
	});

	it('tolerates bare requirements', () => {
		expect(geofence).toMatchObject({ id: null, title: 'geofence', status: null, satisfiedBy: [] });
	});
});

describe('names', () => {
	it('unescapes unrestricted names', () => {
		expect(unescapeName("'it\\'s'")).toBe("it's");
		expect(unescapeName('plain')).toBe('plain');
		expect(displayReference("a::'b c'.d")).toBe('a::b c.d');
		expect(stringValue('"x \\"y\\""')).toBe('x "y"');
	});
});
