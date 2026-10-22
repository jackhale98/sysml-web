<script lang="ts">
	/**
	 * The explorer's Files tab: the project's model files by folder, a "New
	 * file" button, and on each file a menu (⋯, a right click, or a long
	 * press on touch screens) to rename, move or delete it.
	 */
	import { tick } from 'svelte';
	import {
		ChevronRight,
		Ellipsis,
		FileCode,
		Folder,
		FolderInput,
		PenLine,
		Plus,
		Trash2
	} from '@lucide/svelte';
	import { nameOf } from '#lib/project/filenames.ts';
	import { isLibraryFile, type Workspace } from '#lib/project/workspace.svelte.ts';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import SheetDialog from '#lib/ui/SheetDialog.svelte';
	import { longPress } from '#lib/mobile/press.ts';
	import type { WorkbenchUi } from '../ui.svelte.ts';

	let { workspace, ui }: { workspace: Workspace; ui: WorkbenchUi } = $props();

	const uid = $props.id();

	const folders = $derived.by(() => {
		const byFolder: Record<string, string[]> = {};
		for (const path of workspace.modelPaths) {
			const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
			(byFolder[folder] ??= []).push(path);
		}
		return Object.entries(byFolder);
	});

	/** The file whose menu is open, and whether it shows as a sheet (phones). */
	let menuFor = $state<string | null>(null);
	let sheetOpen = $state(false);
	let menu = $state<HTMLElement>();

	async function openMenu(path: string) {
		menuFor = path;
		if (ui.phone) {
			sheetOpen = true;
			return;
		}
		await tick();
		menu?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
	}

	function closeMenu(focusTrigger = false) {
		const path = menuFor;
		menuFor = null;
		sheetOpen = false;
		if (focusTrigger && path)
			document.getElementById(triggerId(path))?.focus({ preventScroll: true });
	}

	function choose(kind: 'rename' | 'move' | 'delete') {
		const path = menuFor;
		closeMenu();
		if (path) ui.fileRequest = { kind, path };
	}

	const triggerId = (path: string) => `${uid}-more-${encodeURIComponent(path)}`;
	const labelId = (path: string) => `${uid}-name-${encodeURIComponent(path)}`;

	function menuKeys(event: KeyboardEvent) {
		const items = [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
		const at = items.indexOf(document.activeElement as HTMLElement);
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			closeMenu(true);
		} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const step = event.key === 'ArrowDown' ? 1 : -1;
			items[(at + step + items.length) % items.length]?.focus();
		} else if (event.key === 'Home' || event.key === 'End') {
			event.preventDefault();
			items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
		} else if (event.key === 'Tab') {
			closeMenu();
		}
	}

	// A long press (touch) gives the file's menu, as a right click does.
	const press = longPress();

	function openFile(event: MouseEvent, path: string) {
		if (press.fired()) {
			event.preventDefault();
			return;
		}
		ui.open({ kind: 'file', path });
	}
</script>

