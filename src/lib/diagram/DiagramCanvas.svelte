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
	import { Cable, FileCode, LayoutGrid, Pencil, Play, Plus, Trash2, Unlink } from '@lucide/svelte';
	import type { Engine } from '#lib/engine/client.ts';
	import type { DiagramGraph, DiagramView } from '#lib/engine/types.ts';
	import type { ModelElement } from '#lib/project/elements.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import { theme } from '#lib/ui/theme.svelte.ts';
	import { toasts } from '#lib/ui/toasts.svelte.ts';
	import { addElement, applySteps, deleteElement, renameElement } from '#lib/workbench/actions.ts';
	import AddForm from '#lib/workbench/AddForm.svelte';
	import { canOwnMembers, formatName, type AddKind } from '#lib/workbench/templates.ts';
	import type { WorkbenchUi } from '#lib/workbench/ui.svelte.ts';
	import ConnectPicker, { type ConnectTarget } from './ConnectPicker.svelte';
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
	import { ownersOf, resolveNode } from './model.ts';
	import NodeMenu, { type MenuItem } from './NodeMenu.svelte';
	import {
		LAYOUT_FILE,
		diagramKey,
		parseLayout,
		placeAround,
		renamedNode,
		serializeLayout,
		withPositions,
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
	import SysmlNode from './SysmlNode.svelte';
	import type { SysmlEdgeData, SysmlNodeData } from './types.ts';

	let {
		view,
		scope,
		workspace,
		ui,
		engine,
		label
	}: {
		view: DiagramView;
		scope: string | null;
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
	const FIT = { padding: 0.15, maxZoom: 1.1 };

	let nodes = $state.raw<Node<SysmlNodeData>[]>([]);
	let edges = $state.raw<Edge<SysmlEdgeData>[]>([]);
	let status = $state<'loading' | 'ready' | 'error' | 'too-large'>('loading');
	let message = $state('');
	let popover = $state<'add' | 'rename' | null>(null);
	let renameTo = $state('');
	let actionError = $state<string | null>(null);
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
			menu: (id, point) => openNodeMenu(id, point)
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

	function elementOf(id: string): ModelElement | undefined {
		const node = nodes.find((n) => n.id === id);
		if (node?.data.elementKey) {
			const known = workspace.elements.find((e) => e.key === node.data.elementKey);
			if (known) return known;
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
		let file = parseLayout(workspace.text(LAYOUT_FILE));
		if (drop.length && file[layoutKey]) {
			const kept = { ...file[layoutKey] };
			for (const id of drop) delete kept[id];
			file = { ...file, [layoutKey]: kept };
		}
		file = withPositions(file, layoutKey, update);
		const text = serializeLayout(file);
		if (text === (workspace.text(LAYOUT_FILE) ?? '{}\n')) return;
		workspace.setText(LAYOUT_FILE, text);
	}

	/**
	 * Once the person arranges a diagram, keep all of it as they see it:
	 * every node is pinned, so a reload shows exactly the same picture.
	 */
	function pinAll() {
		savePositions(Object.fromEntries(nodes.map((n) => [n.id, n.position])));
	}

	/** What the drawing covers: its nodes, and the routes and labels ELK placed beside them. */
	function drawingBounds() {
		const xs: number[] = [];
		const ys: number[] = [];
		for (const n of nodes) {
			xs.push(n.position.x, n.position.x + (n.width ?? 0));
			ys.push(n.position.y, n.position.y + (n.height ?? 0));
		}
		for (const e of edges) {
			const route = e.data?.route;
			if (!route) continue;
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

	function fit() {
		requestAnimationFrame(() =>
			requestAnimationFrame(() => {
				const bounds = drawingBounds();
				const duration = reducedMotion ? 0 : 280;
				if (!flow || !bounds || !host) return void flow?.fitView({ ...FIT, duration });
				const { clientWidth: width, clientHeight: height } = host;
				const viewport = getViewportForBounds(
					bounds,
					width,
					height,
					0.15,
					FIT.maxZoom,
					FIT.padding
				);
				void flow.setViewport(viewport, { duration });
			})
		);
	}

	async function refresh(relayout = false) {
		const current = ++generation;
		try {
			const graph = await engine.diagram(view, workspace.sourceFiles(), scope);
			if (current !== generation) return;
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
				const before = relayout ? undefined : (carried.get(n.id) ?? previous.get(n.id)?.position);
				if (pinned) fixed.set(n.id, { x: pinned[0], y: pinned[1] });
				else if (before) fixed.set(n.id, before);
				else if (pendingPlace && hadNodes && nameOf(n.id) === pendingPlace.name) {
					const size = sizes.get(n.id)!;
					fixed.set(n.id, {
						x: Math.round(pendingPlace.at.x - size.width / 2),
						y: Math.round(pendingPlace.at.y - size.height / 2)
					});
					dropped = n.id;
				}
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
						name: element?.label ?? null
					},
					ariaLabel: `${node.stereotype?.replace(/^<<|>>$/g, '') ?? node.kind} ${node.label}`
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
							route: route && from && to ? { ...route, from, to } : undefined
						}
					};
				});
			frameTitle = graph.title;
			status = 'ready';

			if (dropped) {
				pendingPlace = null;
				const p = positions.get(dropped)!;
				if (Object.keys(stored).length) savePositions({ [dropped]: p });
				else pinAll();
			}
			if (!hadNodes || relayout) fit();
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
		return () => clearTimeout(timer);
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
		openRelation(from, target.element, target.id ? underNode(target.id) : underNode(from));
	}

	// ---- Menus, rename, delete ----

	function openNodeMenu(id: string, point?: XY) {
		const element = elementOf(id);
		const node = nodes.find((n) => n.id === id);
		if (!node) return;
		const items: MenuItem[] = [];
		if (element && !isLibrary(element)) {
			items.push(
				{ label: 'Rename', icon: Pencil, shortcut: 'F2', run: () => editing.startRename(id) },
				{ label: 'Connect…', icon: Cable, shortcut: 'C', run: () => startConnect(id) }
			);
		}
		if (element) {
			items.push({ label: 'Show in text', icon: FileCode, run: () => showInText(element) });
		}
		if (element && !isLibrary(element)) {
			items.push({
				label: 'Delete',
				icon: Trash2,
				shortcut: 'Del',
				danger: true,
				run: () => askDeleteNode(id)
			});
		}
		if (!items.length) return;
		const at = inCanvas(point ?? underNode(id), 220, 48 + items.length * 40);
		menu = { title: node.data.node.label, items, ...at, focus: id };
	}

	function openEdgeMenu(edge: Edge<SysmlEdgeData>, point: XY) {
		const at = inCanvas(point, 220, 90);
		menu = {
			title: edge.ariaLabel ?? 'Relationship',
			items: [
				{ label: 'Delete relationship', icon: Unlink, danger: true, run: () => askDeleteEdge(edge) }
			],
			...at
		};
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
		askDeleteElement(element, id);
	}

	function askDeleteElement(element: ModelElement, focus?: string) {
		menu = null;
		confirmError = null;
		confirm = {
			title: `Delete ${element.label}?`,
			detail: `It is removed from ${element.file}. References to it elsewhere will show as problems.`,
			action: 'Delete',
			run: () => deleteElement(workspace, element),
			focus
		};
	}

	function askDeleteEdge(edge: Edge<SysmlEdgeData>) {
		menu = null;
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
	{:else if status === 'ready' && nodes.length === 0}
		<p class="state">Nothing to show in this view yet. Add an element to get started.</p>
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
				'Press Enter to select. Then Enter or F2 renames, C connects it to another element, Delete removes it, and Shift+F10 lists all actions.',
			'node.a11yDescription.keyboardDisabled':
				'Press Enter to select. Then Enter or F2 renames, C connects, Delete removes, arrow keys move it.',
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
			if (!from || !to || from === to) return;
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
					disabled={!owner}
					aria-expanded={popover === 'add'}
					title={owner
						? `Add to ${owner.label}${lastClick ? ', where you last clicked' : ''}`
						: 'Select a package or definition first'}
				>
					<Plus size={15} /> <span>Add</span>
				</button>
				<button
					type="button"
					onclick={() => selectedNode && startConnect(selectedNode.id)}
					disabled={!selectedNode?.data.editable}
					aria-pressed={!!editing.connectingFrom}
					title="Draw a relationship from the selected element (C). You can also drag from the dots around a node."
				>
					<Cable size={14} /> <span>Connect</span>
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
					onclick={() => selected && askDeleteElement(selected, selectedNode?.id)}
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
			</div>
			{#if popover === 'add' && owner}
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

	{#if menu}
		<NodeMenu
			title={menu.title}
			items={menu.items}
			x={menu.x}
			y={menu.y}
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
			<p id="diagram-confirm-detail" class="hint">{confirm.detail}</p>
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
		color: var(--kind-behavior);
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
</style>
