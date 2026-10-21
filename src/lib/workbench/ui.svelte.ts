/** Workbench UI state: open tabs, the selected element and the phone layout. */
import type { DiagramView } from '#lib/engine/types.ts';
import { isPhone } from '#lib/mobile/media.svelte.ts';

export type Tab =
	| { kind: 'home' }
	| { kind: 'requirements' }
	/** `raw` shows a document (Markdown) as source rather than as a page. */
	| { kind: 'file'; path: string; raw?: boolean }
	| { kind: 'diagram'; view: DiagramView; scope: string | null; title: string }
	| { kind: 'view'; name: string; title: string }
	/** Run a state machine interactively. `machine` is its (qualified) name. */
	| { kind: 'emulator'; machine: string; title: string }
	/** A read-only file of the OMG standard library. */
	| { kind: 'library'; path: string; line?: number };

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

	revealRow(view: string, index: number) {
		this.tableRequest = { view, index, nonce: (this.tableRequest?.nonce ?? 0) + 1 };
	}

	filterTable(view: string, query: string) {
		this.tableRequest = { view, query, nonce: (this.tableRequest?.nonce ?? 0) + 1 };
	}

	select(key: string | null, source: SelectionSource) {
		this.selection = key ? { key, source, nonce: (this.selection?.nonce ?? 0) + 1 } : null;
		// On a phone, choosing an element (not moving the text cursor) shows its details.
		if (key && source !== 'text' && this.phone) this.showDetails('half');
	}
}
