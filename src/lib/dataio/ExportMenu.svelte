<script lang="ts">
	import { Download, FileCode, FileSpreadsheet, FileText, Printer } from '@lucide/svelte';
	import { toasts } from '#lib/ui/toasts.svelte.ts';
	import type { ExportTable } from './export.ts';
	import type { ReqifProject } from './reqif-write.ts';

	/**
	 * Export a table view: CSV, an Excel workbook, or a printed page (which
	 * the print dialog can save as PDF). A table of requirements also offers
	 * ReqIF, every requirement in the project for DOORS, Polarion, Jama and
	 * other requirements tools. The writers load on first use.
	 */
	let {
		table,
		filtered = false,
		share = false,
		reqif
	}: {
		/** The table as shown (searched and sorted), read when exporting. */
		table: () => ExportTable;
		/** Whether a search hides some rows, to say so in the menu. */
		filtered?: boolean;
		/** Offer the phone's share sheet instead of a download. */
		share?: boolean;
		/** The project, read when exporting its requirements as ReqIF (requirements tables only). */
		reqif?: () => ReqifProject;
	} = $props();

	let open = $state(false);
	let busy = $state(false);
	/** The menu's left edge, relative to the button, so it stays on the screen. */
	let menuLeft = $state<number | null>(null);
	let root: HTMLDivElement | undefined = $state();
	const uid = $props.id();

	async function run(kind: 'csv' | 'xlsx' | 'print' | 'reqif') {
		open = false;
		busy = true;
		try {
			if (kind === 'reqif') {
				if (!reqif) return;
				const { exportReqif } = await import('./reqif-write.ts');
				await exportReqif(reqif(), share);
				return;
			}
			const io = await import('./export.ts');
			const data = table();
			if (kind === 'csv') await io.exportCsv(data, share);
			else if (kind === 'xlsx') await io.exportXlsx(data, share);
			else io.printTable(data);
		} catch (error) {
			toasts.show(`Could not export: ${error instanceof Error ? error.message : String(error)}`, {
				tone: 'error'
			});
		} finally {
			busy = false;
		}
	}

	function onfocusout(event: FocusEvent) {
		if (!root?.contains(event.relatedTarget as Node | null)) open = false;
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && open) {
			event.stopPropagation();
			open = false;
			root?.querySelector<HTMLButtonElement>('.trigger')?.focus();
		}
	}
</script>

<!-- Keys and focus bubble up from the menu inside; the wrapper only listens. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="export" bind:this={root} {onfocusout} {onkeydown}>
	<button
		type="button"
		class="trigger"
		aria-haspopup="menu"
		aria-expanded={open}
		aria-controls="{uid}-menu"
		disabled={busy}
		onclick={(event) => {
			const rect = event.currentTarget.getBoundingClientRect();
			const width = Math.min(19 * 16, window.innerWidth - 32);
			const left = Math.min(Math.max(rect.right - width, 16), window.innerWidth - 16 - width);
			menuLeft = left - rect.left;
			open = !open;
		}}
	>
		<Download size={14} /> <span class="button-label">Export</span>
	</button>
	{#if open}
		<div
			class="menu"
			style:left={menuLeft === null ? undefined : `${menuLeft}px`}
			id="{uid}-menu"
			role="menu"
			aria-label="Export this table"
		>
			{#if filtered}
				<p class="hint">Only the rows shown, as searched and filtered.</p>
			{/if}
			<button
				type="button"
				role="menuitem"
				aria-label="CSV"
				aria-describedby="{uid}-csv"
				onclick={() => run('csv')}
			>
				<FileText size={15} />
				<span>
					<strong>CSV</strong>
					<small id="{uid}-csv">Opens in Excel, Numbers and Google Sheets</small>
				</span>
			</button>
			<button
				type="button"
				role="menuitem"
				aria-label="Excel workbook"
				aria-describedby="{uid}-xlsx"
				onclick={() => run('xlsx')}
			>
				<FileSpreadsheet size={15} />
				<span>
					<strong>Excel workbook</strong>
					<small id="{uid}-xlsx">.xlsx with a header row and filters</small>
				</span>
			</button>
			<button
				type="button"
				role="menuitem"
				aria-label="Print or save as PDF"
				aria-describedby="{uid}-print"
				onclick={() => run('print')}
			>
				<Printer size={15} />
				<span>
					<strong>Print or save as PDF</strong>
					<small id="{uid}-print">A page with the title and date</small>
				</span>
			</button>
			{#if reqif}
				<button
					type="button"
					role="menuitem"
					aria-label="ReqIF"
					aria-describedby="{uid}-reqif"
					onclick={() => run('reqif')}
				>
					<FileCode size={15} />
					<span>
						<strong>ReqIF</strong>
						<small id="{uid}-reqif"
							>Every requirement in the project, for DOORS, Polarion, Jama and others</small
						>
					</span>
				</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.export {
		position: relative;
	}
	.trigger {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 2rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.trigger:hover {
		border-color: var(--border-strong);
	}
	.trigger:disabled {
		opacity: 0.6;
		cursor: progress;
	}
	@media (max-width: 760px) {
		/* An icon button on phones (the table's tools row is one line there). */
		.trigger {
			justify-content: center;
			width: 2.75rem;
			height: 2.75rem;
			padding: 0;
		}
		.button-label {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
	}
	.menu {
		position: absolute;
		top: calc(100% + 6px);
		z-index: 6;
		display: grid;
		gap: 2px;
		width: min(19rem, calc(100vw - 2rem));
		padding: var(--space-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface);
		box-shadow: var(--shadow-lg);
	}
	.hint {
		padding: var(--space-1) var(--space-2) var(--space-2);
		color: var(--text-2);
		font-size: var(--text-xs);
	}
	.menu button {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		min-height: 2.75rem;
		padding: var(--space-2);
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text);
		text-align: left;
		cursor: pointer;
	}
	.menu button :global(svg) {
		flex: none;
		margin-top: 2px;
		color: var(--text-2);
	}
	.menu button:hover {
		background: var(--surface-hover);
	}
	.menu span {
		display: grid;
		gap: 1px;
	}
	.menu strong {
		font-size: var(--text-sm);
		font-weight: 600;
	}
	.menu small {
		color: var(--text-2);
		font-size: var(--text-xs);
	}
	@media (max-width: 760px) {
		.trigger {
			height: 2.75rem;
		}
	}
</style>
