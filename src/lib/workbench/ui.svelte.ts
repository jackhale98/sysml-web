/** Workbench UI state: open tabs, the selected element and the mobile pane. */
import type { DiagramView } from '#lib/engine/types.ts';

export type Tab =
	| { kind: 'home' }
	| { kind: 'requirements' }
	| { kind: 'file'; path: string }
	| { kind: 'diagram'; view: DiagramView; scope: string | null; title: string };

export type SelectionSource = 'text' | 'diagram' | 'explorer' | 'inspector' | 'table';

export interface Selection {
	/** `ModelElement.key`. */
	key: string;
	source: SelectionSource;
	/** Increments on every selection so views can react to re-selecting. */
	nonce: number;
}

export type MobilePane = 'explorer' | 'editor' | 'inspector' | 'problems';

export function tabId(tab: Tab): string {
	switch (tab.kind) {
		case 'file':
			return `file:${tab.path}`;
		case 'diagram':
			return `diagram:${tab.view}:${tab.scope ?? ''}`;
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
			return tab.path.split('/').pop() ?? tab.path;
		case 'diagram':
			return tab.title;
	}
}

export class WorkbenchUi {
	tabs = $state<Tab[]>([{ kind: 'home' }]);
	active = $state(0);
	/** Show a live diagram beside text tabs. */
	split = $state(true);
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
