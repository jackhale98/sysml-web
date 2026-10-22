<script lang="ts">
	import {
		CircleQuestionMark,
		Command,
		FileCode,
		Network,
		Search,
		Table as TableIcon
	} from '@lucide/svelte';
	import { tick } from 'svelte';
	import { isLibraryFile, type Workspace } from '#lib/project/workspace.svelte.ts';
	import KindGlyph from '#lib/ui/KindGlyph.svelte';
	import { theme } from '#lib/ui/theme.svelte.ts';
	import {
		GROUP_HEADINGS,
		commandItems,
		elementItems,
		helpItems,
		fileItems,
		machineItems,
		modelViewItems,
		newViewItems,
		search,
		segments,
		tableRowItems,
		viewItems,
		type PaletteGroup,
		type PaletteResult,
		type Range
	} from './palette.ts';
	import type { WorkbenchUi } from './ui.svelte.ts';
	import { VIEW_KINDS } from '#lib/create/view.ts';
	import { ALL_TOPICS } from '#lib/help/content.ts';

	// The help's topics, found by title and keywords (the help itself is loaded when opened).
	const help = helpItems(ALL_TOPICS);

	let { workspace, ui }: { workspace: Workspace; ui: WorkbenchUi } = $props();

	const uid = $props.id();
	const listId = `${uid}-list`;
	const optionId = (index: number) => `${uid}-option-${index}`;
	const groupId = (group: PaletteGroup) => `${uid}-group-${group}`;

	let dialog = $state<HTMLDialogElement>();
	let list = $state<HTMLElement>();
	let query = $state('');
	let active = $state(0);

	// Only evaluated while the palette is open: nothing below is read otherwise.
	const sources = $derived({
		elements: elementItems(workspace.elements, isLibraryFile),
		views: [
			...modelViewItems(workspace.views),
			...viewItems(
				workspace.tree.filter((n) => n.element.kind === 'package' && !isLibraryFile(n.element.file))
			)
		],
		files: fileItems(workspace.modelPaths),
		commands: [
			...machineItems(workspace.machines),
			...commandItems(theme.choice),
			...newViewItems(VIEW_KINDS)
		],
		help,
		...(ui.table
			? {
					rows: tableRowItems(ui.table.view, ui.table.title, ui.table.columns, ui.table.rows),
					table: {
						view: ui.table.view,
						title: ui.table.title,
						count: (q: string) => countRows(ui.table?.rows ?? [], q)
					}
				}
			: {})
	});
	const results = $derived(search(sources, query));

	/** Rows a table's own search keeps: any cell containing the text. */
	function countRows(rows: readonly string[][], q: string): number {
		const needle = q.toLowerCase();
		return rows.filter((cells) => cells.some((c) => c.toLowerCase().includes(needle))).length;
	}
	const current = $derived(Math.min(active, results.length - 1));

	/** Results in consecutive runs per group, each with its index overall. */
	const sections = $derived.by(() => {
		const out: { group: PaletteGroup; rows: { result: PaletteResult; index: number }[] }[] = [];
		results.forEach((result, index) => {
			let section = out[out.length - 1];
			if (section?.group !== result.item.group) {
				section = { group: result.item.group, rows: [] };
				out.push(section);
			}
			section.rows.push({ result, index });
		});
		return out;
	});

	// The native dialog follows `ui.paletteOpen`; its own close (Escape, backdrop) flows back.
	$effect(() => {
		if (!dialog) return;
		if (ui.paletteOpen && !dialog.open) {
			query = '';
			active = 0;
			dialog.showModal();
		} else if (!ui.paletteOpen && dialog.open) {
			dialog.close();
		}
	});

	function close() {
		dialog?.close();
		ui.paletteOpen = false;
	}

	function run({ item }: PaletteResult) {
		// Close first so focus returns to where it was before the action moves it.
		close();
		const action = item.action;
		switch (action.type) {
			case 'element':
				// On a phone the element's details slide up over the current view.
				if (!ui.phone) ui.open({ kind: 'file', path: action.file });
				ui.select(action.key, 'explorer');
				break;
			case 'open':
				ui.open(action.tab);
				break;
			case 'row':
				ui.revealRow(action.view, action.index);
				break;
			case 'filter':
				ui.filterTable(action.view, action.query);
				break;
			case 'layout':
				ui.layout = action.layout;
				break;
			case 'toggle-inspector':
				if (ui.phone) {
					ui.showDetails('full');
					break;
				}
				ui.inspectorOpen = !ui.inspectorOpen;
				if (ui.inspectorOpen) ui.mobilePane = 'inspector';
				break;
			case 'show-problems':
				ui.problemsOpen = true;
				ui.mobilePane = 'problems';
				break;
			case 'switch-theme':
				theme.next();
				break;
			case 'import-requirements':
				ui.importOpen = true;
				break;
			case 'export-json':
				ui.exportJsonOpen = true;
				break;
			case 'api-server':
				ui.apiServerOpen = true;
				break;
			case 'create':
				ui.create = action.request;
				break;
			case 'help':
				ui.showHelp(action.topic);
				break;
		}
	}

	async function move(delta: number) {
		const count = results.length;
		if (!count) return;
		active = (current + delta + count) % count;
		await tick();
		if (active === 0) list?.scrollTo({ top: 0 });
		else document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.isComposing) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			void move(1);
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			void move(-1);
		} else if (event.key === 'Enter') {
			event.preventDefault();
			const result = results[current];
			if (result) run(result);
		}
	}

	// A click on the backdrop lands on the dialog itself; its content fills the rest.
	function onbackdrop(event: MouseEvent) {
		if (event.target === dialog) close();
	}
