<script lang="ts">
	import {
		Background,
		ConnectionMode,
		Controls,
		Panel,
		SvelteFlow,
		ViewportPortal,
		getViewportForBounds,
		type Edge,
		type Node,
		type NodeTypes,
		type EdgeTypes
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { untrack } from 'svelte';
	import {
		ArrowRight,
		Cable,
		CircleDot,
		CircleStop,
		CopyPlus,
		EyeOff,
		FileCode,
		LayoutGrid,
		ListTodo,
		Network,
		Pencil,
		Play,
		Plus,
		Shapes,
		Spline,
		Trash2,
		Unlink,
		Waypoints
	} from '@lucide/svelte';
	import type { Engine } from '#lib/engine/client.ts';
	import type { DiagramGraph, DiagramView } from '#lib/engine/types.ts';
	import type { ModelElement } from '#lib/project/elements.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import { theme } from '#lib/ui/theme.svelte.ts';
	import { toasts } from '#lib/ui/toasts.svelte.ts';
	import {
		addElement,
		applySteps,
		deleteElement,
		deleteImpact,
		duplicateElement,
		renameElement,
		undoable
	} from '#lib/workbench/actions.ts';
	import AddForm from '#lib/workbench/AddForm.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import { canOwnMembers, formatName, type AddKind } from '#lib/workbench/templates.ts';
	import type { WorkbenchUi } from '#lib/workbench/ui.svelte.ts';
	import ConnectPicker, { type ConnectTarget } from './ConnectPicker.svelte';
	import ConnectedForm from './ConnectedForm.svelte';
	import { planDuplicate } from './duplicate.ts';
	import DiagramExport from './DiagramExport.svelte';
	import { DiagramEditing, provideEditing } from './editing.svelte.ts';
	import FlowBridge, { type FlowApi } from './FlowBridge.svelte';
	import { LABEL_HEIGHT, labelWidth, provideLabels } from './labels.svelte.ts';
	import {
		edgeText,
		layout,
		MAX_NODES,
		nodeSize,
		UPWARD,
		type Direction,
		type Layout
	} from './layout.ts';
	import { ownersOf, qualifiedName, resolveNode } from './model.ts';
	import BehaviorAddForm, { type BehaviorAddChoice } from './BehaviorAddForm.svelte';
	import BranchForm from './BranchForm.svelte';
	import FormPanel from './FormPanel.svelte';
	import HiddenPanel from './HiddenPanel.svelte';
	import StateActionsForm from './StateActionsForm.svelte';
	import TransitionForm from './TransitionForm.svelte';
	import {
		branchGuard,
		CONTROL_WORDS,
		flowStarts,
		isBehavior,
		isFlowNode,
		isState,
		planAddFlowNode,
		planAddState,
		planAddValue,
		planEditBranch,
		planEditTransition,
		planRemoveEdge,
		planRemoveNode,
		planSetStart,
		planStateAction,
		planSuccession,
		planTransition,
		readTransition,
		signalChoices,
		startOf,
		stateActions,
		suggestName,
		valuesAround,
		type EdgeSource,
		type FlowEnd,
		type TransitionSpec
	} from './behaviorEdits.ts';
	import NodeMenu, { type MenuItem } from './NodeMenu.svelte';
	import {
		LAYOUT_FILE,
		NOTHING_CHANGED,
		diagramKey,
		freeSpot,
		parseLayout,
		parseShown,
		placeAround,
		renamedNode,
		serializeLayout,
		withPositions,
		withShown,
		type DiagramShown,
		type XY
	} from './positions.ts';
	import RelationPopover from './RelationPopover.svelte';
	import {
		planEdgeRemoval,
		relationsFor,
		type ModelContext,
		type Plan,
		type RelationOption
	} from './relationships.ts';
	import SysmlEdge from './SysmlEdge.svelte';
	import {
		chooseNeighbours,
		neighbours,
		wiredNeighbours,
		planExpose,
		planUnexpose,
		planViewAs,
		viewAsChoices,
		withoutHidden,
		type NeighbourElement,
		type StandardView
	} from './viewEdits.ts';
	import { exposedName, presentationOf } from '#lib/workbench/views.ts';
	import SysmlNode from './SysmlNode.svelte';
	import type { SysmlEdgeData, SysmlNodeData } from './types.ts';
	import { MARK_WORDS, reviewMarks, type ReviewMark } from '#lib/review/marks.svelte.ts';

	let {
		view,
		scope,
		viewName,
		workspace,
		ui,
		engine,
		label
	}: {
		view: DiagramView;
		scope: string | null;
		/** The saved view drawn, when it is one: it can be shown as another kind of view. */
		viewName?: string;
		workspace: Workspace;
		ui: WorkbenchUi;
		engine: Engine;
		label: string;
	} = $props();

	const nodeTypes: NodeTypes = { sysml: SysmlNode };
	const edgeTypes: EdgeTypes = { sysml: SysmlEdge };
	const reducedMotion =
		typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
	const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
	const FIT = { padding: 0.15, maxZoom: 1.1 };
	/**
	 * On a narrow screen, the least zoom a whole diagram is fitted at: below it
	 * the labels are too small to read, so the diagram opens at this zoom from
	 * its top (and its left, when wider than the screen) and is panned instead.
	 * After an edit it opens on what the edit drew.
	 */
	const READABLE_ZOOM = 0.65;
	const NARROW = 640;

	let nodes = $state.raw<Node<SysmlNodeData>[]>([]);
	let edges = $state.raw<Edge<SysmlEdgeData>[]>([]);
	let status = $state<'loading' | 'ready' | 'error' | 'too-large'>('loading');
	let message = $state('');
	let popover = $state<'add' | 'rename' | null>(null);
	let renameTo = $state('');
	let actionError = $state<string | null>(null);
	/** The nodes this diagram hides (that its scope would draw), with their names. */
	let hiddenHere = $state.raw<{ id: string; label: string; key: string | null }[]>([]);
	/** The diagram frame's name, as SysML writes it: "gv [Scope]". */
	let frameTitle = $state('');
	let timer: ReturnType<typeof setTimeout> | undefined;
	let generation = 0;
	let flow: FlowApi | null = null;
	let host: HTMLDivElement;
	let hostWidth = $state(800);
	let toolbarWidth = $state(0);
	let toolbarHeight = $state(0);
	/** Room beside the toolbar for the diagram frame's name; when too little, it goes below. */
	const frameRoom = $derived(hostWidth - toolbarWidth - 44);
	const frameBelow = $derived(frameRoom < 112);

	/** Where the person last clicked on the empty canvas (flow coordinates). */
	let lastClick = $state<XY | null>(null);
	/** A new element "Add" should place at a point, matched by name when it appears. */
	let pendingPlace: { name: string; at: XY; until: number } | null = null;
	/** A new element to select once the model has it. */
	let pendingSelect = $state<{ name: string; owner: string } | null>(null);

	let menu = $state<{
		title: string;
		items: MenuItem[];
		x: number;
		y: number;
		focus?: string;
	} | null>(null);
	let relation = $state<{
		source: string;
		target: string;
		sourceId?: string;
		options: RelationOption[];
		x: number;
		y: number;
	} | null>(null);
	let confirm = $state<{
		title: string;
		detail: string;
		/** What else changes, once it is known ("Checking…" until then). */
		impact?: string;
		statement?: string;
		action: string;
		run: () => Promise<string | null>;
		focus?: string;
	} | null>(null);
	let confirmError = $state<string | null>(null);

	const labels = provideLabels();
	// Labels keep clear of nodes, wherever they are dragged.
	$effect(() => {
		labels.setObstacles(
			nodes.map((n) => ({
				x: n.position.x,
				y: n.position.y,
				width: n.width ?? 0,
				height: n.height ?? 0
			}))
		);
	});

	/** The last automatic layout, reused while the graph and its node sizes stay the same. */
	let lastLayout: { key: string; result: Layout } | null = null;
	async function autoLayout(graph: DiagramGraph, direction: Direction): Promise<Layout> {
		const key = JSON.stringify([
			direction,
			view,
			graph.nodes.map((n) => [n.id, nodeSize(n, view)]),
			graph.edges
		]);
		if (lastLayout?.key === key) return lastLayout.result;
		const result = await layout(graph, direction, view);
		lastLayout = { key, result };
		return result;
	}

	const editing = provideEditing(
		new DiagramEditing({
			rename: (id, name) => {
				const element = elementOf(id);
				return element
					? renameElement(workspace, element, name)
					: Promise.resolve('This node is not an element of the model.');
			},
			menu: (id, point) => openNodeMenu(id, point),
			editEdge: (id, point) => void editEdge(id, point)
		})
	);

	const owners = $derived(ownersOf(workspace.tree));
	const ctx: ModelContext = $derived({
		elements: workspace.elements,
		owners,
		textOf: (path: string) => workspace.text(path),
		analyses: Object.values(workspace.analyses)
	});

	const selected: ModelElement | undefined = $derived(
		workspace.elements.find((e) => e.key === ui.selection?.key)
	);
	/** The element the diagram is about (its scope), when it is in the model. */
	const scopeElement = $derived(
		scope ? workspace.elements.find((e) => e.name === scope && e.isDefinition) : undefined
	);
	/** Where "Add" puts new elements: the selection if it can own them, else the scope. */
	const owner = $derived(
		selected && canOwnMembers(selected.kind, selected.isDefinition) ? selected : scopeElement
	);
	const ownerKinds: AddKind[] = $derived(
		owner?.kind === 'package'
			? ['part def', 'port def', 'item def', 'requirement', 'action def', 'state def', 'package']
			: ['part', 'port', 'attribute', 'action', 'requirement']
	);
	/** The node that draws the selected element, if this diagram shows it. */
	const selectedNode = $derived(nodes.find((n) => n.data.selected));

	/** The selection a click on the canvas dismissed the highlight for (it stays selected). */
	let dismissed = $state<string | null>(null);
	// The selected node's connections are highlighted, and the nodes they reach ringed.
	$effect(() => {
		const fromSelection = selectedNode && selected?.key !== dismissed ? selectedNode.id : null;
		const focus = nodes.find((n) => n.selected)?.id ?? fromSelection;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- replaced whole, never mutated
		const linked = new Set<string>();
		if (focus)
			for (const e of edges) {
				if (e.source === focus) linked.add(e.target);
				else if (e.target === focus) linked.add(e.source);
			}
		linked.delete(focus ?? '');
		editing.focus = focus;
		editing.linked = linked;
	});

	/** Node ids are names, or dotted paths (`drone.battery`) for nested usages. */
	const nameOf = (id: string) => id.slice(id.lastIndexOf('.') + 1);
	const layoutKey = $derived(diagramKey(view, scope));

	/** On a state diagram, the machine it draws, so it can be run. */
	const runnable = $derived(
		view === 'states'
			? workspace.machines.find((m) => m.name === scope || m.qualifiedName === scope)
			: undefined
	);

	// ---- Behaviour: state machines and action flows are drawn, not only shown ----

	/** State and action diagrams: states, transitions, steps and successions are drawn here. */
	const behavior = $derived(view === 'states' || view === 'actions');
	/** The machine or action the diagram draws. */
	const subject = $derived.by(() => {
		if (!behavior || !scope) return undefined;
		const fits = workspace.elements.filter(
			(e) =>
				isBehavior(e) &&
				!isLibrary(e) &&
				(e.name === scope || e.label === scope || qualifiedName(e, owners) === scope)
		);
		return fits.find((e) => e.isDefinition) ?? fits[0];
	});
	/** Whether `e` is `root` or inside it. */
	function within(e: ModelElement, root: ModelElement | undefined): boolean {
		for (let at: ModelElement | undefined = e; at; at = owners.get(at.key)) {
			if (at.key === root?.key) return true;
		}
		return false;
	}
	/** Where Add puts a new state or step: the machine, or (a nested state) the selected state. */
	const behaviorOwners = $derived.by(() => {
		if (!subject) return [];
		const inside =
			view === 'states' && selected && isState(selected) && within(selected, subject)
				? [selected]
				: [];
		return [subject, ...inside];
	});
	/** Add, opened from a state's menu, puts the new state inside it. */
	let addInside = $state<string | null>(null);
	/** Where the toolbar's Add puts things. */
	const addOwner = $derived(behavior ? subject : owner);

	function elementOf(id: string): ModelElement | undefined {
		const node = nodes.find((n) => n.id === id);
		if (node?.data.elementKey) {
			const known = workspace.elements.find((e) => e.key === node.data.elementKey);
			// Until the diagram is drawn again after an edit, a key may name what is now
			// at that place in the text: only trust it while the names agree.
			const named = (e: ModelElement) =>
				id === e.name || id.endsWith(`.${e.name}`) || id.endsWith(`::${e.name}`);
			if (known && named(known)) return known;
		}
		return resolveNode(id, node?.data.node.is_definition, scope, workspace.elements, owners);
	}

	const isLibrary = (e: ModelElement) => e.file.startsWith('libraries/');

	/**
	 * Interconnection views read left to right. Trees go top-down unless a
	 * node has many children (parts, or specializations under a supertype),
	 * which would make one very wide row.
	 */
	function directionFor(graph: DiagramGraph): Direction {
		if (view === 'interconnection') return 'RIGHT';
		const children: Record<string, number> = {};
		for (const e of graph.edges) {
			if (e.kind === 'composition' || e.kind === 'containment') {
				children[e.source] = (children[e.source] ?? 0) + 1;
			} else if (UPWARD.has(e.kind)) {
				children[e.target] = (children[e.target] ?? 0) + 1;
			}
		}
		return Math.max(0, ...Object.values(children)) > 5 ? 'RIGHT' : 'DOWN';
	}

	// ---- Positions, remembered per diagram in layout/diagrams.json ----

	function storedPositions() {
		return parseLayout(workspace.text(LAYOUT_FILE))[layoutKey] ?? {};
	}

	/** Pin positions (merged), or clear this diagram's with `null`. */
	function savePositions(update: Record<string, XY> | null, drop: string[] = []) {
		const current = workspace.text(LAYOUT_FILE);
		let file = parseLayout(current);
		if (drop.length && file[layoutKey]) {
			const kept = { ...file[layoutKey] };
			for (const id of drop) delete kept[id];
			file = { ...file, [layoutKey]: kept };
		}
		file = withPositions(file, layoutKey, update);
		const text = serializeLayout(file, parseShown(current));
		if (text === (current ?? '{}\n')) return;
		workspace.setText(LAYOUT_FILE, text);
	}

	/** What this diagram hides, and adds to what its scope draws (kept in the layout file). */
	const shown: DiagramShown = $derived(
		parseShown(workspace.text(LAYOUT_FILE))[layoutKey] ?? NOTHING_CHANGED
	);

	/** Change what this diagram hides or adds; part of the caller's undoable step. */
	function saveShown(change: Partial<DiagramShown>) {
		const current = workspace.text(LAYOUT_FILE);
		const text = serializeLayout(
			parseLayout(current),
			withShown(parseShown(current), layoutKey, change)
		);
		if (text !== (current ?? '{}\n')) workspace.setText(LAYOUT_FILE, text);
	}

	/**
	 * The saved view this diagram draws, when it is one (a general view of a
	 * `view` usage): what it shows is written in its `expose` lines.
	 */
	const savedView = $derived.by(() => {
		if (view !== 'general' || !scope) return undefined;
		const info = workspace.views.find(
			(v) => v.isUsage && !v.builtin && (v.qualifiedName ?? v.name) === scope
		);
		if (!info) return undefined;
		return workspace.elements.find(
			(e) =>
				e.kind === 'view' &&
				!e.isDefinition &&
				e.file === info.file &&
				(qualifiedName(e, owners) === scope || e.name === info.name)
		);
	});

	/**
	 * Once the person arranges a diagram, keep all of it as they see it:
	 * every node is pinned, so a reload shows exactly the same picture.
	 */
	function pinAll() {
		savePositions(Object.fromEntries(nodes.map((n) => [n.id, n.position])));
	}

	/** What a part of the drawing changed by an edit: new boxes, and new lines (`source>target`). */
	interface Focus {
		nodes: Set<string>;
		lines: Set<string>;
	}

	/**
	 * What the drawing covers: its nodes, and the routes and labels ELK placed
	 * beside them (or only those of `focus`).
	 */
	function drawingBounds(focus?: Focus) {
		const xs: number[] = [];
		const ys: number[] = [];
		for (const n of nodes) {
			if (focus && !focus.nodes.has(n.id)) continue;
			xs.push(n.position.x, n.position.x + (n.width ?? 0));
			ys.push(n.position.y, n.position.y + (n.height ?? 0));
		}
		for (const e of edges) {
			const route = e.data?.route;
			if (!route || (focus && !focus.lines.has(`${e.source}>${e.target}`))) continue;
			for (const p of route.points) {
				xs.push(p.x);
				ys.push(p.y);
			}
			if (route.label) {
				const half = labelWidth(edgeText(e.data!.kind, e.data!.label)) / 2;
				xs.push(route.label.x - half, route.label.x + half);
				ys.push(route.label.y - LABEL_HEIGHT / 2, route.label.y + LABEL_HEIGHT / 2);
			}
		}
		if (!xs.length) return null;
		const x = Math.min(...xs);
		const y = Math.min(...ys);
		return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
	}

	function fit(focus?: Focus) {
		requestAnimationFrame(() =>
			requestAnimationFrame(() => {
				const bounds = drawingBounds();
				const changed = focus && drawingBounds(focus);
				const duration = reducedMotion ? 0 : 280;
				if (!flow || !bounds || !host) return void flow?.fitView({ ...FIT, duration });
				const { clientWidth: width, clientHeight: height } = host;
				// On a narrow screen the toolbar (and the frame's title below it) cover the
				// diagram's top: fit it into the room beneath them.
				const narrow = width < NARROW;
				const top = narrow ? toolbarHeight + (frameTitle && frameBelow ? 44 : 12) : 0;
				let viewport = getViewportForBounds(
					bounds,
					width,
					height - top,
					0.15,
					FIT.maxZoom,
					FIT.padding
				);
				viewport = { ...viewport, y: viewport.y + top };
				if (narrow && viewport.zoom < READABLE_ZOOM) {
					const zoom = READABLE_ZOOM;
					const at = changed ?? bounds;
					const spareX = width - at.width * zoom;
					const spareY = height - top - at.height * zoom;
					viewport = {
						zoom,
						x: (spareX > 0 ? spareX / 2 : 12) - at.x * zoom,
						y: top + (changed && spareY > 0 ? spareY / 2 : 8) - at.y * zoom
					};
				}
				void flow.setViewport(viewport, { duration });
			})
		);
	}

	/** The nodes and lines last drawn, to tell a new state or line from a changed label. */
	let lastShape = '';

	/** The texts the diagram was last drawn from. */
	let drawnTexts: string[] = [];

	async function refresh(relayout = false) {
		const current = ++generation;
		try {
			const files = workspace.sourceFiles();
			const hidden = untrack(() => shown.hidden);
			const added = untrack(() => shown.added);
			const full = await engine.diagram(view, files, scope, added.length ? added : undefined);
			if (current !== generation) return;
			const graph = withoutHidden(full, hidden);
			hiddenHere = full.nodes
				.filter((n) => hidden.includes(n.id))
				.map((n) => ({
					id: n.id,
					label: n.label || n.id,
					key: n.element ? `${n.element.file}@${n.element.start_byte}` : null
				}));
			// Laying out thousands of boxes takes the page minutes and draws nothing readable.
			if (graph.nodes.length > MAX_NODES) {
				nodes = [];
				edges = [];
				frameTitle = graph.title;
				message = `This view has ${graph.nodes.length} elements, too many to draw at once (at most ${MAX_NODES}). Narrow it: expose less in the view, or open the diagram of a package or a part inside it.`;
				status = 'too-large';
				return;
			}
			const direction = directionFor(graph);
			const hadNodes = nodes.length > 0;
			const previous = new Map(nodes.map((n) => [n.id, n]));
			const stored = relayout ? {} : { ...storedPositions() };
			// A state machine or flow nobody has arranged by hand is laid out afresh as it
			// grows, so each new state or line lands where the layout reads best.
			// Only when what is drawn changed: a new label alone moves nothing.
			const drawn = {
				nodes: graph.nodes.map((n) => n.id),
				lines: graph.edges.map((e) => `${e.source}>${e.target}`)
			};
			const shape = JSON.stringify(drawn);
			const settle = behavior && !Object.keys(stored).length && shape !== lastShape;
			// What this drawing adds to the last one: where to look after an edit.
			const before = lastShape ? (JSON.parse(lastShape) as typeof drawn) : null;
			const newOf = (now: string[], then: string[]) => {
				const had = new Set(then);
				return new Set(now.filter((id) => !had.has(id)));
			};
			const focus: Focus | undefined = before
				? { nodes: newOf(drawn.nodes, before.nodes), lines: newOf(drawn.lines, before.lines) }
				: undefined;
			lastShape = shape;
			const sizes = new Map(graph.nodes.map((n) => [n.id, nodeSize(n, view)]));

			// A renamed element keeps its place.
			const renamed = relayout
				? null
				: renamedNode(
						[...previous.keys()],
						graph.nodes.map((n) => n.id)
					);
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, not state
			const carried = new Map<string, XY>();
			if (renamed) {
				const [from, to] = renamed;
				const was = previous.get(from)?.position;
				if (was) carried.set(to, was);
				if (stored[from]) {
					stored[to] = stored[from];
					savePositions({ [to]: { x: stored[from][0], y: stored[from][1] } }, [from]);
				}
			}

			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, not state
			const fixed = new Map<string, XY>();
			let dropped: string | null = null;
			if (pendingPlace && pendingPlace.until < Date.now()) pendingPlace = null;
			for (const n of graph.nodes) {
				const pinned = stored[n.id];
				const before =
					relayout || settle ? undefined : (carried.get(n.id) ?? previous.get(n.id)?.position);
				if (pinned) fixed.set(n.id, { x: pinned[0], y: pinned[1] });
				else if (before) fixed.set(n.id, before);
				else if (pendingPlace && hadNodes && nameOf(n.id) === pendingPlace.name) dropped = n.id;
			}
			if (dropped && pendingPlace) {
				// Where it was added, or the nearest free spot: never on top of another node.
				const size = sizes.get(dropped)!;
				const others = [...fixed].map(([id, p]) => ({ id, ...p, ...sizes.get(id)! }));
				const spot = freeSpot(
					{
						id: dropped,
						x: Math.round(pendingPlace.at.x - size.width / 2),
						y: Math.round(pendingPlace.at.y - size.height / 2),
						...size
					},
					others
				);
				fixed.set(dropped, { x: spot.x, y: spot.y });
			}
			// Laid out every time, also when every node has its place: edges between
			// nodes that are still where ELK put them follow its routes.
			const auto = await autoLayout(graph, direction);
			if (current !== generation) return;
			const autoAt = new Map(auto.nodes.map((p) => [p.node.id, { x: p.x, y: p.y }]));
			let positions: Map<string, XY> = fixed;
			if (!graph.nodes.every((n) => fixed.has(n.id))) {
				positions = placeAround(
					auto.nodes.map((p) => ({
						id: p.node.id,
						x: p.x,
						y: p.y,
						width: p.width,
						height: p.height
					})),
					fixed
				);
			}

			const selectedKey = untrack(() => selected?.key);
			const byKey = new Map(workspace.elements.map((e) => [e.key, e]));
			const pseudo = ['initial_state', 'final_state', 'fork', 'join', 'decision'];
			nodes = graph.nodes.map((node) => {
				// The engine says where the element is declared; ids are only names.
				const declared = node.element
					? byKey.get(`${node.element.file}@${node.element.start_byte}`)
					: undefined;
				const element =
					declared ??
					(node.element || !pseudo.includes(node.kind)
						? resolveNode(node.id, node.is_definition, scope, workspace.elements, owners)
						: undefined);
				return {
					id: node.id,
					type: 'sysml',
					position: positions.get(node.id) ?? { x: 0, y: 0 },
					...sizes.get(node.id)!,
					selected: previous.get(node.id)?.selected ?? false,
					data: {
						node,
						selected: !!element && element.key === selectedKey,
						direction,
						view,
						editable: !!element && !isLibrary(element),
						elementKey: element?.key ?? null,
						name: element?.label ?? null,
						elementId: element?.id ?? null,
						review: untrack(() => reviewMarks.markOf(element?.id))
					},
					ariaLabel: ariaOf(
						node,
						untrack(() => reviewMarks.markOf(element?.id))
					)
				};
			});
			const ids = new Set(graph.nodes.map((n) => n.id));
			const labelOf = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;
			edges = graph.edges
				.map((e, index) => ({ e, index }))
				.filter(({ e }) => ids.has(e.source) && ids.has(e.target))
				.map(({ e, index }, i) => {
					// Drawn from the general end (laid out above), so the line leaves its bottom.
					const reversed = UPWARD.has(e.kind);
					const route = auto.routes.get(index);
					const from = autoAt.get(reversed ? e.target : e.source);
					const to = autoAt.get(reversed ? e.source : e.target);
					return {
						id: `${e.kind}:${e.source}:${e.target}:${i}`,
						source: reversed ? e.target : e.source,
						target: reversed ? e.source : e.target,
						type: 'sysml',
						ariaLabel: `${e.kind.replace(/_/g, ' ')} from ${labelOf(e.source)} to ${labelOf(e.target)}`,
						data: {
							kind: e.kind,
							label: e.label,
							reversed,
							...(e.element ? { element: e.element } : {}),
							editable: canEditEdge(e, graph),
							route: route && from && to ? { ...route, from, to } : undefined
						}
					};
				});
			frameTitle = graph.title;
			status = 'ready';
			drawnTexts = files.map((f) => f.text);

			if (dropped) {
				pendingPlace = null;
				const p = positions.get(dropped)!;
				if (Object.keys(stored).length) savePositions({ [dropped]: p });
				else pinAll();
			}
			if (!hadNodes || relayout) fit();
			else if (settle) fit(focus);
			if (addedCheck && current > addedCheck.after) {
				const drawnKeys = new Set(
					graph.nodes.flatMap((n) =>
						n.element ? [`${n.element.file}@${n.element.start_byte}`] : []
					)
				);
				const missing = addedCheck.keys.filter((k) => !drawnKeys.has(k)).length;
				addedCheck = null;
				if (missing)
					toasts.show(
						missing === 1
							? 'One of them is not drawn: this view’s filter leaves it out.'
							: `${missing} of them are not drawn: this view’s filter leaves them out.`
					);
			}
		} catch (error) {
			if (current !== generation) return;
			status = 'error';
			message = error instanceof Error ? error.message : String(error);
		}
	}

	// Fit the drawing again when the pane changes size a lot (layout switch,
	// window resize), so it never sits tiny in a corner.
	$effect(() => {
		let width = 0;
		let resizeTimer: ReturnType<typeof setTimeout> | undefined;
		const observer = new ResizeObserver(([entry]) => {
			const next = entry?.contentRect.width ?? 0;
			hostWidth = next;
			if (width && Math.abs(next - width) / width > 0.2) {
				clearTimeout(resizeTimer);
				resizeTimer = setTimeout(fit, 120);
			}
			width = next;
		});
		observer.observe(host);
		return () => {
			observer.disconnect();
			clearTimeout(resizeTimer);
		};
	});

	// Redraw shortly after the model text changes (not after layout-only writes).
	let lastTexts: string[] | null = null;
	$effect(() => {
		const texts = workspace.modelPaths.map((p) => workspace.files[p] ?? '');
		void view;
		void scope;
		const same =
			lastTexts !== null &&
			lastTexts.length === texts.length &&
			lastTexts.every((t, i) => t === texts[i]);
		if (same) return;
		lastTexts = texts;
		const delay = untrack(() => nodes.length) ? 300 : 0;
		clearTimeout(timer);
		timer = setTimeout(() => void refresh(), delay);
	});
	// Not on every run above: a write to another file (the layout) in the meantime
	// would cancel the redraw the model text asked for.
	$effect(() => () => clearTimeout(timer));

	// Redraw when what the diagram hides or adds changes (also by undo).
	let lastShown: string | null = null;
	$effect(() => {
		const key = JSON.stringify([layoutKey, shown]);
		if (lastShown === null || lastShown === key) {
			lastShown = key;
			return;
		}
		lastShown = key;
		clearTimeout(timer);
		timer = setTimeout(() => void refresh(), 0);
	});

	// Reflect the selection without relaying out.
	$effect(() => {
		const key = selected?.key;
		const current = untrack(() => nodes);
		const isSelected = (n: Node<SysmlNodeData>) => !!key && n.data.elementKey === key;
		if (current.every((n) => n.data.selected === isSelected(n))) return;
		nodes = current.map((n) =>
			n.data.selected === isSelected(n) ? n : { ...n, data: { ...n.data, selected: isSelected(n) } }
		);
	});

	/** A node as screen readers hear it, with its review mark (never colour alone). */
	function ariaOf(node: SysmlNodeData['node'], mark: ReviewMark | null): string {
		const base = `${node.stereotype?.replace(/^<<|>>$/g, '') ?? node.kind} ${node.label}`;
		return mark ? `${base}, ${MARK_WORDS[mark].said}` : base;
	}

	// Review mode: mark what is new or changed, without relaying out.
	$effect(() => {
		const markOf = (n: Node<SysmlNodeData>) => reviewMarks.markOf(n.data.elementId);
		void reviewMarks.shown;
		void reviewMarks.byId;
		const current = untrack(() => nodes);
		if (current.every((n) => (n.data.review ?? null) === markOf(n))) return;
		nodes = current.map((n) => {
			const mark = markOf(n);
			return (n.data.review ?? null) === mark
				? n
				: { ...n, data: { ...n.data, review: mark }, ariaLabel: ariaOf(n.data.node, mark) };
		});
	});
	/** Removed elements this diagram would have shown: listed, since they can't be drawn. */
	const removedHere = $derived.by(() => {
		if (!reviewMarks.shown) return [];
		const drawn = new Set(nodes.map((n) => n.data.name).filter(Boolean));
		return reviewMarks.removed.filter(
			(r) =>
				(r.owner && drawn.has(r.owner)) || (!!scope && r.qualifiedName.startsWith(`${scope}::`))
		);
	});
	const markedHere = $derived(nodes.some((n) => n.data.review));

	// Select an element "Add" just created, once the model has read it.
	$effect(() => {
		const want = pendingSelect;
		if (!want) return;
		const found = workspace.elements.find(
			(e) => e.name === want.name && owners.get(e.key)?.name === want.owner
		);
		if (found) {
			pendingSelect = null;
			ui.select(found.key, 'diagram');
		}
	});

	// ---- Geometry helpers ----

	/** A client point as a position inside the canvas, kept clear of its edges. */
	function inCanvas(point: XY, width = 0, height = 0): XY {
		const rect = host.getBoundingClientRect();
		return {
			x: Math.max(8, Math.min(point.x - rect.left, rect.width - width - 8)),
			y: Math.max(8, Math.min(point.y - rect.top, rect.height - height - 8))
		};
	}

	function nodeElement(id: string): HTMLElement | null {
		return host.querySelector<HTMLElement>(`.svelte-flow__node[data-id="${CSS.escape(id)}"]`);
	}

	/** A point just below a node's bottom-left corner, in client coordinates. */
	function underNode(id: string): XY {
		const rect = nodeElement(id)?.getBoundingClientRect();
		if (!rect) {
			const h = host.getBoundingClientRect();
			return { x: h.left + h.width / 2, y: h.top + h.height / 3 };
		}
		return { x: rect.left, y: rect.bottom + 6 };
	}

	function nodeIdAt(point: XY): string | null {
		for (const el of document.elementsFromPoint(point.x, point.y)) {
			const node = el.closest<HTMLElement>('.svelte-flow__node');
			if (node && host.contains(node)) return node.dataset.id ?? null;
		}
		return null;
	}

	function pointOf(event: MouseEvent | TouchEvent): XY {
		if ('changedTouches' in event && event.changedTouches.length) {
			const t = event.changedTouches[0]!;
			return { x: t.clientX, y: t.clientY };
		}
		const m = event as MouseEvent;
		return { x: m.clientX, y: m.clientY };
	}

	function focusNode(id: string | undefined) {
		if (id) requestAnimationFrame(() => nodeElement(id)?.focus({ preventScroll: true }));
	}

	// ---- Relationships ----

	function openRelation(sourceId: string, target: ModelElement, at: XY, targetLabel?: string) {
		const source = elementOf(sourceId);
		if (!source) {
			toasts.show('That node is not an element of the model.');
			return;
		}
		const options = relationsFor(source, target, ctx);
		if (!options.length) {
			toasts.show(`Nothing to draw from ${source.label} to ${targetLabel ?? target.label}.`);
			focusNode(sourceId);
			return;
		}
		const sheet = hostWidth < 560;
		const p = sheet ? { x: 0, y: 0 } : inCanvas({ x: at.x + 12, y: at.y + 12 }, 336, 340);
		relation = {
			source: source.label,
			target: targetLabel ?? target.label,
			sourceId,
			options,
			...p
		};
	}

	async function applyPlan(plan: Plan): Promise<string | null> {
		const error = await applySteps(workspace, plan.label, plan.steps, checkSyntax);
		if (!error) {
			const back = relation?.sourceId;
			relation = null;
			focusNode(back);
		}
		return error;
	}

	/** Refuse a text patch that would add syntax errors. */
	async function checkSyntax(path: string, before: string, after: string) {
		const [was, now] = await Promise.all([
			engine.analyze(path, before),
			engine.analyze(path, after)
		]);
		if (now.model.syntax_errors.length > was.model.syntax_errors.length) {
			return `That change would make the SysML invalid: ${now.model.syntax_errors[0]?.message ?? 'syntax error'}`;
		}
		return null;
	}

	function startConnect(id: string) {
		const element = elementOf(id);
		if (!element || isLibrary(element)) return;
		menu = null;
		relation = null;
		editing.connectingFrom = id;
	}

	function cancelConnect() {
		const from = editing.connectingFrom;
		editing.connectingFrom = null;
		focusNode(from ?? undefined);
	}

	const connectTargets: ConnectTarget[] = $derived.by(() => {
		const from = editing.connectingFrom;
		if (!from) return [];
		const source = untrack(() => elementOf(from));
		if (!source) return [];
		if (behavior) {
			// The states (or steps) on this diagram: a transition or a next step to each.
			const fits = view === 'states' ? isState : isFlowNode;
			const detail =
				view === 'states' ? 'transition' : source.kind === 'decision_node' ? 'branch' : 'next step';
			return nodes.flatMap((n) => {
				const element = n.data.elementKey
					? workspace.elements.find((e) => e.key === n.data.elementKey)
					: undefined;
				return element && n.id !== from && fits(element) && !isLibrary(element)
					? [{ id: n.id, element, group: 'On this diagram', detail }]
					: [];
			});
		}
		const detail = (options: RelationOption[]) =>
			[...new Set(options.map((o) => o.label))].join(', ');
		const onDiagram: ConnectTarget[] = [];
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, not state
		const seen = new Set<string>([source.key]);
		for (const n of nodes) {
			const element = n.data.elementKey
				? workspace.elements.find((e) => e.key === n.data.elementKey)
				: undefined;
			if (!element || seen.has(element.key)) continue;
			seen.add(element.key);
			const options = relationsFor(source, element, ctx);
			if (options.length) {
				onDiagram.push({ id: n.id, element, group: 'On this diagram', detail: detail(options) });
			}
		}
		const elsewhere: ConnectTarget[] = [];
		for (const element of workspace.elements) {
			if (seen.has(element.key) || isLibrary(element)) continue;
			const options = relationsFor(source, element, ctx);
			if (!options.length) continue;
			const group =
				element.kind === 'requirement'
					? 'Requirements'
					: element.isDefinition
						? 'Definitions'
						: 'Parts and other usages';
			elsewhere.push({ element, group, detail: detail(options) });
		}
		const order = ['Requirements', 'Definitions', 'Parts and other usages'];
		elsewhere.sort(
			(a, b) =>
				order.indexOf(a.group) - order.indexOf(b.group) ||
				a.element.label.localeCompare(b.element.label)
		);
		return [...onDiagram, ...elsewhere];
	});

	function pickTarget(target: ConnectTarget) {
		const from = editing.connectingFrom;
		if (!from) return;
		editing.connectingFrom = null;
		if (behavior && target.id) {
			void linkNodes(from, target.id, underNode(target.id));
			return;
		}
		openRelation(from, target.element, target.id ? underNode(target.id) : underNode(from));
	}

	// ---- Behaviour: drawing transitions and successions ----

	/** A form open on the canvas: a transition, a decision branch, or what a state does. */
	let behaviorForm = $state<
		| {
				kind: 'transition';
				from: string;
				to: string;
				initial: TransitionSpec;
				values: string[];
				plan: (spec: TransitionSpec) => Plan | string;
				submit: string;
				x: number;
				y: number;
				focus?: string;
		  }
		| {
				kind: 'branch';
				from: string;
				to: string;
				initial: string;
				values: string[];
				plan: (guard: string) => Plan | string;
				submit: string;
				x: number;
				y: number;
				focus?: string;
		  }
		| { kind: 'state'; state: ModelElement; x: number; y: number; focus?: string }
		| null
	>(null);
	/** Phones: forms are bottom sheets. */
	const narrow = $derived(hostWidth < 560);
	const formMode = $derived(narrow ? 'sheet' : 'popover');

	/** Where a form opens: beside the point, inside the canvas (a sheet ignores it). */
	function formAt(point: XY) {
		return hostWidth < 560
			? { x: 0, y: 0 }
			: inCanvas({ x: point.x + 12, y: point.y + 12 }, 352, 440);
	}

	function closeBehaviorForm() {
		const back = behaviorForm?.focus;
		behaviorForm = null;
		focusNode(back);
	}

	/**
	 * Wait until the model describes the text as it is now, and the diagram
	 * draws it: right after an edit, the analysis (where each element is in
	 * the text) takes a moment, and a gesture planned on the old one would
	 * write in the wrong place.
	 */
	async function settle(): Promise<void> {
		for (let i = 0; i < 200 && !workspace.settled; i++) {
			await new Promise((done) => setTimeout(done, 40));
		}
		const now = workspace.sourceFiles().map((f) => f.text);
		if (drawnTexts.length !== now.length || drawnTexts.some((t, i) => t !== now[i])) {
			clearTimeout(timer);
			await refresh();
		}
	}

	/** The element as the model has it now (ids survive edits that move it in the text). */
	function fresh(e: ModelElement): ModelElement {
		return (
			(e.id ? workspace.elements.find((x) => x.id === e.id) : undefined) ??
			workspace.elements.find((x) => x.key === e.key) ??
			e
		);
	}

	/** A drawn line by what it joins, as the diagram has it now. */
	interface EdgeRef {
		kind: string;
		source: string;
		target: string;
		label: string | null;
	}
	const refOf = (e: Edge<SysmlEdgeData>): EdgeRef => ({
		kind: e.data?.kind ?? '',
		source: e.source,
		target: e.target,
		label: e.data?.label ?? null
	});
	function edgeNow(ref: EdgeRef): Edge<SysmlEdgeData> | undefined {
		const same = edges.filter(
			(e) => e.data?.kind === ref.kind && e.source === ref.source && e.target === ref.target
		);
		return same.find((e) => (e.data?.label ?? null) === ref.label) ?? same[0];
	}

	/** Apply a form's edit as one undoable step; the form closes when it is made, else says why. */
	async function applyFromForm(plan: Plan): Promise<string | null> {
		const error = await applySteps(workspace, plan.label, plan.steps, checkSyntax);
		if (!error) closeBehaviorForm();
		return error;
	}

	/** Apply an edit made without a form (a menu item, a drawn line); a toast says why not. */
	async function applyBehavior(plan: Plan | string): Promise<string | null> {
		const error =
			typeof plan === 'string'
				? plan
				: await applySteps(workspace, plan.label, plan.steps, checkSyntax);
		if (error) toasts.show(error);
		return error;
	}

	/** A menu item that plans its edit once the model has settled, on the node's element as it is then. */
	function onSettled(id: string, plan: (element: ModelElement) => Plan | string) {
		return () =>
			void settle().then(() => {
				const element = elementOf(id);
				if (element) void applyBehavior(plan(element));
			});
	}

	/** The Add form's plan for a state, a value, an action or a control node. */
	function planAdd(owner: ModelElement, choice: BehaviorAddChoice): Plan | string {
		const o = fresh(owner);
		switch (choice.kind) {
			case 'state':
				return planAddState(o, choice.name, choice.start, ctx);
			case 'value':
				return planAddValue(o, choice.name, choice.type, choice.value, ctx);
			default:
				return planAddFlowNode(o, choice.kind, choice.name, choice.start, ctx);
		}
	}

	/** Add a state or a step, placed where the person last clicked, else beside the selection. */
	async function addBehavior(
		plan: Plan,
		choice: BehaviorAddChoice,
		o: ModelElement
	): Promise<string | null> {
		const error = await applySteps(workspace, plan.label, plan.steps, checkSyntax);
		if (error) return error;
		popover = null;
		addInside = null;
		const arranged = Object.keys(storedPositions()).length > 0;
		if (choice.kind !== 'value' && (lastClick || arranged)) {
			const name = formatName(choice.name);
			const near = selectedNode ? nodeElement(selectedNode.id)?.getBoundingClientRect() : null;
			const rect = host.getBoundingClientRect();
			const at =
				lastClick ??
				flow?.screenToFlowPosition(
					near
						? { x: near.right + 120, y: near.top + near.height / 2 }
						: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
				);
			if (at) pendingPlace = { name, at, until: Date.now() + 8000 };
		}
		if (choice.kind !== 'value') pendingSelect = { name: formatName(choice.name), owner: o.name };
		lastClick = null;
		return null;
	}

	/** Which edges' labels open a form: transitions (not the initial one) and decision branches. */
	function canEditEdge(e: DiagramGraph['edges'][number], graph: DiagramGraph): boolean {
		if (!behavior || !e.element || e.element.end_byte === undefined) return false;
		if (view === 'states') {
			const from = graph.nodes.find((n) => n.id === e.source);
			return e.kind === 'transition' && from?.kind !== 'initial_state';
		}
		return !!e.label && /^\[.*\]$/.test(e.label);
	}

	/** The end of a drawn line as a flow end: an element, or the flow's start or done. */
	function flowEnd(id: string): FlowEnd | undefined {
		const kind = nodes.find((n) => n.id === id)?.data.node.kind;
		if (kind === 'initial_state') return 'start';
		if (kind === 'final_state') return 'done';
		const e = elementOf(id);
		return e && !isLibrary(e) && isFlowNode(e) ? e : undefined;
	}
	const freshEnd = (end: FlowEnd): FlowEnd => (typeof end === 'string' ? end : fresh(end));

	/** A line drawn from one node to another on a state or action diagram. */
	async function linkNodes(fromId: string, toId: string, point: XY) {
		await settle();
		const label = (id: string) => nodes.find((n) => n.id === id)?.data.node.label || id;
		const fromKind = nodes.find((n) => n.id === fromId)?.data.node.kind;
		const toKind = nodes.find((n) => n.id === toId)?.data.node.kind;
		if (view === 'states') {
			const target = toKind === 'final_state' ? 'done' : elementOf(toId);
			if (fromKind === 'initial_state') {
				if (target && target !== 'done' && isState(target))
					void applyBehavior(planSetStart(target, ctx));
				return;
			}
			const source = elementOf(fromId);
			if (!source || !isState(source) || !target || (target !== 'done' && !isState(target))) {
				toasts.show(`A transition goes from one state to another.`);
				return;
			}
			behaviorForm = {
				kind: 'transition',
				from: source.label,
				to: target === 'done' ? 'the end' : target.label,
				initial: { trigger: { kind: 'signal', signal: '' }, guard: '', effect: '' },
				values: valuesAround(source, ctx),
				plan: (spec) =>
					planTransition(fresh(source), target === 'done' ? 'done' : fresh(target), spec, ctx),
				submit: 'Add transition',
				...formAt(point),
				focus: fromId
			};
			return;
		}
		const from = flowEnd(fromId);
		const to = flowEnd(toId);
		if (!from || !to) {
			toasts.show(`Nothing to draw from ${label(fromId)} to ${label(toId)}.`);
			return;
		}
		if (typeof from !== 'string' && from.kind === 'decision_node') {
			const source = from;
			behaviorForm = {
				kind: 'branch',
				from: source.label,
				to: label(toId),
				initial: '',
				values: valuesAround(source, ctx),
				plan: (guard) => planSuccession(fresh(source), freshEnd(to), guard, ctx),
				submit: 'Add branch',
				...formAt(point),
				focus: fromId
			};
			return;
		}
		if (!(await applyBehavior(planSuccession(from, to, null, ctx)))) focusNode(fromId);
	}

	/** The named element a drawn line is (a named transition), if any. */
	function edgeElement(source: EdgeSource | undefined): ModelElement | undefined {
		return source
			? workspace.elements.find((e) => e.key === `${source.file}@${source.start_byte}`)
			: undefined;
	}

	/** Change a transition or a decision branch, from its label or its menu. */
	async function editEdge(id: string, point?: XY) {
		const before = edges.find((e) => e.id === id);
		if (!before?.data?.editable) return;
		menu = null;
		const ref = refOf(before);
		const at = formAt(point ?? underNode(before.source));
		await settle();
		const edge = edgeNow(ref);
		const element = edge?.data?.element;
		if (!edge || !element) return;
		const label = (nodeId: string) => nodes.find((n) => n.id === nodeId)?.data.node.label || nodeId;
		/** The line's text as it is when the form is sent. */
		const written = () => edgeNow(ref)?.data?.element;
		const gone = 'This line is no longer in the model.';
		const source = elementOf(edge.source);
		if (!source) return;
		if (view === 'states') {
			const read = readTransition(element, ctx);
			if (!read) return;
			const named = edgeElement(element);
			const name = named?.kind === 'transition' ? named.name : null;
			behaviorForm = {
				kind: 'transition',
				from: source.label,
				to: label(edge.target),
				initial: read.spec,
				values: valuesAround(source, ctx),
				plan: (spec) => {
					const now = written();
					return now ? planEditTransition(now, fresh(source), spec, name, ctx) : gone;
				},
				submit: 'Save',
				...at,
				focus: edge.source
			};
			return;
		}
		const guard = branchGuard(element, ctx);
		if (guard === null) return;
		behaviorForm = {
			kind: 'branch',
			from: source.label,
			to: label(edge.target),
			initial: guard,
			values: valuesAround(source, ctx),
			plan: (g) => {
				const now = written();
				return now ? planEditBranch(now, g, ctx) : gone;
			},
			submit: 'Save',
			...at,
			focus: edge.source
		};
	}

	/** What a state does on entry, while in it and on exit. */
	async function openStateActions(id: string, point?: XY) {
		menu = null;
		const at = formAt(point ?? underNode(id));
		await settle();
		const state = elementOf(id);
		if (!state || !isState(state)) return;
		behaviorForm = { kind: 'state', state, ...at, focus: id };
	}

	/** The lines drawn to and from a node and the nodes inside it, as written. */
	function linesAt(id: string): EdgeSource[] {
		const touches = (n: string) => n === id || n.startsWith(`${id}.`);
		return edges
			.filter((e) => touches(e.source) || touches(e.target))
			.flatMap((e) => (e.data?.element ? [e.data.element] : []));
	}

	// ---- Menus, rename, delete ----

	function openNodeMenu(id: string, point?: XY) {
		const element = elementOf(id);
		const node = nodes.find((n) => n.id === id);
		if (!node) return;
		const items: MenuItem[] = [];
		const own = element && !isLibrary(element);
		if (own && behavior && view === 'states' && isState(element)) {
			const region = owners.get(element.key);
			items.push({
				label: 'Add transition from here',
				icon: Spline,
				shortcut: 'C',
				run: () => startConnect(id)
			});
			if (region && startOf(region, ctx) !== element.name)
				items.push({
					label: 'Starts here',
					icon: CircleDot,
					run: onSettled(id, (e) => planSetStart(e, ctx))
				});
			items.push(
				{ label: 'What it does…', icon: ListTodo, run: () => void openStateActions(id, point) },
				{
					label: 'Add a state inside',
					icon: Plus,
					run: () => {
						ui.select(element.key, 'diagram');
						addInside = element.key;
						lastClick = null;
						popover = 'add';
					}
				},
				{ label: 'Rename', icon: Pencil, shortcut: 'F2', run: () => editing.startRename(id) }
			);
		} else if (own && behavior && view === 'actions' && isFlowNode(element)) {
			items.push({
				label: element.kind === 'decision_node' ? 'Add a branch from here' : 'Add what comes next',
				icon: ArrowRight,
				shortcut: 'C',
				run: () => startConnect(id)
			});
			// A flow can start at an action or a fork, and end after an action, a merge or a join.
			const control = element.kind in CONTROL_WORDS;
			if (!control || element.kind === 'fork_node')
				items.push({
					label: 'Starts here',
					icon: CircleDot,
					run: onSettled(id, (e) => planSuccession('start', e, null, ctx))
				});
			if (!control || element.kind === 'merge_node' || element.kind === 'join_node')
				items.push({
					label: 'Ends here',
					icon: CircleStop,
					run: onSettled(id, (e) => planSuccession(e, 'done', null, ctx))
				});
			items.push({
				label: 'Rename',
				icon: Pencil,
				shortcut: 'F2',
				run: () => editing.startRename(id)
			});
		} else if (own) {
			items.push(
				{ label: 'Rename', icon: Pencil, shortcut: 'F2', run: () => editing.startRename(id) },
				{ label: 'Connect…', icon: Cable, shortcut: 'C', run: () => startConnect(id) }
			);
		}
		// A state machine or action drawn here opens as its own diagram, where it is built.
		const machineOrFlow =
			element &&
			(element.kind === 'exhibit' ||
				(element.isDefinition && (element.kind === 'state' || element.kind === 'action')));
		if (element && !behavior && machineOrFlow) {
			const diagramView = element.kind === 'action' ? 'actions' : 'states';
			items.push({
				label: element.kind === 'action' ? 'Open its action flow' : 'Open its state diagram',
				icon: Network,
				run: () =>
					ui.open({
						kind: 'diagram',
						view: diagramView,
						scope: qualifiedName(element, owners),
						title: element.label
					})
			});
		}
		if (element) {
			items.push({ label: 'Show in text', icon: FileCode, run: () => showInText(element) });
		}
		if ((view === 'general' || view === 'interconnection') && element?.id) {
			items.push({
				label: 'Add connected elements…',
				detail:
					view === 'general'
						? 'What it refers to, or what refers to it'
						: 'The parts beside it that it connects to',
				icon: Waypoints,
				run: () => void askAddConnected(id, point)
			});
		}
		if (element && !isLibrary(element)) {
			items.push({
				label: 'Duplicate',
				icon: CopyPlus,
				shortcut: isMac ? '⌘D' : 'Ctrl+D',
				run: () => void duplicateNode(id)
			});
		}
		items.push({
			label: 'Remove from diagram',
			detail: 'It stays in the model',
			icon: EyeOff,
			shortcut: 'H',
			run: () => void removeFromDiagram(id)
		});
		if (element && !isLibrary(element)) {
			items.push({
				label: 'Delete from model…',
				detail: 'Takes it out of the text',
				icon: Trash2,
				shortcut: 'Del',
				danger: true,
				run: () => askDeleteNode(id)
			});
		}
		const at = inCanvas(point ?? underNode(id), 236, 48 + items.length * 48);
		menu = { title: node.data.node.label, items, ...at, focus: id };
	}

	function openEdgeMenu(edge: Edge<SysmlEdgeData>, point: XY) {
		const at = inCanvas(point, 220, 130);
		const items: MenuItem[] = [];
		if (edge.data?.editable)
			items.push({
				label: view === 'states' ? 'Change when, only if, then do…' : 'Change the condition…',
				icon: Pencil,
				run: () => void editEdge(edge.id, point)
			});
		items.push({
			label: behavior ? 'Delete' : 'Delete relationship',
			icon: Unlink,
			danger: true,
			run: () => askDeleteEdge(edge)
		});
		menu = { title: edge.ariaLabel ?? 'Relationship', items, ...at };
	}

	function showInText(element: ModelElement) {
		ui.open({ kind: 'file', path: element.file });
		ui.select(element.key, 'diagram');
	}

	function startRenameSelected() {
		if (selectedNode?.data.editable) {
			editing.startRename(selectedNode.id);
			return;
		}
		renameTo = selected?.label ?? '';
		actionError = null;
		popover = popover === 'rename' ? null : 'rename';
	}

	function askDeleteNode(id: string) {
		const element = elementOf(id);
		if (!element || isLibrary(element)) return;
		if (behavior && (isState(element) || isFlowNode(element))) {
			// The transitions or successions to and from it go too, so nothing points at nothing.
			const plan = planRemoveNode(element, linesAt(id), ctx);
			if (typeof plan === 'string') {
				toasts.show(plan);
				return;
			}
			menu = null;
			confirmError = null;
			confirm = {
				title: `Delete ${element.label}?`,
				detail: `${plan.label}.`,
				statement: plan.statement,
				action: 'Delete',
				run: async () => {
					await settle();
					const now = elementOf(id);
					const again = now ? planRemoveNode(now, linesAt(id), ctx) : `${element.label} is gone.`;
					return typeof again === 'string'
						? again
						: applySteps(workspace, again.label, again.steps, checkSyntax);
				},
				focus: id
			};
			return;
		}
		askDeleteElement(element, id);
	}

	function askDeleteElement(element: ModelElement, focus?: string) {
		menu = null;
		confirmError = null;
		confirm = {
			title: `Delete ${element.label} from the model?`,
			detail: `Its text is removed from ${element.file}, so it leaves every diagram and table.`,
			impact: 'Checking what uses it…',
			action: 'Delete',
			run: () => deleteElement(workspace, element),
			focus
		};
		void deleteImpact(workspace, element).then((impact) => {
			if (confirm?.title === `Delete ${element.label} from the model?`) confirm.impact = impact;
		});
	}

	/**
	 * Take a node off this diagram, never out of the model: a saved view loses
	 * the `expose` line that names it (when another still shows it, or it has
	 * none of its own, it is hidden); any other diagram hides it. One undoable step.
	 */
	async function removeFromDiagram(id: string) {
		menu = null;
		const node = nodes.find((n) => n.id === id);
		if (!node) return;
		const element = elementOf(id);
		const name = node.data.node.label || id;
		const unexposed =
			savedView && element && !isLibrary(savedView)
				? planUnexpose(savedView, element, ctx)
				: { steps: [], removed: [], stillShown: true };
		// An element added to this diagram goes off its list rather than being hidden.
		const plain = (q: string) => q.replace(/'/g, '');
		const wasAdded =
			!savedView && element
				? shown.added.filter((q) => plain(q) === plain(qualifiedName(element, owners)))
				: [];
		const label =
			unexposed.steps.length || wasAdded.length
				? `Removed ${name} from this ${savedView ? 'view' : 'diagram'} (it stays in the model)`
				: `Hid ${name} on this diagram (it stays in the model)`;
		const error = await undoable(workspace, label, async () => {
			if (unexposed.steps.length) {
				const refused = await applySteps(workspace, label, unexposed.steps, checkSyntax);
				if (refused) return refused;
			}
			if (wasAdded.length) saveShown({ added: shown.added.filter((q) => !wasAdded.includes(q)) });
			else if (unexposed.stillShown) saveShown({ hidden: [...shown.hidden, id] });
			return null;
		});
		if (error) toasts.show(error, { tone: 'error' });
		else host.focus({ preventScroll: true });
	}

	// ---- Adding what an element is connected to ----

	/** The "Add connected elements" choice open for a node. */
	let connected = $state<{
		id: string;
		name: string;
		list: NeighbourElement[];
		x: number;
		y: number;
	} | null>(null);
	/** Elements just added, to say which the diagram does not draw (a saved view's filter). */
	let addedCheck: { keys: string[]; after: number } | null = null;

	async function askAddConnected(id: string, point?: XY) {
		menu = null;
		const element = elementOf(id);
		if (!element?.id) return;
		const at = formAt(point ?? underNode(id));
		const related = await engine.related(workspace.sourceFiles(), element.id);
		const drawn = new Set(nodes.flatMap((n) => (n.data.elementKey ? [n.data.elementKey] : [])));
		const list =
			view === 'interconnection'
				? wiredNeighbours(related, workspace.elements, drawn, hiddenHere)
				: neighbours(related, workspace.elements, drawn);
		if (!list.length) {
			toasts.show(`Everything connected to ${element.label} is on this diagram already.`);
			return;
		}
		connected = { id, name: element.label, list, ...at };
	}

	function closeConnected() {
		const back = connected?.id;
		connected = null;
		focusNode(back);
	}

	/**
	 * Put an element's neighbours on the diagram, as one undoable step: a
	 * saved view gets an `expose` line for each; another diagram adds them in
	 * the layout file. Hidden ones are shown again. ELK places them.
	 */
	async function addConnected(direction: 'out' | 'in' | 'both'): Promise<string | null> {
		if (!connected) return null;
		const chosen = chooseNeighbours(connected.list, direction);
		const keys = new Set(chosen.map((n) => n.element.key));
		const unhide = hiddenHere.filter((h) => h.key && keys.has(h.key));
		const rest = chosen.filter((n) => !unhide.some((h) => h.key === n.element.key));
		const exposed = savedView
			? planExpose(
					savedView,
					rest.map((n) => n.element),
					ctx
				)
			: null;
		const label =
			chosen.length === 1
				? `Added ${chosen[0]!.element.label} to this diagram`
				: `Added ${chosen.length} connected elements to this diagram`;
		const after = generation;
		const error = await undoable(workspace, label, async () => {
			if (exposed) {
				const refused = await applySteps(workspace, label, exposed.steps, checkSyntax);
				if (refused) return refused;
			}
			saveShown({
				hidden: shown.hidden.filter((h) => !unhide.some((u) => u.id === h)),
				added: savedView ? shown.added : [...shown.added, ...rest.map((n) => n.qualified)]
			});
			return null;
		});
		if (error) return error;
		if (savedView) addedCheck = { keys: [...keys], after };
		closeConnected();
		return null;
	}

	/** Copy a node's element under a free name, placed beside it and selected. */
	async function duplicateNode(id: string) {
		menu = null;
		const element = elementOf(id);
		const node = nodes.find((n) => n.id === id);
		if (!element || !node || isLibrary(element)) return;
		const planned = planDuplicate(element, ctx);
		if (typeof planned !== 'string') {
			const { x, y } = node.position;
			pendingPlace = {
				name: formatName(planned.name),
				at: { x: x + (node.width ?? 0) / 2 + 48, y: y + (node.height ?? 0) / 2 + 48 },
				until: Date.now() + 8000
			};
		}
		const { error, copy } = await duplicateElement(workspace, element, checkSyntax);
		if (error) {
			pendingPlace = null;
			toasts.show(error, { tone: 'error' });
		} else if (copy) ui.select(copy.key, 'diagram');
	}

	// ---- View as: a saved view shown as another kind of view ----

	const viewInfo = $derived(
		viewName
			? workspace.views.find((v) => v.name === viewName && v.isUsage && !v.builtin)
			: undefined
	);
	/** The saved view's own element, whose type "View as" changes. */
	const viewUsage = $derived(
		viewInfo
			? workspace.elements.find(
					(e) =>
						e.kind === 'view' &&
						!e.isDefinition &&
						e.file === viewInfo.file &&
						e.name === viewInfo.name
				)
			: undefined
	);
	const viewAs = $derived.by(() => {
		if (!viewInfo || !viewUsage) return [];
		const exposes = viewInfo.exposes ?? [];
		// The element it exposes: by the name it is written with, qualified as far as it is.
		const target = `::${(exposes[0] ?? '').replace(/::\*\*?$/, '').replace(/'/g, '')}`;
		const name = exposes[0] ? exposedName(exposes[0]) : null;
		const exposed = name
			? workspace.elements.find(
					(e) =>
						e.label === name &&
						!isLibrary(e) &&
						`::${qualifiedName(e, owners).replace(/'/g, '')}`.endsWith(target)
				)
			: undefined;
		const current = (viewInfo.standard ?? viewInfo.definition)?.split('::').pop();
		return viewAsChoices(current, exposes, exposed);
	});

	function openViewAs(point: XY) {
		const items: MenuItem[] = viewAs.map((choice) => ({
			label: choice.label,
			detail: choice.detail,
			icon: Shapes,
			run: () => void showViewAs(choice.name)
		}));
		const at = inCanvas({ x: point.x - 236, y: point.y }, 236, 48 + items.length * 52);
		menu = { title: `Show ${viewInfo?.name ?? 'this view'} as`, items, ...at };
	}

	/**
	 * Change the saved view's type in place, as one undoable step; its
	 * positions and hidden elements go with it to the new kind of diagram.
	 */
	async function showViewAs(to: StandardView) {
		if (!viewInfo || !viewUsage) return;
		const plan = planViewAs(viewUsage, to, ctx);
		if (typeof plan === 'string') {
			toasts.show(plan, { tone: 'error' });
			return;
		}
		const next = presentationOf({ ...viewInfo, definition: to, standard: undefined });
		const nextKey = next.kind === 'diagram' ? diagramKey(next.view, next.scope) : null;
		const error = await undoable(workspace, plan.label, async () => {
			const refused = await applySteps(workspace, plan.label, plan.steps, checkSyntax);
			if (refused) return refused;
			if (nextKey && nextKey !== layoutKey) {
				const current = workspace.text(LAYOUT_FILE);
				const positions = parseLayout(current);
				const kept = parseShown(current);
				const moved = withPositions(
					positions,
					nextKey,
					Object.fromEntries(
						Object.entries(positions[layoutKey] ?? {}).map(([id, [x, y]]) => [id, { x, y }])
					)
				);
				const text = serializeLayout(
					moved,
					kept[layoutKey] ? withShown(kept, nextKey, kept[layoutKey]) : kept
				);
				if (text !== (current ?? '{}\n')) workspace.setText(LAYOUT_FILE, text);
			}
			return null;
		});
		if (error) toasts.show(error, { tone: 'error' });
	}

	/** Put hidden nodes back on this diagram (one undoable step). */
	async function showAgain(ids: string[] | 'all') {
		const names = hiddenHere.filter((h) => ids === 'all' || ids.includes(h.id)).map((h) => h.label);
		const label =
			names.length === 1
				? `Showed ${names[0]} again on this diagram`
				: `Showed ${names.length} hidden elements again on this diagram`;
		await undoable(workspace, label, async () => {
			saveShown({ hidden: ids === 'all' ? [] : shown.hidden.filter((h) => !ids.includes(h)) });
			return null;
		});
	}

	function askDeleteEdge(edge: Edge<SysmlEdgeData>) {
		menu = null;
		const written = edge.data?.element;
		if (behavior && written) {
			const label = (id: string) => nodes.find((n) => n.id === id)?.data.node.label || id;
			const fromKind = nodes.find((n) => n.id === edge.source)?.data.node.kind;
			const what =
				fromKind === 'initial_state'
					? `${label(edge.target)} is no longer where it starts`
					: view === 'states'
						? `Removed the transition from ${label(edge.source)} to ${label(edge.target)}`
						: `${label(edge.source)} no longer goes to ${label(edge.target) || 'done'}`;
			const plan = planRemoveEdge(written, what, ctx);
			if (typeof plan === 'string') {
				toasts.show(plan);
				return;
			}
			confirmError = null;
			confirm = {
				title: view === 'states' ? 'Delete this transition?' : 'Delete this line?',
				detail: plan.label + '.',
				statement: plan.statement,
				action: 'Delete',
				run: async () => {
					const ref = refOf(edge);
					await settle();
					const now = edgeNow(ref)?.data?.element;
					const again = now
						? planRemoveEdge(now, what, ctx)
						: 'This line is no longer in the model.';
					return typeof again === 'string'
						? again
						: applySteps(workspace, again.label, again.steps, checkSyntax);
				}
			};
			return;
		}
		const [from, to] = edge.data?.reversed
			? [edge.target, edge.source]
			: [edge.source, edge.target];
		const source = elementOf(from);
		const target = elementOf(to);
		if (!source || !target || !edge.data) return;
		const plan = planEdgeRemoval(edge.data.kind, edge.data.label, source, target, ctx);
		if (typeof plan === 'string') {
			toasts.show(plan);
			return;
		}
		confirmError = null;
		confirm = {
			title: 'Remove this relationship?',
			detail: plan.label + '.',
			statement: plan.statement,
			action: 'Remove',
			run: () => applySteps(workspace, plan.label, plan.steps, checkSyntax)
		};
	}

	async function runConfirm() {
		if (!confirm) return;
		const focus = confirm.focus;
		confirmError = await confirm.run();
		if (!confirmError) {
			confirm = null;
			if (focus) host.focus({ preventScroll: true });
		}
	}

	// ---- Export ----

	/** The whole drawing, for an SVG or PNG (the export code loads on first use). */
	async function exportDiagram() {
		const { collectDiagram } = await import('./export/collect.ts');
		return collectDiagram(host, frameTitle, view, nodes, edges, labels.positions);
	}

	// ---- Input ----

	const isTyping = (event: Event) =>
		event.target instanceof HTMLElement &&
		!!event.target.closest('input, textarea, select, [contenteditable="true"]');

	function nodeIdIn(target: EventTarget | null): string | null {
		return (
			(target as HTMLElement | null)?.closest?.<HTMLElement>('.svelte-flow__node')?.dataset.id ??
			null
		);
	}

	function edgeIn(target: EventTarget | null): Edge<SysmlEdgeData> | undefined {
		const id = (target as Element | null)?.closest?.('.svelte-flow__edge')?.getAttribute('data-id');
		return id ? edges.find((e) => e.id === id) : undefined;
	}

	/** Before Svelte Flow sees the key: Enter renames a selected node, or picks a target. */
	function onkeydowncapture(event: KeyboardEvent) {
		if (isTyping(event)) return;
		const id = nodeIdIn(event.target);
		if (!id) return;
		const node = nodes.find((n) => n.id === id);
		const from = editing.connectingFrom;
		if (from && (event.key === 'Enter' || event.key === ' ') && id !== from) {
			event.preventDefault();
			event.stopPropagation();
			const target = connectTargets.find((t) => t.id === id);
			if (target) pickTarget(target);
			else toasts.show(`Nothing to draw to ${node?.data.node.label ?? id}.`);
			return;
		}
		if (
			(event.key === 'F2' || (event.key === 'Enter' && node?.data.selected)) &&
			node?.data.editable
		) {
			event.preventDefault();
			event.stopPropagation();
			editing.startRename(id);
			return;
		}
		if (event.key === 'Enter' || event.key === ' ') {
			const element = elementOf(id);
			if (element) ui.select(element.key, 'diagram');
		}
	}

	function onkeydown(event: KeyboardEvent) {
		if (isTyping(event) || event.defaultPrevented) return;
		const id = nodeIdIn(event.target) ?? selectedNode?.id ?? null;
		const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
		if (event.key === 'Escape' && editing.connectingFrom) {
			event.preventDefault();
			cancelConnect();
		} else if (event.key === 'Enter' && plain && edgeIn(event.target)?.data?.editable) {
			// A transition or a branch: Enter opens the form that changes it.
			event.preventDefault();
			const edge = edgeIn(event.target)!;
			void editEdge(edge.id, underNode(edge.source));
		} else if ((event.key === 'Delete' || event.key === 'Backspace') && plain) {
			const edge = edgeIn(event.target) ?? edges.find((e) => e.selected);
			if (nodeIdIn(event.target) || (!edge && id)) {
				event.preventDefault();
				if (id) askDeleteNode(id);
			} else if (edge) {
				event.preventDefault();
				askDeleteEdge(edge);
			}
		} else if (event.key.toLowerCase() === 'c' && plain && !event.shiftKey && id) {
			event.preventDefault();
			startConnect(id);
		} else if (
			event.key.toLowerCase() === 'd' &&
			(isMac ? event.metaKey : event.ctrlKey) &&
			!event.altKey &&
			!event.shiftKey &&
			id
		) {
			// Before the browser's bookmark shortcut, and the workbench's own (for other panes).
			event.preventDefault();
			void duplicateNode(id);
		} else if (event.key.toLowerCase() === 'h' && plain && !event.shiftKey && id) {
			event.preventDefault();
			void removeFromDiagram(id);
		} else if ((event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) && id) {
			event.preventDefault();
			openNodeMenu(id);
		}
	}

	function onkeyup(event: KeyboardEvent) {
		// Nodes moved with the arrow keys keep their place too.
		if (!event.key.startsWith('Arrow') || !nodeIdIn(event.target)) return;
		const moved = nodes.filter((n) => n.selected);
		if (moved.length) pinAll();
	}

	// Long-press on touch: the node's actions, as a right-click would show.
	let press: { id: string; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null =
		null;
	function onpointerdowncapture(event: PointerEvent) {
		if (event.pointerType === 'mouse') return;
		const id = nodeIdIn(event.target);
		if (!id || isTyping(event)) return;
		const at = { x: event.clientX, y: event.clientY };
		press = {
			id,
			...at,
			timer: setTimeout(() => {
				press = null;
				navigator.vibrate?.(8);
				openNodeMenu(id, at);
			}, 520)
		};
	}
	function endPress(event: PointerEvent) {
		if (!press) return;
		if (
			event.type === 'pointermove' &&
			Math.hypot(event.clientX - press.x, event.clientY - press.y) < 10
		) {
			return;
		}
		clearTimeout(press.timer);
		press = null;
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="canvas"
	aria-label={label}
	role="region"
	tabindex="-1"
	bind:this={host}
	{onkeydowncapture}
	{onkeydown}
	{onkeyup}
	{onpointerdowncapture}
	onpointermove={endPress}
	onpointerup={endPress}
	onpointercancel={endPress}
>
	<svg class="markers" aria-hidden="true">
		<defs>
			{@render markers('', 'var(--text-2)')}
			<!-- The same, for the highlighted connections of the selected node. -->
			{@render markers('-lit', 'var(--accent)')}
		</defs>
	</svg>

	{#if status === 'error'}
		<p class="state" role="alert">This view could not be drawn: {message}</p>
	{:else if status === 'too-large'}
		<p class="state" role="status">{message}</p>
	{:else if status === 'ready' && nodes.length === 0 && hiddenHere.length}
		<div class="empty-diagram">
			<EmptyState
				title="Everything on this diagram is hidden."
				actions={[{ label: 'Show all', primary: true, run: () => void showAgain('all') }]}
			>
				The elements are still in the model; this diagram only leaves them out.
			</EmptyState>
		</div>
	{:else if status === 'ready' && nodes.length === 0}
		<div class="empty-diagram">
			<EmptyState
				title="Nothing to show in this view yet."
				actions={addOwner
					? [
							{
								label:
									view === 'states' ? 'Add a state' : view === 'actions' ? 'Add a step' : 'Add',
								primary: true,
								run: () => {
									actionError = null;
									popover = 'add';
								}
							},
							{ label: 'How diagrams work', run: () => ui.showHelp('text-diagrams-tables') }
						]
					: [{ label: 'How diagrams work', run: () => ui.showHelp('text-diagrams-tables') }]}
			>
				{#if view === 'states'}
					Add the states it can be in, then draw a transition from one to the next.
				{:else if view === 'actions'}
					Add the steps, then draw what comes next from each one.
				{:else}
					Add a part, a requirement or a package here, or write it in the text: the diagram follows.
				{/if}
			</EmptyState>
		</div>
	{/if}

	<SvelteFlow
		bind:nodes
		bind:edges
		{nodeTypes}
		{edgeTypes}
		fitView
		fitViewOptions={FIT}
		minZoom={0.15}
		colorMode={theme.choice}
		class={editing.dragging || editing.connectingFrom ? 'connecting' : undefined}
		nodesConnectable
		connectionMode={ConnectionMode.Loose}
		connectionRadius={28}
		clickConnect={false}
		deleteKey={null}
		connectionLineStyle="stroke: var(--accent); stroke-width: 2; stroke-dasharray: 6 4;"
		ariaLabelConfig={{
			'node.a11yDescription.default':
				'Press Enter to select. Then Enter or F2 renames, C connects it to another element, H removes it from this diagram, Delete deletes it from the model, and Shift+F10 lists all actions.',
			'node.a11yDescription.keyboardDisabled':
				'Press Enter to select. Then Enter or F2 renames, C connects, H removes it from this diagram, Delete deletes it from the model, arrow keys move it.',
			'edge.a11yDescription.default':
				'Press Enter to select a relationship, then Delete to remove its statement.'
		}}
		onbeforeconnect={() => null}
		onconnectstart={() => {
			menu = null;
			editing.dragging = true;
		}}
		onconnectend={(event, state) => {
			editing.dragging = false;
			const from = state.fromNode?.id;
			const point = pointOf(event);
			const to = state.toNode?.id ?? nodeIdAt(point);
			if (!from || !to || (from === to && !behavior)) return;
			if (behavior) {
				void linkNodes(from, to, point);
				return;
			}
			const target = elementOf(to);
			if (!target) {
				toasts.show('That node is not an element of the model.');
				return;
			}
			openRelation(from, target, point);
		}}
		onnodeclick={({ node }) => {
			if (editing.connectingFrom) {
				if (node.id === editing.connectingFrom) return;
				const target = connectTargets.find((t) => t.id === node.id);
				if (target) pickTarget(target);
				else toasts.show(`Nothing to draw to ${node.data.node.label}.`);
				return;
			}
			const element = elementOf(node.id);
			if (element) ui.select(element.key, 'diagram');
		}}
		onnodecontextmenu={({ node, event }) => {
			event.preventDefault();
			if (press) {
				clearTimeout(press.timer);
				press = null;
			}
			openNodeMenu(node.id, { x: event.clientX, y: event.clientY });
		}}
		onedgeclick={({ edge }) => {
			// A named transition shows in the inspector, where it can be changed too.
			const named = edgeElement((edge as Edge<SysmlEdgeData>).data?.element);
			if (behavior && named) ui.select(named.key, 'diagram');
		}}
		onedgecontextmenu={({ edge, event }) => {
			event.preventDefault();
			openEdgeMenu(edge as Edge<SysmlEdgeData>, { x: event.clientX, y: event.clientY });
		}}
		onnodedragstop={({ nodes: moved }) => {
			if (moved.length) pinAll();
		}}
		onpaneclick={({ event }) => {
			popover = null;
			menu = null;
			dismissed = selected?.key ?? null;
			if (flow) lastClick = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
		}}
	>
		<FlowBridge onready={(api) => (flow = api)} />
		<Background gap={20} />
		<Controls showLock={false} />
		{#if reviewMarks.shown && (markedHere || removedHere.length)}
			<Panel position="bottom-right">
				<div class="review-legend" role="note" aria-label="Review changes">
					<strong>Review</strong>
					<span class="key added">{MARK_WORDS.added.badge}</span>
					<span class="key changed">{MARK_WORDS.changed.badge}</span>
					{#if removedHere.length}
						<span class="removed"
							>Removed: {removedHere
								.slice(0, 3)
								.map((r) => r.label)
								.join(', ')}{removedHere.length > 3
								? ` and ${removedHere.length - 3} more`
								: ''}</span
						>
					{/if}
					<button type="button" onclick={() => (reviewMarks.visible = false)}>Hide marks</button>
				</div>
			</Panel>
		{/if}
		{#if hiddenHere.length}
			<Panel position="bottom-center">
				<HiddenPanel hidden={hiddenHere} onshow={(ids) => void showAgain(ids)} />
			</Panel>
		{/if}
		{#if lastClick && popover === 'add'}
			<ViewportPortal target="front">
				<div
					class="drop-point"
					style:transform="translate({lastClick.x}px, {lastClick.y}px)"
					aria-hidden="true"
				></div>
			</ViewportPortal>
		{/if}
		{#if frameTitle}
			<Panel position="top-left" style={frameBelow ? `top: ${toolbarHeight + 10}px` : undefined}>
				<p
					class="frame"
					title="Diagram frame: {frameTitle}"
					style:max-width="{frameBelow ? hostWidth - 32 : frameRoom}px"
				>
					{frameTitle}
				</p>
			</Panel>
		{/if}
		<Panel position="top-right">
			<div
				class="toolbar"
				role="toolbar"
				aria-label="Diagram tools"
				bind:clientWidth={toolbarWidth}
				bind:clientHeight={toolbarHeight}
			>
				{#if runnable}
					<button
						type="button"
						class="run"
						title="Run this state machine step by step"
						onclick={() =>
							runnable &&
							ui.open({
								kind: 'emulator',
								machine: runnable.qualifiedName ?? runnable.name,
								title: runnable.name
							})}
					>
						<Play size={14} /> <span>Run</span>
					</button>
				{/if}
				<button
					type="button"
					onclick={() => {
						actionError = null;
						popover = popover === 'add' ? null : 'add';
					}}
					disabled={!addOwner}
					aria-expanded={popover === 'add'}
					title={addOwner
						? `Add to ${addOwner.label}${lastClick ? ', where you last clicked' : ''}`
						: 'Select a package or definition first'}
				>
					<Plus size={15} /> <span>Add</span>
				</button>
				<button
					type="button"
					onclick={() => selectedNode && startConnect(selectedNode.id)}
					disabled={!selectedNode?.data.editable}
					aria-pressed={!!editing.connectingFrom}
					title={view === 'states'
						? 'Draw a transition from the selected state (C). You can also drag from the dots around a state.'
						: view === 'actions'
							? 'Draw what comes next after the selected step (C). You can also drag from the dots around a step.'
							: 'Draw a relationship from the selected element (C). You can also drag from the dots around a node.'}
				>
					{#if view === 'states'}<Spline size={14} /> <span>Transition</span>
					{:else if view === 'actions'}<ArrowRight size={14} /> <span>Next step</span>
					{:else}<Cable size={14} /> <span>Connect</span>{/if}
				</button>
				<button
					type="button"
					onclick={startRenameSelected}
					disabled={!selected || isLibrary(selected)}
					aria-expanded={popover === 'rename'}
					title="Rename (F2, or double-click the name)"
				>
					<Pencil size={14} /> <span>Rename</span>
				</button>
				<button
					type="button"
					onclick={() =>
						selected &&
						(behavior && selectedNode
							? askDeleteNode(selectedNode.id)
							: askDeleteElement(selected, selectedNode?.id))}
					disabled={!selected || isLibrary(selected)}
					title="Delete (Delete key)"
				>
					<Trash2 size={14} /> <span>Delete</span>
				</button>
				<button
					type="button"
					onclick={() => {
						savePositions(null);
						void refresh(true);
					}}
					title="Lay the diagram out again and forget the positions you set"
				>
					<LayoutGrid size={14} /> <span>Tidy up</span>
				</button>
				{#if viewAs.length}
					<button
						type="button"
						aria-haspopup="menu"
						title="Show this view as another kind of diagram"
						onclick={(e) => {
							const r = e.currentTarget.getBoundingClientRect();
							openViewAs({ x: r.right, y: r.bottom + 6 });
						}}
					>
						<Shapes size={14} /> <span>View as</span>
					</button>
				{/if}
				<DiagramExport
					title={label.replace(/ diagram$/, '')}
					diagram={exportDiagram}
					share={ui.phone}
					disabled={status !== 'ready' || nodes.length === 0}
				/>
			</div>
			{#if popover === 'add' && behavior && subject && !narrow}
				<div class="popover">
					{@render behaviorAdd()}
				</div>
			{:else if popover === 'add' && owner && !behavior}
				<div class="popover">
					<AddForm
						ownerLabel={owner.label}
						kinds={ownerKinds}
						onadd={async (kind, name, type) => {
							const target = owner;
							const error = await addElement(workspace, target, kind, name, type);
							if (!error) {
								popover = null;
								const rect = host.getBoundingClientRect();
								const at =
									lastClick ??
									flow?.screenToFlowPosition({
										x: rect.left + rect.width / 2,
										y: rect.top + rect.height / 2
									});
								if (at) pendingPlace = { name: formatName(name), at, until: Date.now() + 8000 };
								pendingSelect = { name: formatName(name), owner: target.name };
								lastClick = null;
							}
							return error;
						}}
						oncancel={() => (popover = null)}
					/>
				</div>
			{:else if popover === 'rename' && selected}
				<form
					class="popover small"
					onsubmit={async (e) => {
						e.preventDefault();
						actionError = await renameElement(workspace, selected, renameTo);
						if (!actionError) popover = null;
					}}
				>
					<label>
						<span>Rename {selected.label}</span>
						<!-- svelte-ignore a11y_autofocus -->
						<input bind:value={renameTo} autofocus />
					</label>
					<p class="hint">References in every file are updated.</p>
					{#if actionError}<p class="error" role="alert">{actionError}</p>{/if}
					<button type="submit" class="primary">Rename</button>
				</form>
			{/if}
		</Panel>
	</SvelteFlow>

	{#if editing.connectingFrom}
		{@const source = nodes.find((n) => n.id === editing.connectingFrom)}
		<ConnectPicker
			source={source?.data.node.label ?? editing.connectingFrom}
			targets={connectTargets}
			touch={coarse}
			onpick={pickTarget}
			oncancel={cancelConnect}
		/>
	{/if}

	{#if relation}
		<RelationPopover
			source={relation.source}
			target={relation.target}
			options={relation.options}
			{ctx}
			x={relation.x}
			y={relation.y}
			sheet={hostWidth < 560}
			onapply={applyPlan}
			onclose={() => {
				const back = relation?.sourceId;
				relation = null;
				focusNode(back);
			}}
		/>
	{/if}

	{#if popover === 'add' && behavior && subject && narrow}
		<FormPanel label="Add to {subject.label}" mode="sheet" onclose={() => (popover = null)}>
			{@render behaviorAdd()}
		</FormPanel>
	{/if}

	{#if behaviorForm?.kind === 'transition'}
		<TransitionForm
			from={behaviorForm.from}
			to={behaviorForm.to}
			initial={behaviorForm.initial}
			signals={signalChoices(ctx)}
			values={behaviorForm.values}
			plan={behaviorForm.plan}
			submitLabel={behaviorForm.submit}
			mode={formMode}
			x={behaviorForm.x}
			y={behaviorForm.y}
			prepare={settle}
			onapply={applyFromForm}
			onclose={closeBehaviorForm}
		/>
	{:else if behaviorForm?.kind === 'branch'}
		<BranchForm
			from={behaviorForm.from}
			to={behaviorForm.to}
			initial={behaviorForm.initial}
			values={behaviorForm.values}
			plan={behaviorForm.plan}
			submitLabel={behaviorForm.submit}
			mode={formMode}
			x={behaviorForm.x}
			y={behaviorForm.y}
			prepare={settle}
			onapply={applyFromForm}
			onclose={closeBehaviorForm}
		/>
	{:else if behaviorForm?.kind === 'state'}
		{@const state = fresh(behaviorForm.state)}
		<StateActionsForm
			stateName={state.label}
			current={stateActions(state, ctx)}
			values={valuesAround(state, ctx)}
			plan={(kind, action) => planStateAction(state, kind, action, ctx)}
			mode={formMode}
			x={behaviorForm.x}
			y={behaviorForm.y}
			prepare={settle}
			onapply={applyFromForm}
			onclose={closeBehaviorForm}
		/>
	{/if}

	{#if connected}
		<ConnectedForm
			name={connected.name}
			wired={view === 'interconnection'}
			neighbours={connected.list.map((n) => ({ label: n.element.label, direction: n.direction }))}
			mode={formMode}
			x={connected.x}
			y={connected.y}
			onapply={addConnected}
			onclose={closeConnected}
		/>
	{/if}

	{#if menu}
		<NodeMenu
			title={menu.title}
			items={menu.items}
			x={menu.x}
			y={menu.y}
			sheet={narrow}
			onclose={(restore) => {
				const back = menu?.focus;
				menu = null;
				if (restore) focusNode(back);
			}}
		/>
	{/if}

	{#if confirm}
		<div
			class="confirm"
			role="alertdialog"
			aria-label={confirm.title}
			aria-describedby="diagram-confirm-detail"
			tabindex="-1"
			onkeydown={(e) => {
				e.stopPropagation();
				if (e.key === 'Escape') {
					const back = confirm?.focus;
					confirm = null;
					focusNode(back);
				}
			}}
		>
			<p class="confirm-title">{confirm.title}</p>
			<p id="diagram-confirm-detail" class="hint">
				{confirm.detail}
				{#if confirm.impact}<span class="impact" role="status">{confirm.impact}</span>{/if}
			</p>
			{#if confirm.statement}<code class="statement">{confirm.statement}</code>{/if}
			{#if confirmError}<p class="error" role="alert">{confirmError}</p>{/if}
			<div class="confirm-actions">
				<button
					type="button"
					class="quiet"
					onclick={() => {
						const back = confirm?.focus;
						confirm = null;
						focusNode(back);
					}}>Cancel</button
				>
				<!-- svelte-ignore a11y_autofocus -->
				<button type="button" class="danger" autofocus onclick={runConfirm}>{confirm.action}</button
				>
			</div>
		</div>
	{/if}
</div>

{#snippet behaviorAdd()}
	<BehaviorAddForm
		view={view as 'states' | 'actions'}
		owners={behaviorOwners}
		flat={narrow}
		initialOwner={addInside}
		plan={planAdd}
		suggest={(o, kind) =>
			suggestName(o, kind === 'decide' ? 'decision' : kind === 'action' ? 'step' : kind, ctx)}
		starts={(o) => (view === 'states' ? !!startOf(o, ctx) : flowStarts(o, ctx))}
		prepare={settle}
		onapply={addBehavior}
		oncancel={() => (popover = null)}
	/>
{/snippet}

{#snippet markers(suffix: string, ink: string)}
	<marker
		id="sysml-specialization{suffix}"
		viewBox="0 0 12 12"
		refX="11"
		refY="6"
		markerWidth="14"
		markerHeight="14"
		orient="auto-start-reverse"
	>
		<path d="M1 1 L11 6 L1 11 Z" fill="var(--surface)" stroke={ink} stroke-width="1.2" />
	</marker>
	<marker
		id="sysml-typing{suffix}"
		viewBox="0 0 20 12"
		refX="19"
		refY="6"
		markerWidth="22"
		markerHeight="14"
		orient="auto-start-reverse"
	>
		<rect x="0" y="3.5" width="9" height="5" fill="var(--surface)" />
		<circle cx="2" cy="6" r="1.4" fill={ink} />
		<circle cx="6" cy="6" r="1.4" fill={ink} />
		<path d="M9 1 L19 6 L9 11 Z" fill="var(--surface)" stroke={ink} stroke-width="1.2" />
	</marker>
	<marker
		id="sysml-composition{suffix}"
		viewBox="0 0 16 10"
		refX="15"
		refY="5"
		markerWidth="16"
		markerHeight="10"
		orient="auto-start-reverse"
	>
		<path d="M1 5 L8 1 L15 5 L8 9 Z" fill={ink} />
	</marker>
	<marker
		id="sysml-membership{suffix}"
		viewBox="0 0 14 14"
		refX="12.6"
		refY="7"
		markerWidth="14"
		markerHeight="14"
		orient="auto-start-reverse"
	>
		<circle cx="7" cy="7" r="5.6" fill="var(--surface)" stroke={ink} stroke-width="1.2" />
		<path d="M7 3.6 V10.4 M3.6 7 H10.4" stroke={ink} stroke-width="1.2" />
	</marker>
	<marker
		id="sysml-open-arrow{suffix}"
		viewBox="0 0 12 12"
		refX="11"
		refY="6"
		markerWidth="12"
		markerHeight="12"
		orient="auto-start-reverse"
	>
		<path d="M1 1 L11 6 L1 11" fill="none" stroke={ink} stroke-width="1.3" />
	</marker>
	<marker
		id="sysml-arrow{suffix}"
		viewBox="0 0 12 12"
		refX="11"
		refY="6"
		markerWidth="11"
		markerHeight="11"
		orient="auto-start-reverse"
	>
		<path d="M1 1 L11 6 L1 11 Z" fill={ink} />
	</marker>
{/snippet}

<style>
	.canvas {
		container-type: size;
		position: relative;
		height: 100%;
		min-height: 18rem;
		background: var(--bg);
	}
	.markers {
		position: absolute;
		width: 0;
		height: 0;
	}
	.empty-diagram {
		position: absolute;
		inset: 28% var(--space-4) auto;
		z-index: 4;
		pointer-events: none;
	}
	.empty-diagram :global(.empty-state) {
		pointer-events: auto;
		border-radius: var(--radius-lg);
		background: color-mix(in oklab, var(--surface) 85%, transparent);
	}
	.state {
		position: absolute;
		inset: 40% 0 auto;
		z-index: 4;
		text-align: center;
		color: var(--text-2);
		pointer-events: none;
	}
	.toolbar {
		display: flex;
		gap: 2px;
		padding: 3px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-sm);
	}
	.toolbar button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 2rem;
		padding: 0 var(--space-3);
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text);
		font-weight: 520;
		cursor: pointer;
	}
	.toolbar .run {
		/* The behaviour green, deep enough to read as text (WCAG AA). */
		color: color-mix(in oklab, var(--kind-behavior) 78%, var(--text));
		font-weight: 650;
	}
	.toolbar button:hover:not(:disabled) {
		background: var(--surface-hover);
	}
	@container (max-width: 34rem) {
		.toolbar button span {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
		.toolbar button {
			padding: 0 var(--space-2);
		}
	}
	.toolbar button:disabled {
		color: var(--text-3);
		cursor: default;
	}
	.popover {
		display: flex;
		justify-content: flex-end;
		margin-top: var(--space-2);
	}
	/* The SysML diagram frame label: name in a box with a cut corner. */
	.frame {
		margin: 0;
		padding: 3px 18px 4px 10px;
		background: var(--surface);
		border: 1px solid var(--border-strong);
		clip-path: polygon(0 0, 100% 0, 100% 55%, calc(100% - 10px) 100%, 0 100%);
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: 12px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.popover.small {
		display: grid;
		gap: var(--space-2);
		width: min(18rem, 80vw);
		padding: var(--space-4);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-lg);
	}
	.popover label {
		display: grid;
		gap: var(--space-1);
		font-size: var(--text-sm);
		color: var(--text-2);
	}
	.popover input {
		height: 2.25rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
	}
	.hint {
		color: var(--text-3);
		font-size: var(--text-xs);
	}
	.error {
		color: var(--danger);
		font-size: var(--text-sm);
	}
	.popover button {
		justify-self: end;
		height: 2.125rem;
		padding: 0 var(--space-4);
		border: 0;
		border-radius: var(--radius-sm);
		font-weight: 560;
		cursor: pointer;
	}
	.primary {
		background: var(--accent);
		color: var(--accent-text);
	}
	.danger {
		background: var(--danger);
		color: var(--surface);
	}
	.canvas :global(.svelte-flow) {
		--xy-background-color: var(--bg);
		--xy-background-pattern-color: var(--border);
		--xy-controls-button-background-color: var(--surface);
		--xy-controls-button-color: var(--text-2);
		--xy-controls-button-border-color: var(--border);
		--xy-node-border-radius: 0;
	}
	.canvas :global(.svelte-flow__attribution) {
		background: transparent;
	}
	.canvas :global(.svelte-flow__attribution a) {
		color: var(--text-3);
	}
	.canvas :global(.svelte-flow__node-sysml) {
		padding: 0;
		border: 0;
		background: transparent;
	}
	.canvas:focus {
		outline: none;
	}
	/* Where "Add" will place a new element. */
	.drop-point {
		position: absolute;
		width: 18px;
		height: 18px;
		margin: -9px 0 0 -9px;
		border: 2px solid var(--accent);
		border-radius: 50%;
		background: color-mix(in oklab, var(--accent) 18%, transparent);
		pointer-events: none;
		animation: ping 1.6s var(--ease) infinite;
	}
	@keyframes ping {
		50% {
			box-shadow: 0 0 0 8px color-mix(in oklab, var(--accent) 12%, transparent);
		}
	}
	.confirm {
		position: absolute;
		top: 56px;
		left: 50%;
		z-index: 25;
		translate: -50% 0;
		display: grid;
		gap: var(--space-2);
		width: min(22rem, calc(100% - 24px));
		padding: var(--space-4);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
	}
	.confirm p {
		margin: 0;
	}
	.confirm-title {
		font-weight: 650;
	}
	.impact {
		display: block;
		margin-top: var(--space-1);
		color: var(--text-2);
	}
	.statement {
		overflow-wrap: anywhere;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--surface-2);
		font-family: var(--font-mono);
		font-size: 12px;
	}
	.confirm-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		margin-top: var(--space-1);
	}
	.confirm-actions button {
		height: 2.25rem;
		padding: 0 var(--space-4);
		border: 0;
		border-radius: var(--radius-sm);
		font: inherit;
		font-weight: 580;
		cursor: pointer;
	}
	.quiet {
		background: transparent;
		color: var(--text-2);
	}
	.quiet:hover {
		background: var(--surface-hover);
	}
	.toolbar button[aria-pressed='true'] {
		background: var(--accent-weak);
		color: var(--accent);
	}
	/* Review mode's legend: what the marks mean, and what was removed (not drawn). */
	.review-legend {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		max-width: min(28rem, calc(100vw - 7rem));
		padding: 6px 8px 6px 10px;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: color-mix(in oklab, var(--surface) 94%, transparent);
		box-shadow: var(--shadow-md);
		color: var(--text-2);
		font-size: var(--text-xs);
	}
	.review-legend strong {
		color: var(--text);
		font-weight: 650;
	}
	.review-legend .key {
		padding: 0 6px;
		border: 1.5px solid;
		border-radius: var(--radius-pill);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.02em;
		text-transform: uppercase;
	}
	.review-legend .key.added {
		border-color: var(--ok);
		color: var(--ok);
	}
	.review-legend .key.changed {
		border-color: var(--warn);
		color: var(--warn);
	}
	.review-legend .removed {
		color: var(--danger);
		overflow-wrap: anywhere;
	}
	.review-legend button {
		min-height: 1.75rem;
		padding: 0 6px;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 600;
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
	}
</style>
