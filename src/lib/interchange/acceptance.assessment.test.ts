/**
 * Assessment (§3, prioritized questions 1 and 3): a deliberately complex
 * multi-file model (`fixtures/acceptance`: nested packages, imports,
 * cross-file references, units, multiplicities, specialization, redefinition,
 * requirements with satisfy/verify, constraints, ports and an interface,
 * states, actions, metadata, an alias, a variation) exchanged through every
 * route Fairtide offers, compared by NORMALIZED SEMANTICS
 * (`semantics-testing.ts`: qualified name → kind, typing, specialization,
 * multiplicity, values, relationships), not by text or ids.
 *
 * The SysON cases read what Eclipse SysON v2026.9.3 produced from the same
 * model (`fixtures/syson/`, captured with tools/interop/syson-roundtrip.sh;
 * see docs/assessment/03-interchange.md), so they run without SysON.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SourceFile } from '#lib/engine/protocol.ts';
import type { ToolkitHost } from '#lib/engine/toolkit/host.ts';
import { loadHost } from '#lib/engine/toolkit/testing.ts';
import { InterchangeError, readElements, type ElementJson } from '#lib/exchange/elements.ts';
import { summarizeImport } from '#lib/exchange/report.ts';
import { readProjectArchive, writeKpar } from './kpar';
import { compareDigests, differenceSize, semanticDigest, type Digest } from './semantics-testing';

const FIXTURES = join(import.meta.dirname, 'fixtures');

function filesIn(dir: string): SourceFile[] {
	const out: SourceFile[] = [];
	const walk = (d: string) => {
		for (const name of readdirSync(d).sort()) {
			const path = join(d, name);
			if (statSync(path).isDirectory()) walk(path);
			else if (/\.(sysml|kerml)$/.test(name))
				out.push({ path: relative(dir, path), text: readFileSync(path, 'utf8') });
		}
	};
	walk(dir);
	return out.sort((a, b) => a.path.localeCompare(b.path));
}

const gz = (name: string) => gunzipSync(readFileSync(join(FIXTURES, name))).toString();

let host: ToolkitHost;
let outside: (id: string) => string | null;
const model = filesIn(join(FIXTURES, 'acceptance'));
let reference: Digest;

/** The meaning of a set of files, as Fairtide's engine reads it. */
function digestOf(files: SourceFile[]): Digest {
	return semanticDigest(readElements(host.exportInterchange(files, {}).json), outside);
}

/** Errors (syntax and semantic) Fairtide reports for a set of files. */
function errorsOf(files: SourceFile[]): string[] {
	return host
		.analyzeProject(files)
		.flatMap((a) => [
			...a.model.syntax_errors.map((s) => `${a.model.file}: ${s.message}`),
			...a.diagnostics
				.filter((d) => d.severity === 'error')
				.map((d) => `${a.model.file}:${d.span.start_row + 1}: ${d.message}`)
		]);
}

beforeAll(async () => {
	host = await loadHost();
	// Elements outside a file (the standard library) are named by their qualified names.
	const lookup = host.tk.Session.fromSourcesWithPreparedLibrary('[]', host.library);
	outside = (id) => {
		const h = lookup.elementById(id);
		if (!h) return null;
		let name = lookup.qualifiedName(h) ?? null;
		if (!name) {
			const member = JSON.parse(lookup.property(h, 'memberElement')) as { '@id': string } | null;
			if (member) name = `membership(${outside(member['@id']) ?? '?'})`;
		}
		h.free();
		return name;
	};
	reference = digestOf(model);
}, 60_000);

