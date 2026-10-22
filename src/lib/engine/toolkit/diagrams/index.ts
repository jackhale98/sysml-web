/**
 * `EngineApi.diagram` over the toolkit's model: the eight standard views
 * as `DiagramGraph`s (see each builder for what it draws).
 */
import type { DiagramGraph, DiagramView } from '../../types';
import { DiagramContext, type DiagramInput } from './context';
import { generalView } from './general';
import { interconnectionView } from './interconnection';
import { actionView, stateView } from './behavior';
import { sequenceView } from './sequence';
import { packagesView, requirementsView, traceView } from './trace';

export type { DiagramInput } from './context';

export function buildDiagram(
	input: DiagramInput,
	view: DiagramView,
	scope: string | null,
	added: string[] = []
): DiagramGraph {
	const ctx = new DiagramContext(input);
	switch (view) {
		case 'general':
			return generalView(ctx, scope, added);
		case 'interconnection':
			if (!scope) throw new Error('an interconnection view needs a scope');
			return interconnectionView(ctx, scope);
		case 'states':
			return stateView(ctx, scope);
		case 'actions':
			return actionView(ctx, scope);
		case 'requirements':
			return requirementsView(ctx);
		case 'trace':
			return traceView(ctx);
		case 'packages':
			return packagesView(ctx);
		case 'sequence':
			return sequenceView(ctx, scope);
		default:
			throw new Error(`unknown view ${JSON.stringify(view)}`);
	}
}
