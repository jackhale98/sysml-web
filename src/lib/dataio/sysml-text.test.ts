import { describe, expect, it } from 'vitest';
import {
	derivationText,
	docComment,
	requirementText,
	sysmlName,
	sysmlString,
	wrap
} from './sysml-text';

describe('sysmlName', () => {
	it('keeps basic names and quotes the rest', () => {
		expect(sysmlName('maxMass')).toBe('maxMass');
		expect(sysmlName('Flight endurance')).toBe("'Flight endurance'");
		expect(sysmlName('SYS-012')).toBe("'SYS-012'");
		expect(sysmlName('2ndStage')).toBe("'2ndStage'");
	});

	it('escapes backslashes, writes apostrophes as ’ and folds whitespace', () => {
		expect(sysmlName("Pilot's switch")).toBe("'Pilot’s switch'");
		expect(sysmlName('a\\b')).toBe("'a\\\\b'");
		expect(sysmlName('  two\n lines ')).toBe("'two lines'");
	});

	it('quotes names spelled like SysML keywords', () => {
		expect(sysmlName('part')).toBe("'part'");
		expect(sysmlName('requirement')).toBe("'requirement'");
		expect(sysmlName('Part')).toBe('Part');
	});
});

describe('sysmlString', () => {
	it('escapes quotes, backslashes and line breaks', () => {
		expect(sysmlString('He said "go"')).toBe('"He said \\"go\\""');
		expect(sysmlString('C:\\temp')).toBe('"C:\\\\temp"');
		expect(sysmlString('one\r\ntwo')).toBe('"one\\ntwo"');
	});
});

describe('docComment', () => {
	it('writes a short text on one line', () => {
		expect(docComment('The drone shall fly.')).toBe('doc /* The drone shall fly. */');
	});

	it('wraps long text with the stars aligned, as the model is written', () => {
		const text =
			'The drone shall fly for at least 25 minutes with a 1 kg payload in still air before it reaches its landing reserve.';
		expect(docComment(text, '    ')).toBe(
			'    doc /* The drone shall fly for at least 25 minutes with a 1 kg payload in still air\n' +
				'         * before it reaches its landing reserve. */'
		);
	});

	it('keeps line breaks from the cell, and cannot be closed early by */', () => {
		expect(docComment('First */ part\n\nSecond')).toBe(
			'doc /* First * / part\n     *\n     * Second */'
		);
	});

	it('wraps at word boundaries and drops blank edges', () => {
		expect(wrap('\n\na b c\n\n', 3)).toEqual(['a b', 'c']);
	});
});

describe('requirementText', () => {
	it('writes a requirement the way the model writes them', () => {
		expect(
			requirementText({
				id: 'SYS-101',
				name: 'Landing light',
				type: 'DroneRequirement',
				doc: 'The drone shall show a light.',
				attributes: [
					{
						name: 'priority',
						value: { kind: 'enum', enumName: 'Priority', literals: ['high'], many: false }
					},
					{
						name: 'verificationMethod',
						value: {
							kind: 'enum',
							enumName: 'VerificationMethod',
							literals: ['analysis', 'inspection'],
							many: true
						}
					}
				],
				status: 'open',
				owner: 'Zoë "Z" Åberg',
				rationale: 'Night deliveries.',
				issues: ['Which colour?']
			})
		).toBe(
			[
				"requirement <'SYS-101'> 'Landing light' : DroneRequirement {",
				'    doc /* The drone shall show a light. */',
				'    :>> priority = Priority::high;',
				"    :>> verificationMethod = (VerificationMethod::'analysis', VerificationMethod::inspection);",
				'    @StatusInfo { status = StatusKind::open; owner = "Zoë \\"Z\\" Åberg"; }',
				'    @Rationale { text = "Night deliveries."; }',
				'    @Issue { text = "Which colour?"; }',
				'}'
			].join('\n')
		);
	});

	it('writes a bare declaration when there is nothing in the body', () => {
		expect(requirementText({ name: 'R1', attributes: [] })).toBe('requirement R1;');
	});

	it('writes derivations', () => {
		expect(derivationText("StakeholderNeeds::'Safe operation'", ["'Landing light'"])).toBe(
			"#derivation connection {\n    end #original ::> StakeholderNeeds::'Safe operation';\n    end #derive ::> 'Landing light';\n}"
		);
	});
});
