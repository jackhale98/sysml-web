/**
 * `satisfy R by drone.camera` where R's subject is itself called `drone`: SysML
 * reads `drone` there as R's own subject (KerML 8.2.3.5, SysML 8.4.17.3), so the
 * claim binds the subject to itself or names a feature it doesn't have. The
 * engine reads it as the part the file imports, and the app's tables follow the
 * engine, so other SysML tools would see a different design. A warning at each,
 * with the qualified spelling that means what the tables show.
 */
import type { Analysis, Definition, Diagnostic, Usage } from '#lib/engine/types.ts';
import { byteToUtf16 } from './elements';
import { unescapeName } from './names';

export function satisfyProblems(
	analyses: readonly Analysis[],
	textOf: (path: string) => string | undefined
): Diagnostic[] {
	const byId = new Map<string, Usage | Definition>();
	const subjects: Usage[] = [];
	const definitions: Definition[] = [];
	for (const { model } of analyses) {
		for (const u of model.usages) {
			if (u.id) byId.set(u.id, u);
			if (u.kind === 'subject') subjects.push(u);
		}
		for (const d of model.definitions) {
			if (d.id) byId.set(d.id, d);
			definitions.push(d);
		}
	}
	const subjectOf = (owner: Usage | Definition) =>
		subjects.find((s) => s.qualified_name === `${owner.qualified_name}::${s.name}`);
	/** The requirement's subject name: its own, or its definition's (and theirs). */
	const subjectName = (requirement: Usage | Definition): string | null => {
		const seen = new Set<string>();
		for (
			let r: Usage | Definition | undefined = requirement;
			r && !seen.has(r.qualified_name ?? r.name);
		) {
			seen.add(r.qualified_name ?? r.name);
			const subject = subjectOf(r);
			if (subject) return unescapeName(subject.name);
			const general: string | null | undefined = 'type_ref' in r ? r.type_ref : r.super_type;
			const last: string | null = general ? unescapeName(general.split('::').pop()!) : null;
			r = last
				? definitions.find((d) => d.kind === 'requirement' && unescapeName(d.name) === last)
				: undefined;
		}
		return null;
	};

	const problems: Diagnostic[] = [];
	for (const { model } of analyses) {
		const text = textOf(model.file);
		if (!text) continue;
		for (const link of model.satisfactions) {
			const requirement = link.requirement_id ? byId.get(link.requirement_id) : undefined;
			const satisfier = link.by_id ? byId.get(link.by_id) : undefined;
			if (!requirement || !satisfier?.qualified_name) continue;
			const from = link.span.from ?? byteToUtf16(text, link.span.start_byte);
			const to = link.span.to ?? byteToUtf16(text, link.span.end_byte);
			const written = /\bby\s+([^;{]+)/.exec(text.slice(from, to))?.[1]?.trim();
			if (!written) continue;
			const root = written.split('.')[0]!;
			if (root.includes('::')) continue;
			const name = unescapeName(root);
			if (name !== subjectName(requirement)) continue;
			// What the tables show: the part the engine found, named from its package.
			const segments = satisfier.qualified_name.split('::');
			const at = segments.findIndex((s) => unescapeName(s) === name);
			if (at < 1) continue;
			const part = segments.slice(0, at + 1).join('::');
			const qualified = part + written.slice(root.length);
			problems.push({
				file: model.file,
				span: link.span,
				severity: 'warning',
				code: 'satisfy-subject',
				message: `In “by ${written}”, other SysML tools read ${name} as the requirement’s own subject, not the part ${part}: write ${qualified}.`,
				explanation:
					'Inside a satisfy, the name of the requirement’s subject means the subject itself, even when the file imports a part of the same name.',
				suggestion: `satisfy … by ${qualified};`
			});
		}
	}
	return problems;
}

/**
 * A requirement (or its definition) that declares a stakeholder or an actor must
 * declare its subject first, even when it inherits one (SysML 8.3.21,
 * validateRequirementUsageSubjectParameterPosition): the engine accepts it,
 * other SysML tools reject it.
 */
export function subjectFirstProblems(analyses: readonly Analysis[]): Diagnostic[] {
	const parameters = new Map<string, Usage[]>();
	for (const { model } of analyses)
		for (const u of model.usages)
			if (
				(u.kind === 'subject' || u.kind === 'stakeholder' || u.kind === 'actor') &&
				u.qualified_name
			) {
				const owner = u.qualified_name.slice(0, -(u.name.length + 2));
				parameters.set(owner, [...(parameters.get(owner) ?? []), u]);
			}
	const problems: Diagnostic[] = [];
	for (const { model } of analyses)
		for (const r of [...model.definitions, ...model.usages]) {
			if ((r.kind !== 'requirement' && r.kind !== 'concern') || !r.qualified_name) continue;
			const own = (parameters.get(r.qualified_name) ?? []).sort(
				(a, b) => a.span.start_byte - b.span.start_byte
			);
			const first = own.find((p) => p.kind !== 'subject');
			if (!first) continue;
			const subject = own.find((p) => p.kind === 'subject');
			if (subject && subject.span.start_byte < first.span.start_byte) continue;
			problems.push({
				file: model.file,
				span: subject?.span ?? r.span,
				severity: 'warning',
				code: 'subject-first',
				message: subject
					? `Declare the subject of ${unescapeName(r.name)} before its ${first.kind}: other SysML tools reject a requirement whose first parameter is not its subject.`
					: `${unescapeName(r.name)} has a ${first.kind} but no subject of its own: declare its subject first (other SysML tools reject it otherwise).`,
				explanation:
					'In SysML a requirement’s subject is its first parameter; one that declares a stakeholder or actor declares its subject before them, even when it inherits one.'
			});
		}
	return problems;
}
