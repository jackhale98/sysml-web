import type { DiagramNode, DiagramView, EdgeKind } from '#lib/engine/types.ts';

export interface SysmlNodeData extends Record<string, unknown> {
	node: DiagramNode;
	selected: boolean;
	direction: 'DOWN' | 'RIGHT';
	view: DiagramView;
	/** The node stands for a model element that can be renamed and connected. */
	editable: boolean;
}

export interface SysmlEdgeData extends Record<string, unknown> {
	kind: EdgeKind;
	label: string | null;
}
