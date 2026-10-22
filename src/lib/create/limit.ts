/**
 * "Set a limit": a value that must be at most, at least or between given
 * numbers, written as the demo's checked requirements are —
 *
 *   requirement <'SYS-003'> 'Maximum take-off mass' {
 *       doc /* The drone's take-off mass shall be at most 4 kg. *\/
 *       subject drone : DeliveryDrone;
 *       require constraint { drone.takeOffMass <= 4 [kg] }
 *   }
 *   satisfy 'Maximum take-off mass' by drone;
 *
 * — so the design checks evaluate it against what satisfies the
 * requirement and show a verdict, and the budget tables show the limit and
 * the margin. "Between" is two constraints (a single comparison with a
 * number is what gives a margin).
 */
import {
	docComment,
	name as sysmlName,
	quantityText,
	readableNumber,
	readableUnit,
	sentenceCase,
	words
} from './sysml';

export type LimitKind = 'atMost' | 'atLeast' | 'between';

export interface Limit {
	kind: LimitKind;
	/** The bound for at most / at least; the upper one for between. */
	value: number;
	/** The lower bound, for between. */
	low?: number;
	unit: string | null;
}

/** The comparisons, without braces: `drone.takeOffMass <= 4 [kg]`. */
export function comparisons(feature: string, limit: Limit): string[] {
	const q = (v: number) => quantityText(v, limit.unit);
	switch (limit.kind) {
		case 'atMost':
			return [`${feature} <= ${q(limit.value)}`];
		case 'atLeast':
			return [`${feature} >= ${q(limit.value)}`];
		case 'between':
			return [`${feature} >= ${q(limit.low ?? 0)}`, `${feature} <= ${q(limit.value)}`];
	}
}

/** `require constraint { … }` members. */
export function requireConstraints(feature: string, limit: Limit): string[] {
	return comparisons(feature, limit).map((c) => `require constraint { ${c} }`);
}

/** The limit in words: `at most 4 kg`, `between 1 and 4 kg`. */
export function limitWords(limit: Limit): string {
	const unit = limit.unit ? ` ${readableUnit(limit.unit)}` : '';
	switch (limit.kind) {
		case 'atMost':
			return `at most ${readableNumber(limit.value)}${unit}`;
		case 'atLeast':
			return `at least ${readableNumber(limit.value)}${unit}`;
		case 'between':
			return `between ${readableNumber(limit.low ?? 0)} and ${readableNumber(limit.value)}${unit}`;
	}
}

/** "The drone's take off mass shall be at most 4 kg." */
export function limitStatement(owner: string, attribute: string, limit: Limit): string {
	return `The ${words(owner)}'s ${words(attribute)} shall be ${limitWords(limit)}.`;
}

/** "Maximum take off mass", "Minimum endurance", "Take off mass range". */
export function limitTitle(attribute: string, limit: Limit): string {
	const what = words(attribute);
	switch (limit.kind) {
		case 'atMost':
			return `Maximum ${what}`;
		case 'atLeast':
			return `Minimum ${what}`;
		case 'between':
			return sentenceCase(`${what} range`);
	}
}

/**
 * The next free ID in the project's style: the most used prefix with the
 * highest number plus one, as wide as the others (`SYS-011` → `SYS-012`);
 * `REQ-001` when there are none.
 */
export function nextRequirementId(ids: readonly (string | null)[]): string {
	const counts = new Map<string, { n: number; max: number; width: number }>();
	for (const id of ids) {
		const m = id ? /^(.*?)(\d+)$/.exec(id) : null;
		if (!m) continue;
		const entry = counts.get(m[1]!) ?? { n: 0, max: 0, width: m[2]!.length };
		entry.n++;
		entry.max = Math.max(entry.max, Number(m[2]));
		entry.width = Math.max(entry.width, m[2]!.length);
		counts.set(m[1]!, entry);
	}
	let best: [string, { n: number; max: number; width: number }] | null = null;
	for (const entry of counts) if (!best || entry[1].n > best[1].n) best = entry;
	if (!best) return 'REQ-001';
	const [prefix, { max, width }] = best;
	const taken = new Set(ids);
	for (let n = max + 1; ; n++) {
		const id = `${prefix}${String(n).padStart(width, '0')}`;
		if (!taken.has(id)) return id;
	}
}

export interface RequirementSpec {
	id: string;
	title: string;
	statement: string;
	/** The subject: its name and how it is typed (`: DeliveryDrone`) or subset (`:> drone`). */
	subject: { name: string; type: string; subsets?: boolean } | null;
	/** The feature compared, as the constraint writes it (`drone.takeOffMass`). */
	feature: string;
	limit: Limit;
}

/** A requirement with its statement, subject and constraint. */
export function requirementText(spec: RequirementSpec): string {
	const id = spec.id.trim() ? `<${sysmlName(spec.id.trim())}> ` : '';
	const lines = [`requirement ${id}${sysmlName(spec.title.trim())} {`];
	if (spec.statement.trim()) lines.push(`    ${docComment(spec.statement)}`);
	if (spec.subject)
		lines.push(
			`    subject ${sysmlName(spec.subject.name)} ${spec.subject.subsets ? ':>' : ':'} ${spec.subject.type};`
		);
	for (const c of requireConstraints(spec.feature, spec.limit)) lines.push(`    ${c}`);
	lines.push('}');
	return lines.join('\n');
}

/** `satisfy 'Maximum take-off mass' by drone;` */
export function satisfyText(requirement: string, by: string): string {
	return `satisfy ${sysmlName(requirement)} by ${by};`;
}

/** What is wrong with a limit, in plain words, or null. */
export function limitProblem(limit: {
	kind: LimitKind;
	value: string;
	low: string;
}): string | null {
	const number = parseNumber;
	const value = number(limit.value);
	if (limit.kind === 'between') {
		const low = number(limit.low);
		if (!Number.isFinite(low) || !Number.isFinite(value)) return 'Enter both numbers of the range.';
		if (low >= value) return 'The first number of the range must be the smaller one.';
		return null;
	}
	if (!Number.isFinite(value)) return 'Enter the limit as a number.';
	return null;
}

/** A number typed by a person (a comma works as the decimal point), or NaN. */
export function parseNumber(text: string): number {
	const t = text.trim().replace(/\s/g, '');
	if (!t) return NaN;
	return Number(t.replace(',', '.'));
}
