<script lang="ts">
	/**
	 * The file form `ui.fileRequest` asks for, one at a time: a new file,
	 * renaming or moving one (only its path changes), or deleting one, after
	 * saying what would stop resolving without it. A card on larger screens,
	 * a bottom sheet on phones (`SheetDialog`).
	 */
	import { tick } from 'svelte';
	import { FilePlus, FolderInput, LoaderCircle, PenLine, Trash2 } from '@lucide/svelte';
	import {
		checkFilePath,
		folderOf,
		foldersOf,
		nameOf,
		newFileText,
		stemOf
	} from '#lib/project/filenames.ts';
	import { isLibraryFile, type Workspace } from '#lib/project/workspace.svelte.ts';
	import SheetDialog from '#lib/ui/SheetDialog.svelte';
	import type { FileRequest, WorkbenchUi } from '../ui.svelte.ts';
	import { createFile, deleteFile, renameFile, viewsUsing } from './fileActions.ts';
	import { viewTitle } from '../views.ts';

	let { workspace, ui }: { workspace: Workspace; ui: WorkbenchUi } = $props();

	const uid = $props.id();
	/** The request on show; a new request starts the form afresh. */
	let request = $state.raw<FileRequest | null>(null);
	let open = $state(false);
	let folderChoice = $state('');
	let newFolder = $state('');
	let name = $state('');
	/** Show what is wrong with the name once the person has tried (or typed). */
	let touched = $state(false);
	let busy = $state(false);
	let failed = $state<string | null>(null);
	/** Delete: what would stop resolving, once checked (null while checking). */
	let breaks = $state.raw<string[] | null>(null);
	let checkFailed = $state(false);
	let nameInput = $state<HTMLInputElement>();
	let folderSelect = $state<HTMLSelectElement>();

	const NEW_FOLDER = '\u0000new';
	const path = $derived(request && request.kind !== 'new' ? request.path : null);
	const folders = $derived(foldersOf(workspace.paths));

	$effect(() => {
		const asked = ui.fileRequest;
		if (!asked) return;
		ui.fileRequest = null;
		start(asked);
	});

	function start(asked: FileRequest) {
		request = asked;
		touched = false;
		busy = false;
		failed = null;
		newFolder = '';
		breaks = null;
		checkFailed = false;
		const current = asked.kind === 'new' ? null : asked.path;
		const folder =
			asked.kind === 'new'
				? (asked.folder ?? (ui.activeTab?.kind === 'file' ? folderOf(ui.activeTab.path) : ''))
				: folderOf(current!);
		folderChoice = folder;
		name = current ? nameOf(current) : '';
		open = true;
		if (asked.kind === 'delete') void check(asked.path);
		void tick().then(() => {
			if (asked.kind === 'move') folderSelect?.focus();
			else if (nameInput) {
				nameInput.focus();
				// Renaming: the name is selected without its extension, ready to type over.
				if (asked.kind === 'rename') nameInput.setSelectionRange(0, stemOf(name).length);
			}
		});
	}

	async function check(file: string) {
		try {
			const found = await workspace.whatBreaksWithout(file);
			if (request?.kind === 'delete' && request.path === file) breaks = found;
		} catch {
			checkFailed = true;
			breaks = [];
		}
	}

	const folder = $derived(folderChoice === NEW_FOLDER ? newFolder : folderChoice);
	const checked = $derived(
		request && request.kind !== 'delete'
			? checkFilePath(folder, name, workspace.paths, path ?? undefined)
			: null
	);
	const unchanged = $derived(!!path && checked?.path === path);
	const error = $derived(
		checked?.error ??
			(folderChoice === NEW_FOLDER && !newFolder.trim() ? 'Name the new folder.' : null)
	);
	const showError = $derived(touched && !!error);
	/** Top-level element names, so a new file's package gets one of its own. */
	const taken = $derived(workspace.tree.flatMap((n) => [n.element.name, n.element.label]));
	const preview = $derived(
		request?.kind === 'new' && checked?.path ? newFileText(checked.path, taken) : ''
	);
	/** "Requirements and Gaps", "A, B, C and 2 more". */
	const viewList = $derived.by(() => {
		const names = usedByViews.map(viewTitle);
		if (names.length <= 1) return names.join('');
		const shown = names.length > 4 ? [...names.slice(0, 3), `${names.length - 3} more`] : names;
		return `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`;
	});
	const usedByViews = $derived(
		path && request?.kind === 'delete' ? viewsUsing(workspace, path) : []
	);

	const title = $derived(
		request?.kind === 'new'
			? 'New file'
			: request?.kind === 'rename'
				? `Rename ${path ? nameOf(path) : 'file'}`
				: request?.kind === 'move'
					? `Move ${path ? nameOf(path) : 'file'}`
					: `Delete ${path ? nameOf(path) : 'file'}?`
	);
	const description = $derived(
		request?.kind === 'new'
			? 'A SysML file that starts with an empty package, named after the file.'
			: request?.kind === 'delete'
				? `${path} leaves the project. You can undo this.`
				: undefined
	);

	async function submit(event?: SubmitEvent) {
		event?.preventDefault();
		touched = true;
		if (!request || busy) return;
		if (request.kind === 'delete') {
			busy = true;
			const result = await deleteFile(workspace, request.path, breaks ?? []);
			busy = false;
			if (result) failed = result;
			else open = false;
			return;
		}
		if (error || !checked?.path) {
			nameInput?.focus();
			return;
		}
		if (unchanged) {
			open = false;
			return;
		}
		busy = true;
		const target = checked.path;
		const result =
			request.kind === 'new'
				? await createFile(workspace, target, preview, (p) =>
						ui.phone ? ui.showText(p) : ui.open({ kind: 'file', path: p })
					)
				: await renameFile(workspace, request.path, target);
		busy = false;
		if (result) failed = result;
		else open = false;
	}