describe('the acceptance model', () => {
	it('is clean in Fairtide (and the OMG pilot: see the assessment doc)', () => {
		const findings = host
			.analyzeProject(model)
			.flatMap((a) => [
				...a.model.syntax_errors,
				...a.diagnostics.filter((d) => d.severity !== 'note')
			]);
		expect(findings).toEqual([]);
	});

	it('has a digest that captures what the model means', () => {
		const facts = (key: string) => reference.get(key) ?? [];
		expect(reference.size).toBeGreaterThan(400);
		// Typing, multiplicity, composite part.
		expect(facts('Vehicle::Structure::Car::wheels')).toContain('kind PartUsage');
		expect(facts('Vehicle::Structure::Car::wheels/FeatureTyping#0')).toContain(
			'to Vehicle::Structure::Wheel'
		);
		expect(facts('Vehicle::Structure::Car::wheels/MultiplicityRange#0/LiteralInteger#0')).toContain(
			'value 4'
		);
		// Specialization across files, redefinition with a narrower multiplicity.
		expect(facts('Vehicle::Structure::ElectricCar/Subclassification#0')).toContain(
			'to Vehicle::Structure::Car'
		);
		expect(facts('Vehicle::Structure::ElectricCar/(:>>motor)/Redefinition#0')).toContain(
			'to Vehicle::Structure::Car::motor'
		);
		// Units: `9.5 [kg]` is the `[` operator on a literal and the unit.
		expect(
			facts('Vehicle::Structure::Wheel/(:>>mass)/FeatureValue#0/OperatorExpression#0')
		).toContain('operator "["');
		// A conjugated port, the satisfy and verify relationships, a guarded transition.
		expect(facts('Vehicle::Structure::Motor::input/ConjugatedPortTyping#0')).toContain(
			'to Basics::PowerPort::~PowerPort'
		);
		expect(facts('Traceability/SatisfyRequirementUsage#0/ReferenceSubsetting#0')).toContain(
			'to Reqs::carMass'
		);
		expect(facts('Reqs::MassTest/RequirementUsage#0/RequirementUsage#0')).toContain(
			'in RequirementVerificationMembership requirement'
		);
		expect(facts('VehicleBehaviour::DriveStates::switchOff')).toContain('kind TransitionUsage');
		// Imports keep their visibility; the alias is there.
		expect(facts('Vehicle/NamespaceImport#0')).toContain('to Basics private');
		expect(facts('Basics')).toContain('alias Kilogram for SI::kilogram');
	});
});

describe('Fairtide → SysML v2 JSON → Fairtide', () => {
	for (const [label, options] of [
		['only the model (the default)', {}],
		['with derived properties', { derived: true }],
		['with the standard library', { library: true }]
	] as const) {
		it(`keeps every element's meaning: ${label}`, () => {
			const exported = host.exportInterchange(model, options);
			expect(exported.leftOut).toEqual([]);
			expect(exported.dangling).toBe(0);
			const imported = host.importInterchange(exported.json);
			expect(imported.problems).toEqual([]);
			const difference = compareDigests(reference, digestOf(imported.files));
			expect(differenceSize(difference)).toEqual({ onlyInFirst: 0, onlyInSecond: 0, changed: 0 });
		}, 120_000);
	}

	for (const [label, options] of [
		['only the model (the default)', {}],
		['with the standard library', { library: true }]
	] as const) {
		it(`says everything came across: ${label}`, () => {
			const imported = host.importInterchange(host.exportInterchange(model, options).json);
			expect(imported.notes.filter((n) => n.kind !== 'library' && n.kind !== 'implied')).toEqual(
				[]
			);
			expect(summarizeImport(imported).tone).toBe('success');
		}, 120_000);
	}

	// Known gap: the derived form lists implied features (`result`, `thisThing`…) as elements and spells derived properties; the import counts them as lost (104 notes here, 1,172 for the demo) and as "reads differently" (807), though the meaning is identical.
	it.fails(
		'says everything came across: with derived properties',
		() => {
			const imported = host.importInterchange(
				host.exportInterchange(model, { derived: true }).json
			);
			expect(imported.notes.filter((n) => n.kind !== 'library' && n.kind !== 'implied')).toEqual(
				[]
			);
		},
		120_000
	);

	it('keeps element ids from one export to the next while files stay put', () => {
		const ids = (files: SourceFile[]) =>
			readElements(host.exportInterchange(files, {}).json).map((e) => e['@id']);
		expect(ids(model)).toEqual(ids(model.map((f) => ({ ...f }))));
	});

	// Known gap: ids are derived from file paths; an import names files after their packages, so every id changes.
	it.fails('keeps element ids through export → import → export', () => {
		const first = readElements(host.exportInterchange(model, {}).json);
		const imported = host.importInterchange(JSON.stringify(first));
		const again = new Set(
			readElements(host.exportInterchange(imported.files, {}).json).map((e) => e['@id'])
		);
		expect(first.filter((e) => !again.has(e['@id']))).toEqual([]);
	});
});

