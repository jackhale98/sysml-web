import type { DiagramNode, DiagramView, EdgeKind } from '#lib/engine/types.ts';

export interface SysmlNodeData extends Record<string, unknown> {
	node: DiagramNode;
	selected: boolean;
	direction: 'DOWN' | 'RIGHT';
	view: DiagramView;
}

export interface SysmlEdgeData extends Record<string, unknown> {
	kind: EdgeKind;
	label: string | null;
}
