/** Workbench UI state: open tabs, the selected element and the phone layout. */
import type { DiagramView, MatrixElements } from '#lib/engine/types.ts';
import { isPhone } from '#lib/mobile/media.svelte.ts';
import type { AddKind } from './templates.ts';

export type Tab =
	| { kind: 'home' }
	| { kind: 'requirements' }
	/** `raw` shows a document (Markdown) as source rather than as a page. */
	| { kind: 'file'; path: string; raw?: boolean }
	| { kind: 'diagram'; view: DiagramView; scope: string | null; title: string }
	| { kind: 'view'; name: string; title: string }
	/** Run a state machine interactively. `machine` is its (qualified) name. */
	| { kind: 'emulator'; machine: string; title: string }
	/** A read-only file of the OMG standard library, at a line. */
	| { kind: 'library'; path: string; line?: number }
	/** What changed in the model since another version (review mode). */
	| { kind: 'review' };

/**
 * A guided form to open (`#lib/create`): a new view (optionally of a kind,
 * over an element), "add up this value" and "set a limit" on an element's
 * attribute (or a requirement), a new trade study, a new FMEA (of a kind),
 * a line of an FMEA worksheet (the view's name), a new hazard, the risk
 * policy, or a filtered table saved as a view.
 */
export type CreateRequest =
	| { kind: 'view'; viewKind?: string; target?: string }
	| { kind: 'rollup'; element: string; attribute: string }
	| {
			kind: 'limit';
			element: string;
			attribute?: string;
			/** Offer the other requirements too (the guide's "Set a limit" chose this one). */
			choose?: boolean;
	  }
	| { kind: 'trade'; alternatives?: string[] }
	| { kind: 'fmea'; fmeaKind?: string }
	| { kind: 'fmeaLine'; view: string }
	| { kind: 'hazard' }
	/** A new dependency matrix (DSM), of parts, steps or requirements, of an element (key). */
	| { kind: 'dsm'; elements?: MatrixElements; target?: string }
	| { kind: 'riskPolicy' }
	| {
			kind: 'savedReview';
			/** A name to start from. */
			title: string;
			/** The view def the saved view is typed by (qualified). */
			definition: string;
			exposes: string[];
			where: string;
			/** The filters kept and those left out, in words. */
			kept: string[];
			left: string[];
			/** The view it comes from, as people read its name. */
			about: string;
	  };

/**
 * A file form to open (`files/FileHost.svelte`): a new file (optionally in a
 * folder), or renaming, moving or deleting one of the project's files.
 */
export type FileRequest =
	{ kind: 'new'; folder?: string } | { kind: 'rename' | 'move' | 'delete'; path: string };

/** An element form to open (`ElementHost.svelte`): renaming it, or deleting it from the model. */
export interface ElementRequest {
	kind: 'rename' | 'delete';
	/** `ModelElement.key`. */
	key: string;
}

export type SelectionSource = 'text' | 'diagram' | 'explorer' | 'inspector' | 'table';

export interface Selection {
	/** `ModelElement.key`. */
	key: string;
	source: SelectionSource;
	/** Increments on every selection so views can react to re-selecting. */
	nonce: number;
}

/**
 * The phone's sections, chosen in the bottom navigation: the overview, the
 * model tree, and the open view (or the catalogue of views). Element details
 * are a sheet over any of them.
 */
export type MobilePane = 'home' | 'model' | 'views';
/** Older pane names, still accepted: each maps onto a section or a sheet. */
export type PaneRequest = MobilePane | 'explorer' | 'editor' | 'inspector' | 'problems';

/** How far the element details sheet is pulled up. */
export type SheetSnap = 'closed' | 'peek' | 'half' | 'full';

/** How a file tab shows its model: as text, as a diagram, or both side by side. */
export type FileLayout = 'text' | 'split' | 'diagram';

export function tabId(tab: Tab): string {
	switch (tab.kind) {
		case 'file':
			return `file:${tab.path}${tab.raw ? ':raw' : ''}`;
		case 'diagram':
			return `diagram:${tab.view}:${tab.scope ?? ''}`;
		case 'view':
			return `view:${tab.name}`;
		case 'emulator':
			return `emulator:${tab.machine}`;
		case 'library':
			return `library:${tab.path}`;
		default:
			return tab.kind;
	}
}

