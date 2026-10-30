/**
 * The `variability` row provider: one row per configuration of the model
 * (`variability.ts`), with one column per variation point (the
 * `variationPoints` column group) holding the variant it chooses. A choice
 * that is missing, isn't one of the point's variants, or is made twice is
 * the cell's problem.
 */
import type { ViewContext } from './context';
import type { Row } from './rows';

export function variabilityRows(ctx: ViewContext): Row[] {
	const { configurations } = ctx.variability.summary();
	// One column per point the configurations choose for; a name two product lines share is told apart.
	const points = new Map<string, { name: string; line: string }>();
	for (const c of configurations)
		for (const ch of c.choices) {
			const point = ctx.byId.get(ch.pointId);
			const owner = point?.ownerId ? ctx.byId.get(point.ownerId) : undefined;
			points.set(ch.pointId, { name: ch.point, line: owner?.name ?? '' });
		}
	const named = new Map<string, string>();
	for (const [id, p] of points) {
		const shared = [...points.values()].filter((q) => q.name === p.name).length > 1;
		named.set(id, shared && p.line ? `${p.line}.${p.name}` : p.name);
	}
	const groups = { variationPoints: [...new Set(named.values())] };
	return configurations.map((c) => {
		const fields = new Map<string, string>([
			['configuration', c.name],
			['productLine', c.productLines.map((l) => l.split('::').pop()).join(', ')],
			['product', c.product.split('::').pop() ?? ''],
			['doc', c.doc ?? '']
		]);
		const problems: Record<string, string> = {};
		for (const ch of c.choices) {
			const column = named.get(ch.pointId)!;
			fields.set(column, ch.variant ?? '');
			if (ch.problem) problems[column] = ch.problem;
		}
		for (const column of groups.variationPoints) if (!fields.has(column)) fields.set(column, '');
		fields.set('file', c.file);
		fields.set('line', String(c.line));
		return {
			fields,
			anchors: [c.id],
			element: c.qualifiedName,
			groups,
			...(Object.keys(problems).length ? { info: { problems } } : {})
		};
	});
}