</script>

{#snippet highlight(text: string, ranges: Range[] | undefined)}
	{#each segments(text, ranges) as part, i (i)}
		{#if part.hit}<mark>{part.text}</mark>{:else}{part.text}{/if}
	{/each}
{/snippet}

<!-- The backdrop click is a pointer shortcut; Escape closes the dialog for everyone else. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<dialog
	bind:this={dialog}
	aria-label="Command palette"
	onclose={() => (ui.paletteOpen = false)}
	onclick={onbackdrop}
>
	{#if ui.paletteOpen}
		<div class="field">
			<Search size={18} aria-hidden="true" />
			<input
				type="text"
				role="combobox"
				aria-label="Search elements, views, files and commands"
				aria-autocomplete="list"
				aria-expanded={results.length > 0}
				aria-controls={results.length > 0 ? listId : undefined}
				aria-activedescendant={results.length > 0 ? optionId(current) : undefined}
				placeholder="Search the model and commands, or ? for help"
				autocomplete="off"
				autocapitalize="off"
				spellcheck="false"
				enterkeyhint="go"
				bind:value={query}
				oninput={() => (active = 0)}
				{onkeydown}
			/>
			<button type="button" class="esc" title="Close" onclick={close}>
				<span class="esc-key"><kbd>Esc</kbd><span class="visually-hidden"> to close</span></span
				><span class="cancel">Cancel</span>
			</button>
		</div>

		{#if results.length > 0}
			<div class="results" id={listId} role="listbox" aria-label="Results" bind:this={list}>
				{#each sections as section (section.group)}
					<div role="group" aria-labelledby={groupId(section.group)}>
						<div class="heading" id={groupId(section.group)}>{GROUP_HEADINGS[section.group]}</div>
						{#each section.rows as { result, index } (result.item.id)}
							{@const item = result.item}
							{@const ranges = result.match?.ranges}
							<!-- Options are driven from the combobox input, which keeps keyboard focus. -->
							<!-- svelte-ignore a11y_click_events_have_key_events, a11y_interactive_supports_focus -->
							<div
								id={optionId(index)}
								class="option"
								role="option"
								aria-selected={index === current}
								onpointermove={() => (active = index)}
								onmousedown={(event) => event.preventDefault()}
								onclick={() => run(result)}
							>
								{#if item.kind}
									<KindGlyph kind={item.kind} isDefinition={item.isDefinition ?? false} size={20} />
								{:else if item.group === 'files'}
									<FileCode size={16} aria-hidden="true" />
								{:else if item.group === 'rows'}
									<TableIcon size={16} aria-hidden="true" />
								{:else if item.group === 'views'}
									<Network size={16} aria-hidden="true" />
								{:else if item.group === 'help' || item.action.type === 'help'}
									<CircleQuestionMark size={16} aria-hidden="true" />
								{:else}
									<Command size={16} aria-hidden="true" />
								{/if}
								<span class="main">
									<span class="label">{@render highlight(item.label, ranges?.label)}</span>
									{#if item.shortId}
										<span class="id">{@render highlight(item.shortId, ranges?.shortId)}</span>
									{/if}
								</span>
								{#if item.keyword || item.detail}
									<span class="meta">
										{#if item.keyword}
											<span class="keyword">{@render highlight(item.keyword, ranges?.keyword)}</span
											>
										{/if}
										{#if item.detail}<span class="detail">{item.detail}</span>{/if}
									</span>
								{/if}
							</div>
						{/each}
					</div>
				{/each}
			</div>
		{:else}
			<p class="empty">No matches for “{query.trim()}”</p>
		{/if}

		<div class="visually-hidden" role="status">
			{results.length === 0 ? 'No results' : `${results.length} results`}
		</div>

		<div class="footer" aria-hidden="true">
			<span><kbd>↑</kbd><kbd>↓</kbd> to move</span>
			<span><kbd>↵</kbd> to open</span>
			<span><kbd>?</kbd> for help</span>
		</div>
	{/if}
</dialog>

<style>
	dialog {
		width: min(640px, calc(100vw - 2rem));
		max-width: none;
		max-height: calc(100dvh - 12vh - 1rem);
		margin: 12vh auto auto;
		padding: 0;
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: calc(var(--radius-lg) + 2px);
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-lg);
	}
	dialog[open] {
		display: flex;
		flex-direction: column;
		animation: pop 160ms var(--ease);
	}
	/* The scrim is fixed rather than themed: custom properties do not reach ::backdrop everywhere. */
	dialog::backdrop {
		background: rgb(14 16 20 / 0.4);
		backdrop-filter: blur(6px);
	}
	dialog[open]::backdrop {
		animation: fade 160ms var(--ease);
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: translateY(-8px) scale(0.98);
		}
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		dialog[open],
		dialog[open]::backdrop {
			animation: none;
		}
	}

	.field {
		display: flex;
		align-items: center;
		flex: none;
		gap: var(--space-3);
		height: 48px;
		padding: 0 var(--space-3) 0 var(--space-4);
		border-bottom: 1px solid var(--border);
		color: var(--text-3);
	}
	.field:focus-within {
		border-bottom-color: var(--accent);
	}
	input {
		flex: 1;
		min-width: 0;
		height: 100%;
		border: 0;
		outline: 0;
		background: transparent;
		color: var(--text);
		font-size: var(--text-lg);
	}
	input::placeholder {
		color: var(--text-3);
	}
	kbd {
		display: inline-block;
		min-width: 1.4rem;
		padding: 1px 6px;
		border: 1px solid var(--border-strong);
		border-bottom-width: 2px;
		border-radius: 5px;
		background: var(--surface-2);
		color: var(--text-2);
		font-size: var(--text-xs);
		line-height: 1.4;
		text-align: center;
	}
	.esc {
		flex: none;
		display: grid;
		place-items: center;
		min-height: 2rem;
		padding: 0 var(--space-1);
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		cursor: pointer;
	}
	.esc:hover kbd {
		border-color: var(--text-3);
	}

	/* Sized by its rows and shrinking to fit (`flex: 1` would start it at zero
	   height, which Safari keeps when the dialog is as tall as its content). */
	.results {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		scroll-padding-block: var(--space-2);
		padding: var(--space-1) var(--space-2) var(--space-2);
	}
	.heading {
		padding: var(--space-2) var(--space-3) var(--space-1);
		color: var(--text-3);
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.option {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: 2.5rem;
		padding: 0 var(--space-3);
		border-radius: var(--radius-md);
		color: var(--text);
		cursor: pointer;
	}
	.option[aria-selected='true'] {
		background: var(--accent-weak);
	}
	.option :global(svg) {
		flex: none;
	}
	.main {
		display: flex;
		flex: 1;
		align-items: baseline;
		gap: var(--space-2);
		min-width: 0;
	}
	.label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.id {
		flex: none;
		color: var(--text-3);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}
	.meta {
		display: flex;
		flex: none;
		align-items: baseline;
		gap: var(--space-3);
		max-width: 45%;
		color: var(--text-3);
		font-size: var(--text-xs);
	}
	.keyword,
	.detail {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.option[aria-selected='true'] :is(.id, .meta) {
		color: var(--text-2);
	}
	mark {
		background: transparent;
		color: var(--accent);
		font-weight: 650;
	}
	.empty {
		padding: var(--space-6) var(--space-4);
		color: var(--text-2);
		text-align: center;
		overflow-wrap: anywhere;
	}

	.footer {
		display: flex;
		flex: none;
		gap: var(--space-4);
		padding: var(--space-2) var(--space-4);
		border-top: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text-3);
		font-size: var(--text-xs);
	}
	.footer kbd {
		margin-right: 2px;
	}

	/* Narrow screens: the file name makes way for the label. */
	@media (max-width: 30rem) {
		.detail {
			display: none;
		}
	}
	@media (pointer: coarse) {
		.option {
			min-height: 2.75rem;
		}
	}
	.cancel {
		display: none;
	}
	/* Phones: a sheet from the top, clear of the keyboard, with no key hints. */
	@media (max-width: 760px) {
		dialog {
			width: calc(100vw - 1rem);
			max-height: calc(var(--app-height, 100dvh) - env(safe-area-inset-top) - 1rem);
			margin: calc(env(safe-area-inset-top) + 0.5rem) auto auto;
			border-radius: 18px;
		}
		.field {
			height: 3.5rem;
		}
		.option {
			min-height: 3rem;
		}
		.footer,
		.esc-key {
			display: none;
		}
		.cancel {
			display: inline;
			padding: 0 var(--space-2);
			color: var(--accent);
			font-weight: 600;
		}
		.esc {
			min-height: 2.75rem;
		}
	}
</style>