export function tabTitle(tab: Tab): string {
	switch (tab.kind) {
		case 'home':
			return 'Overview';
		case 'requirements':
			return 'Requirements';
		case 'file':
			return (tab.path.split('/').pop() ?? tab.path) + (tab.raw ? ' (source)' : '');
		case 'diagram':
		case 'view':
			return tab.title;
		case 'emulator':
			return tab.title;
		case 'library':
			return tab.path.split('/').pop() ?? tab.path;
		case 'review':
			return 'Review changes';
	}
}

export class WorkbenchUi {
	tabs = $state<Tab[]>([{ kind: 'home' }]);
	active = $state(0);
	/** How file tabs show their model. */
	layout = $state<FileLayout>('split');
	/** The command palette (⌘K). */
	paletteOpen = $state(false);
	selection = $state<Selection | null>(null);
	inspectorOpen = $state(true);
	problemsOpen = $state(false);
	/** The settings dialog (mounted by the host when it exists). */
	settingsOpen = $state(false);
	/** The source control (git) panel (mounted by the host when it exists). */
	sourceControlOpen = $state(false);
	/** The "import requirements from a spreadsheet" dialog (mounted by the host). */
	importOpen = $state(false);
	/** "Download as SysML v2 JSON" (mounted by the host). */
	exportJsonOpen = $state(false);
	/** "Connect to a SysML v2 API server" (mounted by the host). */
	apiServerOpen = $state(false);
	/** The guided form on show, if any (mounted by the host). */
	create = $state.raw<CreateRequest | null>(null);
	/** The file form on show, if any (mounted by the host). */
	fileRequest = $state.raw<FileRequest | null>(null);
	/** The element form on show, if any (mounted by the host). */
	elementRequest = $state.raw<ElementRequest | null>(null);
	/** The help guide (mounted by the host when first opened), at a topic. */
	helpOpen = $state(false);
	helpTopic = $state<string | null>(null);
	/** A requirement (`ModelElement.key`) whose "Add what satisfies it" picker should open. */
	satisfyRequest = $state<string | null>(null);
	/** A value of an element (`ModelElement.key`) to start editing in its details. */
	valueRequest = $state.raw<{ element: string; name: string } | null>(null);
	/**
	 * The product configuration the bill of materials, budgets, checks and
	 * structure diagrams show (its qualified name), or null for the model as
	 * written. One choice for every table and diagram, so they agree.
	 */
	configuration = $state<string | null>(null);

	/** Open the help, at a topic (`add-part`) or at the start. */
	showHelp(topic: string | null = null) {
		this.helpTopic = topic;
		this.helpOpen = true;
	}

	// ── Phone layout ──────────────────────────────────────────────────────────
	#pane = $state<MobilePane>('home');
	/** The element details sheet. */
	details = $state<SheetSnap>('closed');
	/** The sheet listing open views and where to go next. */
	viewsDrawer = $state(false);
	/** The problems sheet. */
	problemsSheet = $state(false);
	/** The "add an element" sheet. */
	addSheet = $state(false);
	/** What the add sheet starts with, when something asked for a kind or a place. */
	addKind = $state<AddKind | null>(null);
	addOwner = $state<string | null>(null);
	/** True while SysML text is being typed, with the keyboard up. */
	editingText = $state(false);
	/** On phones, each file shows as a diagram or as text; diagram unless chosen. */
	fileLayouts = $state<Record<string, 'text' | 'diagram'>>({});

	activeTab: Tab | undefined = $derived(this.tabs[this.active]);

	/** Whether the phone layout is in use. */
	get phone(): boolean {
		return isPhone();
	}

	get mobilePane(): MobilePane {
		return this.#pane;
	}
	set mobilePane(pane: PaneRequest) {
		switch (pane) {
			case 'explorer':
				this.#pane = 'model';
				break;
			case 'editor':
				this.#pane = this.activeTab?.kind === 'home' ? 'home' : 'views';
				break;
			case 'inspector':
				this.showDetails('half');
				break;
			case 'problems':
				this.problemsSheet = true;
				break;
			default:
				this.#pane = pane;
		}
	}

	/** Pull the details sheet up to at least `snap`. */
	showDetails(snap: SheetSnap = 'half') {
		const order: SheetSnap[] = ['closed', 'peek', 'half', 'full'];
		if (order.indexOf(this.details) < order.indexOf(snap)) this.details = snap;
	}

	/** Lower the details sheet so the view under it shows (it stays at hand). */
	lowerDetails() {
		if (this.details === 'half' || this.details === 'full') {
			this.details = this.selection ? 'peek' : 'closed';
		}
	}