</script>

{#snippet folderField()}
	<div class="field">
		<label class="name" for="{uid}-folder">Folder</label>
		<select id="{uid}-folder" bind:this={folderSelect} bind:value={folderChoice}>
			<option value="">Top level (no folder)</option>
			{#each folders as f (f)}
				<option value={f}>{f}{isLibraryFile(`${f}/`) ? ' (libraries)' : ''}</option>
			{/each}
			<option value={NEW_FOLDER}>New folder…</option>
		</select>
	</div>
	{#if folderChoice === NEW_FOLDER}
		<div class="field">
			<label class="name" for="{uid}-new-folder">New folder name</label>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				id="{uid}-new-folder"
				bind:value={newFolder}
				oninput={() => (touched = true)}
				placeholder="structure"
				autocomplete="off"
				autocapitalize="off"
				spellcheck="false"
				autofocus
				aria-describedby="{uid}-new-folder-hint"
			/>
			<small class="hint" id="{uid}-new-folder-hint">Use / for a folder inside another.</small>
		</div>
	{/if}
{/snippet}

<SheetDialog
	bind:open
	{title}
	{description}
	size="sm"
	closeLabel="Cancel"
	testid="file-dialog"
	oncancel={() => (open = false)}
>
	{#snippet icon()}
		{#if request?.kind === 'new'}<FilePlus size={20} aria-hidden="true" />
		{:else if request?.kind === 'rename'}<PenLine size={20} aria-hidden="true" />
		{:else if request?.kind === 'move'}<FolderInput size={20} aria-hidden="true" />
		{:else}<Trash2 size={20} aria-hidden="true" />{/if}
	{/snippet}
	{#if request}
		<form id="{uid}-form" class="form" onsubmit={submit} novalidate>
			{#if request.kind === 'delete'}
				<div class="report" aria-live="polite">
					{#if usedByViews.length}
						<p class="warning" role="note">
							<strong>{usedByViews.length === 1 ? 'A view uses' : 'Views use'} this library.</strong
							>
							{viewList} would stop showing.
						</p>
					{/if}
					{#if breaks === null}
						<p class="checking">
							<LoaderCircle size={16} class="spin" aria-hidden="true" /> Checking what uses it…
						</p>
					{:else if checkFailed}
						<p>Couldn’t check what uses it. Anything that does will show in Problems.</p>
					{:else if breaks.length}
						<p><strong>These would stop resolving:</strong></p>
						<ul class="breaks">
							{#each breaks as b, i (i)}<li>{b}</li>{/each}
						</ul>
						<p class="hint">They show in Problems until you fix them, or undo.</p>
					{:else}
						<p>Nothing else in the model uses what it holds.</p>
					{/if}
				</div>
			{:else}
				{#if request.kind === 'new' || request.kind === 'move'}
					{@render folderField()}
				{/if}
				{#if request.kind === 'new' || request.kind === 'rename'}
					<div class="field">
						<label class="name" for="{uid}-name">Name</label>
						<input
							id="{uid}-name"
							bind:this={nameInput}
							bind:value={name}
							oninput={() => (touched = true)}
							placeholder="Power"
							autocomplete="off"
							autocapitalize="off"
							spellcheck="false"
							aria-invalid={showError}
							aria-describedby="{uid}-path"
						/>
					</div>
				{/if}
				<p class="path" id="{uid}-path" aria-live="polite">
					{#if showError}
						<span class="error">{error}</span>
					{:else if checked?.path && request.kind === 'new'}
						Makes <code>{checked.path}</code> with
						<code>{preview.split('\n')[0]?.replace(' {', '')}</code>.
					{:else if checked?.path && !unchanged}
						{request.kind === 'move' ? 'Moves it to' : 'Renames it to'} <code>{checked.path}</code>.
					{:else if request.kind === 'new'}
						<code>.sysml</code> is added if you leave it off.
					{/if}
				</p>
				{#if request.kind !== 'new'}
					<p class="note">
						Packages and references stay the same; SysML finds them by name, not by file.
					</p>
				{/if}
			{/if}
			{#if failed}<p class="error" role="alert">{failed}</p>{/if}
		</form>
	{/if}
	{#snippet footer()}
		<button type="button" class="button" onclick={() => (open = false)}>Cancel</button>
		{#if request?.kind === 'delete'}
			<button type="submit" form="{uid}-form" class="danger" disabled={busy}>
				<Trash2 size={16} aria-hidden="true" /> Delete file
			</button>
		{:else}
			<button
				type="submit"
				form="{uid}-form"
				class="primary"
				disabled={busy}
				aria-disabled={showError ? 'true' : undefined}
			>
				{request?.kind === 'new' ? 'Create file' : request?.kind === 'move' ? 'Move' : 'Rename'}
			</button>
		{/if}
	{/snippet}
</SheetDialog>

<style>
	.form {
		display: grid;
		gap: var(--space-3);
	}
	.field {
		display: grid;
		gap: var(--space-1);
		min-width: 0;
	}
	.name {
		color: var(--text);
		font-size: var(--text-sm);
		font-weight: 600;
	}
	input,
	select {
		width: 100%;
		min-width: 0;
		min-height: 2.75rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-size: var(--text-md);
	}
	input:focus-visible,
	select:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 0;
	}
	input[aria-invalid='true'] {
		border-color: var(--danger);
	}
	.hint,
	.note {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.note {
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--surface-2);
	}
	.path {
		min-height: 1.25rem;
		color: var(--text-2);
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}
	code {
		font-family: var(--font-mono);
		font-size: 0.92em;
		color: var(--text);
	}
	.error {
		color: var(--danger);
		font-weight: 550;
	}
	.report {
		display: grid;
		gap: var(--space-2);
		font-size: var(--text-md);
	}
	.warning {
		padding: var(--space-2) var(--space-3);
		border-left: 3px solid var(--warn);
		border-radius: var(--radius-sm);
		background: var(--warn-weak);
		color: var(--text);
	}
	.breaks {
		display: grid;
		gap: var(--space-1);
		margin: 0;
		padding-left: var(--space-5);
		color: var(--text);
		overflow-wrap: anywhere;
	}
	.checking {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--text-2);
	}
	.checking :global(.spin) {
		animation: spin 1s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.checking :global(.spin) {
			animation: none;
		}
	}
	.button,
	.primary,
	.danger {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		min-height: 2.75rem;
		padding: 0 var(--space-4);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font-weight: 600;
		cursor: pointer;
	}
	.button:hover {
		border-color: var(--text-3);
	}
	.primary {
		border: 0;
		background: var(--accent);
		color: var(--accent-text);
	}
	.primary:hover {
		background: var(--accent-hover);
	}
	.danger {
		border-color: var(--danger);
		background: var(--danger);
		color: var(--surface);
	}
	button:disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