describe('.kpar round trip', () => {
	it('gives back the same files, byte for byte, and the same meaning', async () => {
		const bytes = await writeKpar(
			{ name: 'Acceptance', version: '1.0.0' },
			model,
			'2026-10-23T00:00:00Z'
		);
		const read = await readProjectArchive(bytes, 'fallback');
		expect(read.warnings).toEqual([]);
		expect(read.skipped).toEqual([]);
		expect(read.info).toMatchObject({ name: 'Acceptance', version: '1.0.0' });
		expect(read.files).toEqual(model);
		expect(differenceSize(compareDigests(reference, digestOf(read.files)))).toEqual({
			onlyInFirst: 0,
			onlyInSecond: 0,
			changed: 0
		});
	});
});

describe('SysON → Fairtide (what SysON v2026.9.3 made of the acceptance model)', () => {
	const syson = () => gz('syson/acceptance.elements.json.gz');

	it('says plainly that it cannot open SysON’s element JSON, rather than dropping parts of it', () => {
		let error: unknown;
		try {
			host.importInterchange(syson());
		} catch (e) {
			error = e;
		}
		expect(error).toBeInstanceOf(InterchangeError);
		expect(String(error)).toMatch(/could not read these elements/);
	});

	// Known gap: the toolkit cannot lift SysON's unnamed ConjugatedPortDefinitions or the unnamed `entry` action a succession refers to, so the whole import is refused.
	it.fails('opens SysON’s element JSON with the same meaning', () => {
		const imported = host.importInterchange(syson());
		expect(differenceSize(compareDigests(reference, digestOf(imported.files)))).toEqual({
			onlyInFirst: 0,
			onlyInSecond: 0,
			changed: 0
		});
	});

	it('reports the problems in SysON’s text export instead of opening it as if it were clean', () => {
		const text = filesIn(join(FIXTURES, 'syson/acceptance-text'));
		const errors = errorsOf(text);
		// SysON prints `totalMass :> mass = ;` for a calculation call, a bare `import`, and
		// `variant` usages as plain parts: each is an error Fairtide shows.
		expect(errors.length).toBeGreaterThanOrEqual(3);
		expect(errors.join('\n')).toMatch(/expected an expression/);
	});

	// Known gap (SysON's text export): it drops `variant`, metadata values and a calculation call; the text is not the model that was sent.
	it.fails('reads SysON’s text export back with the same meaning', () => {
		const text = filesIn(join(FIXTURES, 'syson/acceptance-text'));
		expect(differenceSize(compareDigests(reference, digestOf(text)))).toEqual({
			onlyInFirst: 0,
			onlyInSecond: 0,
			changed: 0
		});
	});

	// Known gap: elements of a file are matched to the lifted model by id, and the toolkit gives ids by position, so SysON's other member order shows as "not carried over" for typings and multiplicities the text does have.
	it.fails('opens a one-file SysON model without claiming that present typings were lost', () => {
		const imported = host.importInterchange(gz('syson/engineering-basics.elements.json.gz'));
		const text = imported.files.map((f) => f.text).join('\n');
		// The typings and multiplicities are in the text...
		expect(text).toContain('attribute kind : RequirementKind[0..1];');
		expect(text).toContain('attribute verificationMethod : VerificationMethod[0..*];');
		// ...so the report must not list them as not carried over.
		expect(imported.notes.filter((n) => n.kind === 'left-out')).toEqual([]);
	});
});