{#snippet menuItems()}
	<button type="button" role="menuitem" class="menu-item" onclick={() => choose('rename')}>
		<PenLine size={15} aria-hidden="true" /> Rename…
	</button>
	<button type="button" role="menuitem" class="menu-item" onclick={() => choose('move')}>
		<FolderInput size={15} aria-hidden="true" /> Move to folder…
	</button>
	<button type="button" role="menuitem" class="menu-item danger" onclick={() => choose('delete')}>
		<Trash2 size={15} aria-hidden="true" /> Delete…
	</button>
{/snippet}

{#snippet fileItem(folder: string, path: string)}
	<li class="file" class:menu-open={menuFor === path}>
		<button
			type="button"
			class="item"
			style:padding-left={folder ? '1.5rem' : undefined}
			title={path}
			onclick={(e) => openFile(e, path)}
			oncontextmenu={(e) => {
				e.preventDefault();
				press.cancel();
				void openMenu(path);
			}}
			onpointerdown={(e) => press.start(e, () => void openMenu(path))}
			onpointermove={press.move}
			onpointerup={press.cancel}
			onpointercancel={press.cancel}
			onpointerleave={press.cancel}
		>
			<FileCode size={14} />
			<span class="label" id={labelId(path)}>{path.slice(folder ? folder.length + 1 : 0)}</span>
			{#if workspace.dirty.has(path)}<span class="dot" title="Edited"></span>{/if}
		</button>
		<!-- "More actions", described by the file's name: the name alone finds the file. -->
		<button
			type="button"
			class="more"
			id={triggerId(path)}
			aria-label="More actions"
			aria-describedby={labelId(path)}
			aria-haspopup="menu"
			aria-expanded={menuFor === path}
			onclick={() => (menuFor === path ? closeMenu() : void openMenu(path))}
		>
			<Ellipsis size={16} aria-hidden="true" />
		</button>
		{#if menuFor === path && !ui.phone}
			<div
				class="menu"
				role="menu"
				tabindex="-1"
				aria-label="{nameOf(path)}: file"
				bind:this={menu}
				onkeydown={menuKeys}
				onfocusout={(e) => {
					const to = e.relatedTarget as Node | null;
					if (!e.currentTarget.contains(to) && to !== document.getElementById(triggerId(path)))
						closeMenu();
				}}
			>
				{@render menuItems()}
			</div>
		{/if}
	</li>
{/snippet}

<div class="files" class:phone={ui.phone}>
	<div class="files-head">
		<h2 id="{uid}-heading">Files</h2>
		<button type="button" class="mini" onclick={() => (ui.fileRequest = { kind: 'new' })}>
			<Plus size={13} aria-hidden="true" /> New file
		</button>
	</div>
	{#if !folders.length}
		<EmptyState
			compact
			title="No SysML files yet"
			actions={[
				{ label: 'New file', primary: true, run: () => (ui.fileRequest = { kind: 'new' }) }
			]}
		>
			A model is one or more <code>.sysml</code> files; packages in one can import from the others.
		</EmptyState>
	{/if}
	<ul class="flat" aria-labelledby="{uid}-heading">
		{#each folders as [folder, paths] (folder)}
			{#if folder && isLibraryFile(`${folder}/`)}
				<!-- Libraries the model builds on: out of the way until wanted. -->
				<li>
					<details class="library-folder">
						<summary class="folder"
							><ChevronRight size={14} class="chevron" /><Folder size={14} /> {folder}</summary
						>
						<ul class="flat">
							{#each paths as path (path)}
								{@render fileItem(folder, path)}
							{/each}
						</ul>
					</details>
				</li>
			{:else}
				{#if folder}
					<li class="folder"><Folder size={14} /> {folder}</li>
				{/if}
				{#each paths as path (path)}
					{@render fileItem(folder, path)}
				{/each}
			{/if}
		{/each}
	</ul>
</div>

<SheetDialog
	bind:open={sheetOpen}
	title={menuFor ? nameOf(menuFor) : 'File'}
	description={menuFor ?? undefined}
	size="sm"
	oncancel={() => closeMenu()}
>
	<div class="sheet-menu" role="menu" aria-label="{menuFor ? nameOf(menuFor) : ''}: file">
		{@render menuItems()}
	</div>
</SheetDialog>

<style>
	.files-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	h2 {
		margin: var(--space-2) var(--space-2) var(--space-1);
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-3);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.file {
		position: relative;
		display: flex;
		align-items: center;
		border-radius: var(--radius-sm);
	}
	.file:hover,
	.file.menu-open {
		background: var(--surface-hover);
	}
	.item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex: 1;
		min-width: 0;
		min-height: 1.875rem;
		padding: 0 var(--space-2);
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-2);
		text-align: left;
		cursor: pointer;
		-webkit-touch-callout: none;
		user-select: none;
	}
	.file:hover .item {
		color: var(--text);
	}
	.label {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.more {
		display: grid;
		flex: none;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-2);
		cursor: pointer;
	}
	.more:hover,
	.more[aria-expanded='true'] {
		background: var(--surface-2);
		color: var(--text);
	}
	.menu {
		position: absolute;
		top: calc(100% + 2px);
		right: 0;
		z-index: 6;
		display: grid;
		min-width: 11rem;
		padding: var(--space-1);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface);
		box-shadow: var(--shadow-lg);
	}
	.menu-item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2rem;
		padding: 0 var(--space-2);
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.menu-item:hover,
	.menu-item:focus-visible {
		background: var(--surface-hover);
	}
	.menu-item.danger {
		color: var(--danger);
	}
	.sheet-menu {
		display: grid;
		gap: var(--space-1);
	}
	.sheet-menu .menu-item {
		min-height: 2.75rem;
		padding: 0 var(--space-3);
		font-size: var(--text-md);
	}
	.mini {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-height: 1.75rem;
		margin-right: var(--space-1);
		padding: 0 var(--space-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		background: var(--surface);
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 600;
		cursor: pointer;
	}
	.mini:hover {
		border-color: var(--border-strong);
		color: var(--text);
	}
	.library-folder > summary {
		cursor: pointer;
		list-style: none;
	}
	.library-folder > summary::-webkit-details-marker {
		display: none;
	}
	.library-folder > summary :global(.chevron) {
		margin-left: -2px;
		transition: transform 0.15s;
	}
	.library-folder[open] > summary :global(.chevron) {
		transform: rotate(90deg);
	}
	.folder {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-2) var(--space-1);
		color: var(--text-3);
	}
	.dot {
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		background: var(--warn);
	}
	/* Thumb-sized on touch screens and phones. */
	@media (pointer: coarse) {
		.item,
		.mini,
		.more,
		.folder {
			min-height: 2.75rem;
		}
		.more {
			width: 2.75rem;
			height: 2.75rem;
		}
	}
	.phone .item,
	.phone .mini {
		min-height: 2.75rem;
	}
	.phone .item {
		border-radius: var(--radius-md);
	}
	.phone .more {
		width: 2.75rem;
		height: 2.75rem;
	}
</style>
