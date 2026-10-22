/**
 * "New hazard": a hazard, the harms it can cause with their severity, the
 * situation that exposes people to it (optional), the causal links between
 * them and the risk controls on it, written with the `HazardAnalysis`
 * library as the demo writes its hazards:
 *
 *   occurrence 'Battery fire' : Hazard { :>> description = "…"; }
 *   occurrence Burns : Harm {
 *       :>> description = "…";
 *       :>> severity = SeverityScale::critical;
 *   }
 *   connection : Causation connect 'Battery fire' to Burns;
 *   requirement <'RC-001'> 'Thermal cut-off' : RiskControl {
 *       doc /* The battery shall … *\/
 *       :>> hierarchy = ControlHierarchy::protectiveMeasure;
 *       ref :>> hazard = 'Battery fire';
 *   }
 */
import { docComment, name as sysmlName, stringLiteral } from './sysml';

/** A class of `SeverityScale`, with its value on the FMEA scale and what it means. */
export interface SeverityClass {
	literal: string;
	value: number;
	meaning: string;
}

/** The library's severity classes (`HazardAnalysis::SeverityScale`), as it documents them. */
export const SEVERITY_CLASSES: readonly SeverityClass[] = [
	{ literal: 'negligible', value: 2, meaning: 'Inconvenience or temporary discomfort' },
	{ literal: 'minor', value: 4, meaning: 'A temporary injury that needs no treatment' },
	{ literal: 'serious', value: 6, meaning: 'An injury that needs treatment by a professional' },
	{ literal: 'critical', value: 8, meaning: 'Permanent harm, or major damage to property' },
	{ literal: 'catastrophic', value: 10, meaning: 'Loss of life' }
];

/** The library's kinds of risk control (`HazardAnalysis::ControlHierarchy`), most effective first. */
export const CONTROL_KINDS: readonly { literal: string; label: string; meaning: string }[] = [
	{
		literal: 'inherentSafety',
		label: 'Safe by design',
		meaning: 'Remove the hazard, or make it smaller'
	},
	{
		literal: 'protectiveMeasure',
		label: 'Protective measure',
		meaning: 'A guard, alarm or monitor in the product'
	},
	{
		literal: 'informationForSafety',
		label: 'Information for safety',
		meaning: 'Warnings, instructions and training'
	}
];

export interface HarmSpec {
	name: string;
	description: string;
	/** A `SeverityScale` literal. */
	severity: string;
}

export interface ControlSpec {
	id: string;
	title: string;
	statement: string;
	/** A `ControlHierarchy` literal. */
	hierarchy: string;
}

export interface HazardSpec {
	name: string;
	description: string;
	/** When people are exposed to it (ISO 14971's hazardous situation), if said. */
	situation: { name: string; description: string } | null;
	/** New harms. */
	harms: HarmSpec[];
	/** Harms the model has already, as the package spells them. */
	existingHarms: string[];
	controls: ControlSpec[];
}

const occurrence = (name: string, type: string, values: string[]) =>
	values.length
		? [`occurrence ${sysmlName(name)} : ${type} {`, ...values.map((v) => `    ${v}`), '}'].join(
				'\n'
			)
		: `occurrence ${sysmlName(name)} : ${type};`;

/** The members a hazard adds to its package, in order: the elements, the links, the controls. */
export function hazardMembers(spec: HazardSpec): string[] {
	const out: string[] = [];
	const description = (text: string) =>
		text.trim() ? [`:>> description = ${stringLiteral(text.trim())};`] : [];
	const hazard = sysmlName(spec.name);
	out.push(occurrence(spec.name, 'Hazard', description(spec.description)));
	const situation = spec.situation?.name.trim() ? spec.situation : null;
	if (situation)
		out.push(occurrence(situation.name, 'HazardousSituation', description(situation.description)));
	for (const h of spec.harms)
		out.push(
			occurrence(h.name, 'Harm', [
				...description(h.description),
				`:>> severity = SeverityScale::${h.severity};`
			])
		);
	const from = situation ? sysmlName(situation.name) : hazard;
	if (situation) out.push(`connection : Causation connect ${hazard} to ${from};`);
	for (const harm of [...spec.harms.map((h) => sysmlName(h.name)), ...spec.existingHarms])
		out.push(`connection : Causation connect ${from} to ${harm};`);
	for (const c of spec.controls) out.push(controlText(c, hazard));
	return out;
}

/** A risk control: a requirement on the hazard. */
export function controlText(c: ControlSpec, hazard: string): string {
	const lines = [`requirement <${sysmlName(c.id.trim())}> ${sysmlName(c.title)} : RiskControl {`];
	if (c.statement.trim()) lines.push(`    ${docComment(c.statement)}`);
	lines.push(`    :>> hierarchy = ControlHierarchy::${c.hierarchy};`);
	lines.push(`    ref :>> hazard = ${hazard};`);
	lines.push('}');
	return lines.join('\n');
}

/** A new file for the project's hazards, with the members in it. */
export function hazardPackageText(packageName: string, about: string, members: string[]): string {
	// A blank line between members, but one-line links stay together.
	const body = members.flatMap((m, i) => {
		const next = members[i + 1];
		const together = next !== undefined && !m.includes('\n') && !next.includes('\n');
		return [m.replace(/^/gm, '    '), ...(together ? [] : [''])];
	});
	return [
		`package ${sysmlName(packageName)} {`,
		`    ${docComment(`The hazards of ${about}: what can cause harm, the harms it can cause and how severe they are, and the risk controls on each (ISO 14971).`)}`,
		'',
		'    private import HazardAnalysis::*;',
		'',
		...body
	]
		.join('\n')
		.replace(/\n+$/, '\n}\n');
}

/** What is wrong with a hazard's choices, by step, in plain words, or null. */
export function hazardProblem(
	spec: HazardSpec,
	step: 'hazard' | 'harms' | 'controls',
	taken: ReadonlySet<string>
): string | null {
	const names = [
		spec.name,
		...(spec.situation?.name.trim() ? [spec.situation.name] : []),
		...spec.harms.map((h) => h.name)
	].map((n) => n.trim());
	if (step === 'hazard') {
		if (!spec.name.trim()) return 'Name the hazard: what could cause harm.';
		if (taken.has(spec.name.trim()))
			return `There is already something called “${spec.name.trim()}”. Choose another name.`;
		return null;
	}
	if (step === 'harms') {
		if (!spec.harms.length && !spec.existingHarms.length)
			return 'Add at least one harm it can cause.';
		const unnamed = spec.harms.findIndex((h) => !h.name.trim());
		if (unnamed >= 0) return 'Name each harm, or remove the empty one.';
		for (const n of names.slice(1))
			if (taken.has(n) || names.filter((m) => m === n).length > 1)
				return `“${n}” is already used. Give each harm and situation a name of its own.`;
		return null;
	}
	for (const c of spec.controls) {
		if (!c.title.trim()) return 'Give each risk control a title, or remove the empty one.';
		if (!c.statement.trim()) return `Say what “${c.title.trim()}” requires (a “shall” statement).`;
	}
	const ids = spec.controls.map((c) => c.id.trim());
	if (ids.some((id, i) => !id || ids.indexOf(id) !== i || taken.has(id)))
		return 'Give each risk control an ID of its own.';
	return null;
}
