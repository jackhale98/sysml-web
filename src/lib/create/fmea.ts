/**
 * "New FMEA" and "Add a line": the three kinds of FMEA the risk library
 * tells apart, the ratings in plain words, and the SysML they write — a
 * package for the lines and a worksheet view over it, then one `@Fmea`
 * line per failure mode, as the demo's design FMEA is written:
 *
 *   package DroneDesignFmea {
 *       private import RiskAnalysis::*;
 *       private import DroneArchitecture::drone;
 *
 *       @Fmea about drone::battery {
 *           failureMode = "Thermal runaway";
 *           effect = "Fire in the airframe";
 *           cause = "Internal cell short";
 *           category = RiskCategory::design;
 *           severity = 8; likelihood = 3; detection = 6;
 *       }
 *   }
 *   view droneDesignFmea : DesignFmeaWorksheet { expose DroneDesignFmea::*; }
 */
import type { ModelElement } from '#lib/project/elements.ts';
import { docComment, name as sysmlName, stringLiteral } from './sysml';

export type FmeaKindId = 'design' | 'process' | 'use';

export interface FmeaKind {
	id: FmeaKindId;
	label: string;
	/** The usual abbreviation. */
	short: string;
	/** One line, in plain words. */
	description: string;
	/** The `RiskCategory` literal its lines carry. */
	literal: string;
	/** The library's worksheet view def. */
	worksheet: string;
	/** What a line is about, in words: `part`, `process step`, `task`. */
	element: string;
	/** The question of the "what it covers" step. */
	covers: string;
	/** What the failure is called, and examples for each field. */
	failure: string;
	examples: { failure: string; effect: string; cause: string };
	/** The name a new sheet starts with, after what it covers. */
	suffix: string;
}

export const FMEA_KINDS: readonly FmeaKind[] = [
	{
		id: 'design',
		label: 'Design FMEA',
		short: 'DFMEA',
		description: 'How the parts of a design can fail, and what each failure does.',
		literal: 'design',
		worksheet: 'DesignFmeaWorksheet',
		element: 'part',
		covers: 'Which parts does it cover?',
		failure: 'Failure mode',
		examples: {
			failure: 'Battery overheats',
			effect: 'Fire; the product is lost',
			cause: 'Short circuit inside a cell'
		},
		suffix: 'design FMEA'
	},
	{
		id: 'process',
		label: 'Process FMEA',
		short: 'PFMEA',
		description: 'How the steps of a process can go wrong: making, assembling, servicing.',
		literal: 'process',
		worksheet: 'ProcessFmeaWorksheet',
		element: 'process step',
		covers: 'Which process does it cover?',
		failure: 'Failure mode',
		examples: {
			failure: 'Connector not pushed fully home',
			effect: 'Power cuts out in use',
			cause: 'No click to feel or hear'
		},
		suffix: 'process FMEA'
	},
	{
		id: 'use',
		label: 'Use FMEA',
		short: 'uFMEA',
		description:
			'The mistakes a user can make in each task, or foreseeable misuse, and what follows.',
		literal: "'use'",
		worksheet: 'UseFmeaWorksheet',
		element: 'task',
		covers: 'Which tasks or use cases does it cover?',
		failure: 'Use error',
		examples: {
			failure: 'Opens the lid while it runs',
			effect: 'Burns to the hand',
			cause: 'The lid does not lock'
		},
		suffix: 'use FMEA'
	}
];

export function fmeaKind(id: string): FmeaKind | undefined {
	return FMEA_KINDS.find((k) => k.id === id);
}

/** The kind of a worksheet, from the view def it is typed by. */
export function kindOfWorksheet(definition: string | undefined): FmeaKind | undefined {
	const simple = definition?.split('::').pop();
	return FMEA_KINDS.find((k) => k.worksheet === simple);
}

/** The elements a line of the kind can be about: parts; actions; tasks and use cases. */
export function canAnalyse(kind: FmeaKind, element: ModelElement): boolean {
	switch (kind.id) {
		case 'design':
			return element.kind === 'part';
		case 'process':
			return element.kind === 'action' || element.kind === 'perform';
		case 'use':
			return element.kind === 'action' || element.kind === 'perform' || element.kind === 'use_case';
	}
}

/** One rating's meaning, 1 to 10 (AIAG-VDA, in plain words). */
export interface Rating {
	field: 'severity' | 'likelihood' | 'detection';
	label: string;
	/** What it asks. */
	question: string;
	/** Index 0 is rating 1. */
	meanings: readonly string[];
}

export const RATINGS: readonly Rating[] = [
	{
		field: 'severity',
		label: 'Severity',
		question: 'How bad is the effect?',
		meanings: [
			'No noticeable effect',
			'Slight annoyance: looks, sounds or feels a little off',
			'Annoying: looks, sounds or feels wrong',
			'Very annoying: most users would complain',
			'A comfort or convenience function works less well',
			'A comfort or convenience function is lost',
			'The main function works less well',
			'The main function is lost',
			'Breaks a law or regulation',
			'Can hurt someone: affects safe use'
		]
	},
	{
		field: 'likelihood',
		label: 'Likelihood',
		question: 'How likely is the cause?',
		meanings: [
			'Cannot happen: prevented by design',
			'Extremely unlikely',
			'Very unlikely',
			'Unlikely',
			'Happens now and then',
			'Happens sometimes',
			'Fairly likely',
			'Likely',
			'Very likely',
			'Almost certain'
		]
	},
	{
		field: 'detection',
		label: 'Detection',
		question: 'Could it slip through unnoticed?',
		meanings: [
			'Always caught: it cannot go unnoticed',
			'Almost certainly caught by a proven check',
			'Very likely caught by a check made for it',
			'Likely caught by a check made for it',
			'Fairly likely caught',
			'Might be caught by a check made for it',
			'Might be caught by a check not made for it',
			'Unlikely to be caught',
			'Very unlikely to be caught',
			'Cannot be detected before it reaches the user'
		]
	}
];

