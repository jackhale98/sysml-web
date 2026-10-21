import type { DiagramNode, DiagramView, EdgeKind } from '#lib/engine/types.ts';
import type { Route, XY } from './layout.ts';

export interface SysmlNodeData extends Record<string, unknown> {
	node: DiagramNode;
	selected: boolean;
	direction: 'DOWN' | 'RIGHT';
	view: DiagramView;
	/** The node stands for a model element that can be renamed and connected. */
	editable: boolean;
	/** `ModelElement.key` of the element the node draws, when it is in the model. */
	elementKey: string | null;
	/** The element's name for display, which the label may decorate (`drone : DeliveryDrone`). */
	name: string | null;
}

export interface SysmlEdgeData extends Record<string, unknown> {
	kind: EdgeKind;
	label: string | null;
	/** Drawn from the model's target to its source (the general end first, see `UPWARD`). */
	reversed?: boolean;
	/** ELK's route, valid while the two nodes stay at `from` and `to` (their positions when it was made). */
	route?: Route & { from: XY; to: XY };
}
