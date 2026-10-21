/**
 * Table cells as SysML values: what a field's values look like (an enum
 * literal, a list of them, a number, text) and how a person's cell text is
 * written as SysML — `low` as `Priority::low`, `test, analysis` as
 * `(VerificationMethod::test, VerificationMethod::'analysis')`, `1150` into
 * `1100 [g]` as `1150 [g]`, text as a string literal.
 */
import { formatName, stringLiteral, unquote } from './header';

export type ValueKind = 'text' | 'longText' | 'enum' | 'number' | 'enumList';

/** A table column's field: `name`, `shortName`, `doc`, `feature:x` or `metadata:T.x`. */
export type FieldSpec =
	| { kind: 'name' }
	| { kind: 'shortName' }
	| { kind: 'doc' }
	| { kind: 'feature'; feature: string }
	| { kind: 'metadata'; type: string; field: string };

export function parseFieldSpec(spec: string): FieldSpec {
	const s = spec.trim();
	const bad = () =>
		new Error(
			`unknown field \`${s}\` (expected name, shortName, doc, feature:<name> or metadata:<Type>.<field>)`
		);
	if (s === 'name' || s === 'shortName' || s === 'doc') return { kind: s };
	if (s.startsWith('feature:')) {
		const feature = unquote(s.slice('feature:'.length).trim());
		if (!feature) throw bad();
		return { kind: 'feature', feature };
	}
	if (s.startsWith('metadata:')) {
		const rest = s.slice('metadata:'.length);
		const dot = rest.lastIndexOf('.');
		if (dot < 0) throw bad();
		const type = unquote(rest.slice(0, dot).trim());
		const field = unquote(rest.slice(dot + 1).trim());
		if (!type || !field) throw bad();
		return { kind: 'metadata', type, field };
	}
	throw bad();
}

/** What a field's values are. */
export interface FieldType {
	kind?: ValueKind;
	/** How the enum def that qualifies a literal is spelled (`Priority`). */
	enumType?: string;
	/** Enum literals: [display name, name as written (`'analysis'`)]. */
	literals: [string, string][];
}

export const fieldType = (kind?: ValueKind): FieldType => ({
	...(kind ? { kind } : {}),
	literals: []
});

const QUALIFIED =
	/^(?:[\p{L}_][\p{L}\p{N}_]*|'(?:[^'\\]|\\.)+')(?:::(?:[\p{L}_][\p{L}\p{N}_]*|'(?:[^'\\]|\\.)+'))*$/u;

/**
 * What a value written in the source says about its type: a string, a
 * number, a boolean, an enum literal (`Kind::x`, giving the qualifier as
 * written) or a list of them.
 */
export function classifyValueText(text: string): FieldType {
	const t = text.trim();
	if (t.startsWith('"')) return fieldType('text');
	if (t === 'true' || t === 'false')
		return {
			kind: 'enum',
			literals: [
				['true', 'true'],
				['false', 'false']
			]
		};
	const number = t.split('[')[0]!.trim();
	if (number && isNumber(number)) return fieldType('number');
	const inner = t.startsWith('(') && t.endsWith(')') ? t.slice(1, -1) : null;
	const first = (inner === null ? t : (inner.split(',')[0] ?? '')).trim();
	const cut = first.lastIndexOf('::');
	if (cut > 0 && QUALIFIED.test(first)) {
		return {
			kind: inner === null ? 'enum' : 'enumList',
			enumType: first.slice(0, cut),
			literals: []
		};
	}
	return fieldType();
}

const isNumber = (s: string) => s !== '' && Number.isFinite(Number(s));

/**
 * How to write a value: the resolved type, refined by the value it replaces
 * (an enum keeps the qualifier it is written with).
 */
export function effectiveType(resolved: FieldType | null, existing: string | null): FieldType {
	const ty: FieldType = resolved
		? { ...resolved, literals: [...resolved.literals] }
		: { literals: [] };
	const ex = existing === null ? null : classifyValueText(existing);
	if (ex?.kind) {
		ty.kind ??= ex.kind;
		if (ex.enumType) ty.enumType = ex.enumType;
	}
	return ty;
}

/** One enum literal as SysML text, checked against the known literals. */
function enumLiteral(ty: FieldType, value: string): string {
	// A qualified value (`Priority::low`, as annotation rows show it) names its literal last.
	const v = value.trim();
	const lit = (v.split('::').pop() ?? v).trim();
	let written: string;
	if (!ty.literals.length) written = formatName(unquote(lit));
	else {
		const hit = ty.literals.find(([display, w]) => display === unquote(lit) || w === lit);
		if (!hit) {
			const names = ty.literals.map(([d]) => d).join(', ');
			throw new Error(
				`\`${lit}\` is not one of ${ty.enumType ? `${ty.enumType}'s literals: ` : ''}${names}`
			);
		}
		written = hit[1];
	}
	return ty.enumType ? `${ty.enumType}::${written}` : written;
}

/** A cell value as SysML text of the given type. */
export function formatValue(ty: FieldType, value: string): string {
	const v = value.trim();
	switch (ty.kind) {
		case 'enum':
			return enumLiteral(ty, v);
		case 'enumList': {
			const items = v
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean)
				.map((s) => enumLiteral(ty, s));
			return items.length === 1 ? items[0]! : `(${items.join(', ')})`;
		}
		case 'number': {
			const number = v.split('[')[0]!.trim();
			if (!isNumber(number)) throw new Error(`\`${v}\` is not a number`);
			return v;
		}
		case 'text':
		case 'longText':
			return stringLiteral(v);
		default:
			// Nothing says: a number or boolean as typed, anything else as a string.
			return isNumber(v) || v === 'true' || v === 'false' ? v : stringLiteral(v);
	}
}

/**
 * The expression that replaces `existing`: a bare number replacing a
 * number with a unit keeps the unit (`1100 [g]` + `1150` → `1150 [g]`).
 */
export function replacementValue(ty: FieldType, existing: string, value: string): string {
	const v = value.trim();
	if (ty.kind === 'number' && isNumber(v)) {
		const m = /^([-+]?[0-9][0-9.eE+-]*)(\s*\[[^]*\])$/.exec(existing.trim());
		if (m && isNumber(m[1]!)) return v + m[2]!;
	}
	return formatValue(ty, value);
}
