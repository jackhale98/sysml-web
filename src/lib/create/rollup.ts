/**
 * "Add up this value": an attribute of a part (or part def) made the sum of
 * the same value of its parts, written the way the demo writes its mass
 * roll-ups (`DroneArchitecture::drone::emptyMass`, `Rotor::mass`):
 *
 *   attribute :>> mass = body.mass + motor.mass + sum(wheels.mass);
 *
 * - A single part adds its value: `body.mass`.
 * - A fixed number of parts not given one by one (`part wheels : Wheel[4]`)
 *   adds them all with `sum(wheels.mass)`; the app works the total out
 *   (four times one wheel's mass) while the toolkit leaves it undecided
 *   (docs/engine.md, upstream request 2).
 * - A collection bound to named parts (`part rotors : Rotor[4] = (a, b, c,
 *   d)`) is added with `collect`, as the demo does, because the toolkit
 *   reads a dot chain as a set (`sum(rotors.mass)` of four equal masses is
 *   one mass; request 3) — unless its parts are also parts here, which are
 *   counted already. A `ref` part is counted where it is owned.
 * - Parts without the value, a `variation` (alternatives, not the design)
 *   and parts whose number isn't fixed (`[0..1]`, `[1..*]`) are left out,
 *   each with the reason.
 */
import { name as sysmlName } from './sysml';

export interface RollupPart {
	/** As written. */
	name: string;
	multiplicity: string | null;
	ref: boolean;
	variation: boolean;
	/** The bound value as written (`(frontLeft, frontRight)`), or null. */
	value: string | null;
	/** Its type, spelled where the roll-up is written (for `collect`). */
	type: string | null;
	/** Whether it has the value being added up. */
	has: boolean;
}

export interface RollupTerm {
	part: string;
	text: string;
	/** How many it counts (null when the number isn't known). */
	count: number | null;
}

export interface RollupPlan {
	terms: RollupTerm[];
	/** Parts left out, with why, in plain words. */
	left: { part: string; why: string }[];
	/** Library functions the expression uses. */
	imports: string[];
}

/** `4`, `4..4` → 4; `1` or none → 1; anything else (a range, `*`) → null. */
export function fixedCount(multiplicity: string | null): number | null {
	if (multiplicity === null || !multiplicity.trim()) return 1;
	const m = /^\s*(\d+)\s*(?:\.\.\s*(\d+)\s*)?$/.exec(multiplicity);
	if (!m) return null;
	if (m[2] !== undefined && m[2] !== m[1]) return null;
	return Number(m[1]);
}

/** The names a bound value lists: `(frontLeft, frontRight)` → both. */
function listed(value: string): string[] {
	return value
		.replace(/^\s*\(|\)\s*$/g, '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

export function rollupPlan(parts: readonly RollupPart[], attribute: string): RollupPlan {
	const a = sysmlName(attribute);
	const plan: RollupPlan = { terms: [], left: [], imports: [] };
	const names = new Set(parts.map((p) => p.name));
	const need = (target: string) => {
		if (!plan.imports.includes(target)) plan.imports.push(target);
	};
	for (const part of parts) {
		if (part.variation) {
			plan.left.push({ part: part.name, why: 'it lists alternatives, not parts of the design' });
			continue;
		}
		if (!part.has) {
			plan.left.push({ part: part.name, why: `it has no ${attribute}` });
			continue;
		}
		const members = part.value ? listed(part.value) : [];
		if (members.length && members.every((m) => names.has(m))) {
			plan.left.push({
				part: part.name,
				why: `its parts (${members.join(', ')}) are counted already`
			});
			continue;
		}
		if (part.ref) {
			plan.left.push({ part: part.name, why: 'it refers to parts owned elsewhere' });
			continue;
		}
		const count = fixedCount(part.multiplicity);
		if (count === 0) {
			plan.left.push({ part: part.name, why: 'there are none of it' });
			continue;
		}
		if (count === null) {
			plan.left.push({
				part: part.name,
				why: `how many there are isn’t fixed ([${part.multiplicity}])`
			});
			continue;
		}
		if (members.length) {
			need('NumericalFunctions::sum');
			need('ControlFunctions::collect');
			const each = part.type ? ` : ${part.type}` : '';
			plan.terms.push({
				part: part.name,
				text: `sum(${part.name}->collect { in p${each}; p.${a} })`,
				count: members.length
			});
			continue;
		}
		if (count > 1) {
			need('NumericalFunctions::sum');
			plan.terms.push({ part: part.name, text: `sum(${part.name}.${a})`, count });
			continue;
		}
		plan.terms.push({ part: part.name, text: `${part.name}.${a}`, count: 1 });
	}
	return plan;
}

/** The terms joined with `+`, broken into lines of about 90 characters after the first. */
export function rollupExpression(plan: RollupPlan, width = 90): string {
	const lines: string[] = [];
	let line = '';
	for (const [i, term] of plan.terms.entries()) {
		const piece = i === 0 ? term.text : ` + ${term.text}`;
		if (line && line.length + piece.length > width) {
			lines.push(line);
			line = `    + ${term.text}`;
		} else line += piece;
	}
	if (line) lines.push(line);
	return lines.join('\n');
}

/**
 * The member that makes the element's (inherited) attribute the sum:
 * `attribute :>> mass = …;`. An attribute the element declares itself gets
 * the expression as its value instead (`setDeclaration`).
 */
export function rollupMember(attribute: string, expression: string): string {
	return `attribute :>> ${sysmlName(attribute)} = ${expression};`;
}

/** The plain-language problem with a roll-up, or null. */
export function rollupProblem(plan: RollupPlan, attribute: string): string | null {
	if (!plan.terms.length)
		return plan.left.length
			? `None of its parts can be added up for ${attribute}: ${plan.left
					.map((l) => `${l.part} (${l.why})`)
					.join('; ')}.`
			: `It has no parts to add up. Add parts with a ${attribute} first.`;
	return null;
}
