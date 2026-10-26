/**
 * A trade study as data, for a CSV or Excel export: the objective (what is
 * maximized or minimized, and the score as written), each criterion with
 * its unit, weight and direction, the scores, ranks and selection, then the
 * alternatives' own values (the inputs the criteria read: `mass`, `price`).
 * Numbers carry every digit a double holds (`exactMagnitude`); the table on
 * screen rounds them for reading, the export doesn't.
 */
import { convert, displayUnit, exactMagnitude } from './quantity';
import type { Evaluated, TradeStudy } from './types';

export const TRADE_EXPORT_HEADER = ['Kind', 'Name', 'Unit', 'Weight', 'Better'];

export function tradeExport(study: TradeStudy): { header: string[]; rows: string[][] } {
	const names = study.alternatives.map((a) => a.name);
	const better = study.objective === 'minimize' ? 'lower' : study.objective ? 'higher' : '';
	const row = (
		kind: string,
		name: string,
		unit: string,
		weight: string,
		dir: string,
		cells: string[]
	) => [kind, name, unit, weight, dir, ...cells];
	const rows: string[][] = [];
	const goal =
		study.objective === 'maximize' ? 'maximize' : study.objective === 'minimize' ? 'minimize' : '';
	rows.push(
		row(
			'objective',
			[goal, study.scoreText ? `score = ${study.scoreText}` : 'score'].filter(Boolean).join(' '),
			'',
			'',
			better,
			names.map(() => '')
		)
	);
	for (const c of study.criteria) {
		const { unit, cells } = column(c.values, c.unit);
		rows.push(
			row(
				'criterion',
				c.name,
				unit,
				c.weight !== null ? exactMagnitude(c.weight) : '',
				c.better ?? '',
				cells
			)
		);
	}
	const scores = column(
		study.alternatives.map((a) => a.score),
		null
	);
	rows.push(row('score', 'score', scores.unit, '', better, scores.cells));
	rows.push(
		row(
			'rank',
			'rank',
			'',
			'',
			'',
			study.alternatives.map((a) => (a.rank !== null ? String(a.rank) : ''))
		)
	);
	rows.push(
		row(
			'selection',
			'selected',
			'',
			'',
			'',
			study.alternatives.map((_, i) =>
				[i === study.selected ? 'selected' : '', i === study.current ? 'in the design' : '']
					.filter(Boolean)
					.join(', ')
			)
		)
	);
	for (const input of study.inputs) {
		const { unit, cells } = column(input.values, null);
		rows.push(row('input', input.name, unit, '', '', cells));
	}
	return { header: [...TRADE_EXPORT_HEADER, ...names], rows };
}

/**
 * A row's values in one unit (`preferred` when they all convert to it, else
 * the first value's), as plain numbers; each with its own unit when they
 * don't convert to one another.
 */
function column(values: Evaluated[], preferred: string | null): { unit: string; cells: string[] } {
	const inUnit = (unit: string | null): string[] | null => {
		const cells = values.map((v) => {
			if (v.kind === 'text') return v.text;
			if (v.kind !== 'number') return '';
			if (v.unit === unit) return exactMagnitude(v.value);
			const converted = v.unit && unit ? convert(v.value, v.unit, unit) : null;
			return converted === null ? null : exactMagnitude(converted);
		});
		return cells.every((c) => c !== null) ? (cells as string[]) : null;
	};
	const first = values.find((v) => v.kind === 'number');
	const firstUnit = first?.kind === 'number' ? first.unit : null;
	for (const unit of preferred ? [preferred, firstUnit] : [firstUnit]) {
		const cells = inUnit(unit);
		if (cells) return { unit: unit ? displayUnit(unit) : '', cells };
	}
	const own = (v: Evaluated) =>
		v.kind === 'number'
			? `${exactMagnitude(v.value)}${v.unit ? ` ${displayUnit(v.unit)}` : ''}`
			: v.kind === 'text'
				? v.text
				: '';
	return { unit: '', cells: values.map(own) };
}
