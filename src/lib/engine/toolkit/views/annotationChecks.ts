/**
 * The checks metadata values make, beside the toolkit's: a value its
 * type's asserted constraints reject (`assertions.ts`), and an FMEA line
 * whose severity disagrees with its hazard's harms (`hazards.ts`). Each is
 * a violated `assert` check at the value, so it shows in Problems, in the
 * design checks table and in review like any other. Lines that pass add
 * nothing (as a type's invariant that holds doesn't).
 */
import type { Check } from '../../types';
import { valueProblems, type ValueProblem } from './assertions';
import type { Annotation, ViewContext } from './context';
import { severityProblem } from './hazards';

export function annotationChecks(ctx: ViewContext): Check[] {
	const checks: Check[] = [];
	for (const a of ctx.annotations) {
		if (!ctx.content.has(a.path)) continue;
		for (const p of [...valueProblems(ctx, a), severityProblem(ctx, a)])
			if (p) checks.push(checkOf(a, p));
	}
	return checks;
}

function checkOf(a: Annotation, p: ValueProblem): Check {
	const span = p.at?.span ?? a.span;
	const about = a.target ? ` about ${a.target}` : '';
	return {
		kind: 'assert',
		status: 'violated',
		checkable: true,
		detail: p.message,
		explanation: p.message,
		requirement: null,
		by: a.target || null,
		constraint: p.rule,
		name: `@${a.metadata_type}${about}: ${p.field}`,
		values: [
			{
				feature: p.field,
				value:
					p.number !== null
						? { kind: 'number', value: p.number, unit: null }
						: { kind: 'text', text: p.value }
			}
		],
		file: p.at?.path ?? a.path,
		span,
		problem: `${p.message.replace(/\.$/, '')} (@${a.metadata_type}${about}).`
	};
}
