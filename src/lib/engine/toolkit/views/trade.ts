/**
 * The `trade` row provider: a trade study as a table, one row per
 * criterion (the evaluation function's attributes), then the score and the
 * rank, with one column per alternative (the `alternatives` column group).
 * Each row carries the study (`trade.ts`), which the table renders as a
 * comparison; a view shows one study, the first it exposes.
 */
import type { TradeStudy } from '../../types';
import { formatMagnitude } from '../../quantity';
import { percent } from './budget';
import type { ViewContext } from './context';
import type { Row } from './rows';

export function tradeRows(ctx: ViewContext): Row[] {
	return ctx.tradeStudies().flatMap((study) => rowsOf(ctx, study));
}

function rowsOf(ctx: ViewContext, study: TradeStudy): Row[] {
	const names = study.alternatives.map((a) => a.name);
	const groups = { alternatives: names };
	const rows: Row[] = [];
	const base = (criterion: string, file: string, line: number, extra: [string, string][]) =>
		new Map<string, string>([
			['study', study.name],
			['criterion', criterion],
			...extra,
			['file', file],
			['line', String(line)]
		]);
	for (const c of study.criteria) {
		const fields = base(c.name, c.file, c.line, [
			['weight', c.weight !== null ? percent(c.weight) : ''],
			['better', c.better ?? '']
		]);
		names.forEach((name, i) => fields.set(name, c.shown[i] ?? ''));
		const notes: Record<string, string> = {};
		c.values.forEach((v, i) => {
			if (v.kind === 'undecided') notes[names[i]!] = `not computed: ${v.reason}`;
		});
		rows.push({
			fields,
			anchors: [study.elementId, ...(c.elementId ? [c.elementId] : [])],
			element: (c.elementId && ctx.byId.get(c.elementId)?.qualifiedName) || '',
			groups,
			trade: study,
			...(Object.keys(notes).length ? { info: { notes } } : {})
		});
	}
	const score = base('score', study.file, study.line, [
		['weight', ''],
		['better', study.objective === 'minimize' ? 'lower' : study.objective ? 'higher' : '']
	]);
	const rank = base('rank', study.file, study.line, [
		['weight', ''],
		['better', '']
	]);
	const notes: Record<string, string> = {};
	study.alternatives.forEach((a, i) => {
		score.set(names[i]!, a.score.kind === 'number' ? formatMagnitude(a.score.value) : '');
		rank.set(names[i]!, a.rank !== null ? String(a.rank) : '');
		if (a.score.kind === 'undecided') notes[names[i]!] = `not computed: ${a.score.reason}`;
	});
	for (const fields of [score, rank])
		rows.push({
			fields,
			anchors: [study.elementId],
			element: study.qualifiedName,
			groups,
			trade: study,
			info: { role: 'total', ...(fields === score && Object.keys(notes).length ? { notes } : {}) }
		});
	return rows;
}