	open(tab: Tab) {
		const id = tabId(tab);
		const existing = this.tabs.findIndex((t) => tabId(t) === id);
		if (existing >= 0) {
			// The same library file at another line.
			if (tab.kind === 'library') this.tabs[existing] = tab;
			this.active = existing;
		} else {
			this.tabs.push(tab);
			this.active = this.tabs.length - 1;
		}
		this.#pane = tab.kind === 'home' ? 'home' : 'views';
		this.viewsDrawer = false;
		this.lowerDetails();
	}

	/** Open a file as text (on phones, rather than as its diagram). */
	showText(path: string) {
		this.fileLayouts[path] = 'text';
		this.open({ kind: 'file', path });
	}

	/**
	 * A file was renamed or moved (`to`), or left the project (`to` null):
	 * its tabs follow it or close, and what is remembered about it follows.
	 */
	followFile(from: string, to: string | null) {
		if (this.tabs.some((t) => t.kind === 'file' && t.path === from)) {
			// As closing a tab does: one before the tab on show moves it down, and
			// closing the tab on show shows the one before it.
			let active = this.active;
			const next: Tab[] = [];
			this.tabs.forEach((t, i) => {
				if (t.kind !== 'file' || t.path !== from) next.push(t);
				else if (to) next.push({ ...t, path: to });
				else if (i <= this.active) active--;
			});
			if (!next.length) next.push({ kind: 'home' });
			this.tabs = next;
			this.active = Math.max(0, Math.min(active, next.length - 1));
		}
		this.followSelection(from, to);
	}

	private followSelection(from: string, to: string | null) {
		const layout = this.fileLayouts[from];
		if (layout) {
			const rest = { ...this.fileLayouts };
			delete rest[from];
			this.fileLayouts = to ? { ...rest, [to]: layout } : rest;
		}
		if (this.textRequest?.path === from)
			this.textRequest = to ? { ...this.textRequest, path: to } : null;
		// Element keys are `file@byte`: the text is the same, so the selection carries over.
		if (this.selection?.key.startsWith(`${from}@`))
			this.selection = to
				? { ...this.selection, key: to + this.selection.key.slice(from.length) }
				: null;
	}

	close(index: number) {
		this.tabs.splice(index, 1);
		if (this.tabs.length === 0) this.tabs.push({ kind: 'home' });
		if (this.active >= index) this.active = Math.max(0, this.active - 1);
	}

	/** The table on screen, so search can find its rows. */
	table = $state.raw<{ view: string; title: string; columns: string[]; rows: string[][] } | null>(
		null
	);
	/** A request to the table on screen: go to a row, or filter it. */
	tableRequest = $state.raw<
		| { view: string; index: number; nonce: number }
		| { view: string; query: string; nonce: number }
		| null
	>(null);

	/** A request to the editor of `path`: select and show this range (UTF-16 offsets). */
	textRequest = $state.raw<{ path: string; from: number; to: number; nonce: number } | null>(null);

	/**
	 * Open a file's text at a range — a statement rather than an element (a
	 * `satisfy` claim, a constraint), so the editor shows exactly that.
	 */
	revealText(path: string, from: number, to: number) {
		this.textRequest = { path, from, to, nonce: (this.textRequest?.nonce ?? 0) + 1 };
		if (this.phone) this.showText(path);
		else this.open({ kind: 'file', path });
	}

	/** Select an element and show it in its file's text. */
	showInText(element: { key: string; file: string }, source: SelectionSource) {
		if (this.phone) {
			// Select first: opening the text then lowers the details sheet to show it.
			this.select(element.key, source);
			this.showText(element.file);
			return;
		}
		this.open({ kind: 'file', path: element.file });
		this.select(element.key, source);
	}

	revealRow(view: string, index: number) {
		this.tableRequest = { view, index, nonce: (this.tableRequest?.nonce ?? 0) + 1 };
	}

	filterTable(view: string, query: string) {
		this.tableRequest = { view, query, nonce: (this.tableRequest?.nonce ?? 0) + 1 };
	}

	select(key: string | null, source: SelectionSource) {
		const again = !!key && this.selection?.key === key;
		this.selection = key ? { key, source, nonce: (this.selection?.nonce ?? 0) + 1 } : null;
		// On a phone, choosing an element (not moving the text cursor) shows its details. A tap
		// in a diagram first only peeks, so the diagram and the element's connections stay in
		// view; tapping the same element again opens them.
		if (key && source !== 'text' && this.phone) {
			if (source === 'diagram')
				this.showDetails(again && this.details === 'peek' ? 'half' : 'peek');
			else this.showDetails('half');
		}
	}
}