/** The meaning of a rating (1 to 10), or ''. */
export function ratingMeaning(field: Rating['field'], value: number): string {
	return RATINGS.find((r) => r.field === field)?.meanings[value - 1] ?? '';
}

// --- What a new FMEA writes ------------------------------------------------------------------

export interface FmeaSheetSpec {
	kind: FmeaKind;
	/** The package's name (an identifier). */
	packageName: string;
	/** What it covers, as people read it (for the doc). */
	covers: string[];
	/** Imports the package needs (the library, what it covers). */
	imports: string[];
	note?: string;
}

/** The package that holds the lines, in a file of its own. */
export function fmeaPackageText(spec: FmeaSheetSpec): string {
	const covers = spec.covers.length ? ` of ${listWords(spec.covers)}` : '';
	const doc =
		spec.note?.trim() ||
		`${spec.kind.label}${covers}: ${spec.kind.description[0]!.toLowerCase()}${spec.kind.description.slice(1)}`;
	const lines = [
		`package ${sysmlName(spec.packageName)} {`,
		`    ${docComment(`${doc} One @Fmea line per ${spec.kind.id === 'use' ? 'use error' : 'failure mode'}.`)}`,
		'',
		...spec.imports.map((i) => `    private import ${i};`),
		'}'
	];
	return `${lines.join('\n')}\n`;
}

/** A view of the package's lines (a worksheet, a risk matrix), typed by a view def of the library. */
export function packageViewText(
	name: string,
	definition: string,
	packageName: string,
	doc: string
): string {
	return [
		`view ${sysmlName(name)} : ${definition} {`,
		`    ${docComment(doc)}`,
		`    expose ${sysmlName(packageName)}::*;`,
		'}'
	].join('\n');
}

// --- One line ----------------------------------------------------------------------------

export interface FmeaLineSpec {
	/** The element as the line's package spells it (`drone::battery`). */
	about: string;
	failureMode: string;
	effect: string;
	cause: string;
	/** The `RiskCategory` literal. */
	category: string;
	severity: number;
	likelihood: number;
	detection: number;
	/** The hazard it can lead to, as the package spells it. */
	hazard?: string | null;
	preventionControls?: string;
	detectionControls?: string;
	/** The risk controls and mitigations that address it, as the package spells them (`'RC-001'`). */
	riskControls?: string[];
	mitigations?: string[];
}

/** `@Fmea about drone::battery { … }`, as the demo writes its lines. */
export function fmeaLineText(spec: FmeaLineSpec): string {
	const lines = [`@Fmea about ${spec.about} {`];
	const text = (field: string, value: string | undefined) => {
		if (value?.trim()) lines.push(`    ${field} = ${stringLiteral(value.trim())};`);
	};
	text('failureMode', spec.failureMode);
	text('effect', spec.effect);
	text('cause', spec.cause);
	lines.push(`    category = RiskCategory::${spec.category};`);
	lines.push(
		`    severity = ${spec.severity}; likelihood = ${spec.likelihood}; detection = ${spec.detection};`
	);
	text('preventionControls', spec.preventionControls);
	text('detectionControls', spec.detectionControls);
	if (spec.hazard) lines.push(`    hazard = ${spec.hazard};`);
	const refs = (field: string, names: string[] | undefined) => {
		if (names?.length)
			lines.push(`    ${field} = ${names.length === 1 ? names[0] : `(${names.join(', ')})`};`);
	};
	refs('riskControls', spec.riskControls);
	refs('mitigations', spec.mitigations);
	lines.push('}');
	return lines.join('\n');
}

/** What is wrong with a line, in plain words, or null. */
export function fmeaLineProblem(spec: {
	about: string | null;
	failureMode: string;
	ratings: Record<Rating['field'], number | null>;
	kind: FmeaKind;
}): string | null {
	if (!spec.about) return `Choose the ${spec.kind.element} that can fail.`;
	if (!spec.failureMode.trim())
		return spec.kind.id === 'use'
			? 'Say what the user could do wrong.'
			: 'Say how it can fail (the failure mode).';
	for (const r of RATINGS) {
		const v = spec.ratings[r.field];
		if (v === null || !Number.isInteger(v) || v < 1 || v > 10)
			return `Choose a ${r.label.toLowerCase()} from 1 to 10.`;
	}
	return null;
}

/** What is wrong with a new sheet, or null. */
export function fmeaSheetProblem(spec: {
	kind: FmeaKind | undefined;
	title: string;
	taken: boolean;
}): string | null {
	if (!spec.kind) return 'Choose the kind of FMEA.';
	if (!spec.title.trim()) return 'Give the FMEA a name.';
	if (spec.taken)
		return `There is already something called “${spec.title.trim()}”. Choose another name.`;
	return null;
}

/** `a`, `a and b`, `a, b and c`. */
export function listWords(items: readonly string[]): string {
	if (items.length < 2) return items.join('');
	return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
