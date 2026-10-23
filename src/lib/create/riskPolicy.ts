/**
 * "Risk policy": the organisation's risk rules, written into the project's
 * risk library as SysML a person can read and another tool can evaluate:
 *
 * - The acceptability zones as the `Acceptability` calc: the severities
 *   with the same zones form a band, and each band gives its zones by
 *   thresholds of likelihood, as nested `if … ? … else …` (the shape of
 *   `ActionPriority`). Its doc says the same in plain words.
 *
 *       return : RiskAcceptability =
 *           if severity >= 9 ?
 *               (if likelihood >= 4 ? RiskAcceptability::unacceptable
 *                else if likelihood >= 2 ? RiskAcceptability::reduce
 *                else RiskAcceptability::acceptable)
 *           else …;
 *
 * - The RPN bands as the thresholds of `RpnBand` (`attribute highFrom :
 *   Integer = 151;`).
 * - Which figure the worksheets lead with: the order of their action
 *   priority and RPN columns, and their `sortBy`.
 *
 * Pure text in, text out, so the form's output can be tested and checked
 * with the toolkit.
 */
import { docComment, name as sysmlName, skipTrivia } from './sysml';
export { ZONE_WORDS } from '#lib/workbench/risk.ts';

/** `zones[severity - 1][likelihood - 1]`: a level of the policy (`acceptable`, `reduce`, `unacceptable`). */
export type Zones = string[][];

/** The zones, lowest first, as the library declares them. */
export const ZONE_LEVELS = ['acceptable', 'reduce', 'unacceptable'] as const;

/** The library's default: per severity band, the likelihood from which a risk is in each zone. */
const DEFAULT_RULES: { from: number; reduce: number; unacceptable: number }[] = [
	{ from: 9, reduce: 2, unacceptable: 4 },
	{ from: 7, reduce: 3, unacceptable: 6 },
	{ from: 4, reduce: 5, unacceptable: 8 },
	{ from: 2, reduce: 8, unacceptable: 11 },
	{ from: 1, reduce: 11, unacceptable: 11 }
];

/** The default policy, as the library ships it. */
export const DEFAULT_ZONES: Zones = Array.from({ length: 10 }, (_, s) => {
	const rule = DEFAULT_RULES.find((r) => s + 1 >= r.from)!;
	return Array.from({ length: 10 }, (_, l) =>
		l + 1 >= rule.unacceptable ? 'unacceptable' : l + 1 >= rule.reduce ? 'reduce' : 'acceptable'
	);
});

/** The default RPN band thresholds: where medium, high and critical start. */
export const DEFAULT_BANDS: readonly { name: string; value: number }[] = [
	{ name: 'mediumFrom', value: 51 },
	{ name: 'highFrom', value: 151 },
	{ name: 'criticalFrom', value: 401 }
];

export type Lead = 'rpn' | 'actionPriority';

/** A run of likelihoods (or severities) with one zone: `lo` to `hi`. */
interface Run {
	lo: number;
	hi: number;
	zone: string;
}

/** A row's runs of likelihood, highest first. */
function runs(row: readonly string[]): Run[] {
	const out: Run[] = [];
	for (let l = row.length; l >= 1; l--) {
		const zone = row[l - 1]!;
		const last = out[out.length - 1];
		if (last && last.zone === zone) last.lo = l;
		else out.push({ lo: l, hi: l, zone });
	}
	return out;
}

/** The severities with the same zones, highest first: `[{ from, to, row }]`. */
function bands(zones: Zones): { lo: number; hi: number; row: string[] }[] {
	const out: { lo: number; hi: number; row: string[] }[] = [];
	for (let s = zones.length; s >= 1; s--) {
		const row = zones[s - 1]!;
		const last = out[out.length - 1];
		if (last && last.row.join() === row.join()) last.lo = s;
		else out.push({ lo: s, hi: s, row: [...row] });
	}
	return out;
}

const range = (lo: number, hi: number) => (lo === hi ? `${lo}` : `${lo} to ${hi}`);

/** The policy in plain words, one line per band of severities. */
export function zoneWords(zones: Zones): string[] {
	return bands(zones).map((band, i, all) => {
		const parts = runs(band.row).map((r, j, rs) =>
			rs.length === 1 ? r.zone : `${r.zone} at ${j === 0 ? 'likelihood ' : ''}${range(r.lo, r.hi)}`
		);
		return `severity ${range(band.lo, band.hi)}: ${parts.join(', ')}${i === all.length - 1 ? '.' : ';'}`;
	});
}

