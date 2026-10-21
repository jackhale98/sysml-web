/** Workbench UI state: open tabs, the selected element and the mobile pane. */
import type { DiagramView } from '#lib/engine/types.ts';

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

export type MobilePane = 'explorer' | 'editor' | 'inspector' | 'problems';

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
	mobilePane = $state<MobilePane>('editor');
	inspectorOpen = $state(true);
	problemsOpen = $state(false);

	activeTab: Tab | undefined = $derived(this.tabs[this.active]);

	open(tab: Tab) {
		const id = tabId(tab);
		const existing = this.tabs.findIndex((t) => tabId(t) === id);
		if (existing >= 0) {
			this.active = existing;
		} else {
			this.tabs.push(tab);
			this.active = this.tabs.length - 1;
		}
		this.mobilePane = 'editor';
	}

	close(index: number) {
		this.tabs.splice(index, 1);
		if (this.tabs.length === 0) this.tabs.push({ kind: 'home' });
		if (this.active >= index) this.active = Math.max(0, this.active - 1);
	}

	select(key: string | null, source: SelectionSource) {
		this.selection = key ? { key, source, nonce: (this.selection?.nonce ?? 0) + 1 } : null;
	}
}