describe('malformed SysML v2 JSON', () => {
	const small = () =>
		readElements(
			host.exportInterchange(
				[{ path: 'A.sysml', text: 'package A { part def P; part p : P [2]; }' }],
				{}
			).json
		);

	// Known gap: duplicate @ids are not refused; the later element silently takes the earlier one's place and the report names the wrong element.
	it.fails('refuses (or names) elements that share an @id', () => {
		const elements = small();
		const p = elements.find((e) => e.declaredName === 'p')!;
		const twice: ElementJson[] = [...elements, { ...p, declaredName: 'q' }];
		let message: string;
		try {
			message = JSON.stringify(host.importInterchange(JSON.stringify(twice)).notes);
		} catch (e) {
			message = String(e);
		}
		expect(message).toMatch(/A::p\b|same @id|duplicate/i);
	});

	it('keeps a reference to an unknown id visible, as a warning and in the text', () => {
		const elements = small();
		const p = elements.find((e) => e.declaredName === 'p')!;
		const typing = elements.find(
			(e) =>
				e['@type'] === 'FeatureTyping' && (e.typedFeature as { '@id': string })['@id'] === p['@id']
		)!;
		typing.type = { '@id': '00000000-0000-0000-0000-000000000000' };
		const imported = host.importInterchange(JSON.stringify(elements));
		expect(summarizeImport(imported).tone).toBe('warn');
		expect(imported.files[0]!.text).toContain("'00000000-0000-0000-0000-000000000000'");
	});

	it('refuses what is not a list of elements, in plain words', () => {
		expect(() => host.importInterchange('{"hello": 1}')).toThrow(/no model elements/);
		expect(() => host.importInterchange('[[[]]]')).toThrow(/not an element/);
		expect(() => host.importInterchange('[{"@type": "Package"}]')).toThrow(/no "@id"/);
	});
});

describe('what an exported project needs elsewhere', () => {
	/** Errors in the files on their own: the standard library only, as another tool reads them. */
	function standaloneErrors(files: SourceFile[]): string[] {
		const session = host.tk.Session.fromSourcesWithPreparedLibrary(
			JSON.stringify(files.map((f) => ({ name: f.path, text: f.text }))),
			host.library
		);
		try {
			return (JSON.parse(session.check()) as { severity: string; message: string }[])
				.filter((f) => f.severity === 'error' || /unresolved/.test(f.message))
				.map((f) => f.message);
		} finally {
			session.free();
		}
	}

	it('the acceptance model needs nothing but the standard library', () => {
		expect(standaloneErrors(model)).toEqual([]);
	});

	// Known gap: Fairtide resolves `ModelViews`/`Reporting` from bundled copies the project doesn't hold, so a project can check clean here while its .kpar is incomplete everywhere else; nothing tells the user.
	it.fails(
		'a project that checks clean exports a .kpar that is complete without Fairtide',
		async () => {
			const files: SourceFile[] = [
				{
					path: 'Model.sysml',
					text: 'package Model {\n    private import ModelViews::*;\n    requirement r1;\n    view reqs : RequirementsTable { expose Model::**; }\n}\n'
				}
			];
			expect(errorsOf(files)).toEqual([]);
			const read = await readProjectArchive(await writeKpar({ name: 'M' }, files, ''), 'M');
			expect(standaloneErrors(read.files)).toEqual([]);
		}
	);

	it('KerML files: a project with one exports, but its JSON cannot be opened again (said plainly)', () => {
		const files: SourceFile[] = [
			{
				path: 'Core.kerml',
				text: 'package KCore {\n    private import ScalarValues::*;\n    classifier Thing;\n    class Vehicle :> Thing { feature mass : Real [1]; }\n}\n'
			}
		];
		expect(errorsOf(files)).toEqual([]);
		const exported = host.exportInterchange(files, {});
		expect(exported.leftOut).toEqual([]);
		// Known gap: the import lifts everything as SysML, which has no `classifier`/`class`.
		expect(() => host.importInterchange(exported.json)).toThrow(InterchangeError);
	});
});