/** `calc def Acceptability { … }`, indented by `indent`, as the library writes it. */
export function acceptabilityText(
	zones: Zones,
	indent = '    ',
	enumName = 'RiskAcceptability'
): string {
	const literal = (zone: string) => `${enumName}::${sysmlName(zone)}`;
	const pad = `${indent}        `;
	const rowExpr = (row: string[], at: string): string => {
		const rs = runs(row);
		if (rs.length === 1) return literal(rs[0]!.zone);
		const lines = rs.map((r, j) =>
			j === rs.length - 1
				? `${at} else ${literal(r.zone)})`
				: `${j ? `${at} else ` : '('}if likelihood >= ${r.lo} ? ${literal(r.zone)}`
		);
		return lines.join('\n');
	};
	const bs = bands(zones);
	let body: string;
	if (bs.length === 1) {
		const expr = rowExpr(bs[0]!.row, pad);
		body = expr.includes('\n') ? `\n${pad}${expr}` : ` ${expr}`;
	} else {
		const lines: string[] = [];
		bs.forEach((b, i) => {
			const last = i === bs.length - 1;
			const head = last ? `${pad}else` : `${pad}${i ? 'else ' : ''}if severity >= ${b.lo} ?`;
			const expr = rowExpr(b.row, `${pad}    `);
			if (expr.includes('\n')) lines.push(head, `${pad}    ${expr}`);
			else lines.push(`${head} ${expr}`);
		});
		body = `\n${lines.join('\n')}`;
	}
	const words = zoneWords(zones).map((w) => `${indent}     *   ${w}`);
	return [
		`${indent}calc def Acceptability {`,
		`${indent}    doc`,
		`${indent}    /*`,
		`${indent}     * The risk policy: how acceptable a risk is, by its severity and`,
		`${indent}     * its likelihood (the zones of the risk matrix). It is the`,
		`${indent}     * organisation's choice; change it here or with the app's Risk`,
		`${indent}     * policy form. In plain words:`,
		...words,
		`${indent}     */`,
		`${indent}    in severity : FmeaRating;`,
		`${indent}    in likelihood : FmeaRating;`,
		`${indent}    return : ${enumName} =${body};`,
		`${indent}}`
	].join('\n');
}

/** `enum def RiskAcceptability { … }`, for a library that lacks it. */
function acceptabilityEnumText(indent: string): string {
	return [
		`${indent}enum def RiskAcceptability {`,
		`${indent}    ${docComment('How acceptable a risk is (ISO 14971), lowest first: acceptable; reduce (as far as possible, then weigh what remains against the benefit); unacceptable (reduce it before release).')}`,
		...ZONE_LEVELS.map((z) => `${indent}    enum ${z};`),
		`${indent}}`
	].join('\n');
}

/** `calc def RpnBand { … }` and its levels, for a library that lacks them. */
function rpnBandText(
	indent: string,
	thresholds: readonly { name: string; value: number }[]
): string {
	const levels = ['low', ...thresholds.map((t) => t.name.replace(/From$/, ''))];
	const lines = [
		`${indent}enum def RpnBandLevel {`,
		`${indent}    doc /* Where a risk priority number falls, lowest first. */`,
		...levels.map((l) => `${indent}    enum ${l};`),
		`${indent}}`,
		'',
		`${indent}calc def RpnBand {`,
		`${indent}    ${docComment('The band of a risk priority number: each band starts at its threshold below. The thresholds are the organisation’s choice.')}`,
		`${indent}    in rpn : Integer;`,
		...thresholds.map((t) => `${indent}    attribute ${t.name} : Integer = ${t.value};`),
		`${indent}    return : RpnBandLevel =`
	];
	const ordered = [...thresholds].reverse();
	ordered.forEach((t, i) =>
		lines.push(
			`${indent}        ${i ? 'else ' : ''}if rpn >= ${t.name} ? RpnBandLevel::${t.name.replace(/From$/, '')}`
		)
	);
	lines.push(`${indent}        else RpnBandLevel::low;`, `${indent}}`);
	return lines.join('\n');
}

/** A declaration found in the text: from its line's start to its closing `}`. */
interface Block {
	/** Where its line starts. */
	start: number;
	/** Where its keyword starts. */
	at: number;
	/** Just past its closing `}`. */
	end: number;
	indent: string;
}

/** The first declaration matching `header` (a sticky regex) outside comments and strings. */
export function findBlock(text: string, header: RegExp, from = 0, to = text.length): Block | null {
	const sticky = new RegExp(header.source, 'y');
	for (let i = from; i < to; i++) {
		const skip = skipTrivia(text, i);
		if (skip !== i) {
			i = skip - 1;
			continue;
		}
		if (/[\w']/.test(text[i - 1] ?? ' ')) continue;
		sticky.lastIndex = i;
		if (!sticky.test(text)) continue;
		let depth = 0;
		for (let j = sticky.lastIndex; j < text.length; j++) {
			const past = skipTrivia(text, j);
			if (past !== j) {
				j = past - 1;
				continue;
			}
			const c = text[j];
			if (c === ';' && depth === 0) return null;
			if (c === '{') depth++;
			else if (c === '}' && --depth === 0) {
				const start = text.lastIndexOf('\n', i) + 1;
				return { start, at: i, end: j + 1, indent: /^[ \t]*/.exec(text.slice(start))![0] };
			}
		}
		return null;
	}
	return null;
}

export interface PolicyChange {
	zones?: Zones;
	/** New values of `RpnBand`'s thresholds, by attribute name. */
	bands?: readonly { name: string; value: number }[];
	lead?: Lead;
}

/** The worksheets whose figures the lead orders. */
const WORKSHEETS = [
	'FmeaWorksheet',
	'DesignFmeaWorksheet',
	'ProcessFmeaWorksheet',
	'UseFmeaWorksheet',
	'FmeaRiskReduction'
];

/**
 * The risk library's text with the policy changed: the `Acceptability`
 * calc rewritten from the zones, `RpnBand`'s thresholds set, and the
 * worksheets ordered by the lead. A library without the calcs gets them,
 * before its worksheets.
 */
export function withPolicy(text: string, change: PolicyChange): string {
	let out = text;
	// Where missing definitions go: before the worksheets, else at the end of the package.
	const insertAt = (t: string): { at: number; indent: string } => {
		const marker = /\n([ \t]*)\/\/ --- Worksheets/.exec(t);
		if (marker) return { at: marker.index + 1, indent: marker[1]! };
		const pkg = findBlock(t, /package\s+RiskAnalysis\b/);
		const at = pkg ? t.lastIndexOf('}', pkg.end - 1) : t.length;
		return { at: t.lastIndexOf('\n', at - 1) + 1, indent: `${pkg?.indent ?? ''}    ` };
	};
	if (change.zones) {
		const calc = findBlock(out, /calc\s+def\s+Acceptability\b/);
		if (calc)
			out =
				out.slice(0, calc.start) +
				acceptabilityText(change.zones, calc.indent) +
				out.slice(calc.end);
		else {
			const { at, indent } = insertAt(out);
			const parts = [
				...(findBlock(out, /enum\s+def\s+RiskAcceptability\b/)
					? []
					: [acceptabilityEnumText(indent)]),
				acceptabilityText(change.zones, indent)
			];
			out = `${out.slice(0, at)}${parts.join('\n\n')}\n\n${out.slice(at)}`;
		}
	}
	if (change.bands) {
		const calc = findBlock(out, /calc\s+def\s+RpnBand\b/);
		if (calc) {
			let block = out.slice(calc.start, calc.end);
			for (const b of change.bands)
				block = block.replace(
					new RegExp(`(attribute\\s+${b.name}\\s*:\\s*[\\w:]+\\s*=\\s*)-?\\d+(\\s*;)`),
					`$1${Math.round(b.value)}$2`
				);
			out = out.slice(0, calc.start) + block + out.slice(calc.end);
		} else {
			const { at, indent } = insertAt(out);
			out = `${out.slice(0, at)}${rpnBandText(indent, change.bands)}\n\n${out.slice(at)}`;
		}
	}
	if (change.lead)
		for (const view of WORKSHEETS)
			out = withLead(out, view, change.lead, view !== 'FmeaRiskReduction');
	return out;
}

/** A worksheet view def sorted by the lead, with its figures in the lead's order (`reorder`). */
function withLead(text: string, view: string, lead: Lead, reorder: boolean): string {
	const block = findBlock(text, new RegExp(`view\\s+def\\s+${view}\\b`));
	if (!block) return text;
	let body = text.slice(block.start, block.end);
	if (reorder)
		body = body.replace(
			/(\bcolumns\s*=\s*")((?:[^"\\]|\\.)*)(")/,
			(_, open: string, columns: string, close: string) => {
				return `${open}${orderColumns(columns, lead)}${close}`;
			}
		);
	const sort = lead === 'actionPriority' ? '-actionPriority; -rpn' : '-rpn';
	body = body.replace(/(\bsortBy\s*=\s*")(?:[^"\\]|\\.)*(")/, `$1${sort}$2`);
	return text.slice(0, block.start) + body + text.slice(block.end);
}

/**
 * The column list with the action priority before the RPN, or after it (and
 * after its band, when the band follows it); a list already in the lead's
 * order is left as it is.
 */
export function orderColumns(columns: string, lead: Lead): string {
	const items = columns.split(';').map((c) => c.trim());
	const name = (c: string) => c.split('=')[0]!.trim();
	const at = (n: string) => items.findIndex((c) => name(c) === n);
	const priority = at('actionPriority');
	const rpn = at('rpn');
	if (priority < 0 || rpn < 0) return columns;
	if (priority < rpn === (lead === 'actionPriority')) return columns;
	const [moved] = items.splice(priority, 1);
	if (lead === 'actionPriority') items.splice(at('rpn'), 0, moved!);
	else {
		const band = at('rpnBand');
		items.splice((band === at('rpn') + 1 ? band : at('rpn')) + 1, 0, moved!);
	}
	return items.filter(Boolean).join('; ');
}
