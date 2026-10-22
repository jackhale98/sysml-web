<script lang="ts">
	import {
		ChevronRight,
		CircleQuestionMark,
		GitBranch,
		Monitor,
		Moon,
		PanelBottomOpen,
		Search,
		Settings,
		Sun,
		TriangleAlert
	} from '@lucide/svelte';
	import { theme } from '#lib/ui/theme.svelte.ts';
	import type { WorkbenchUi } from '#lib/workbench/ui.svelte.ts';
	import Sheet from './Sheet.svelte';

	/** The phone's overflow menu: everything the desktop top bar shows as buttons. */
	let {
		open = $bindable(false),
		ui,
		errors,
		warnings
	}: { open: boolean; ui: WorkbenchUi; errors: number; warnings: number } = $props();

	const themeLabel = $derived(
		theme.choice === 'system' ? 'Match system' : theme.choice === 'light' ? 'Light' : 'Dark'
	);

	function then(action: () => void) {
		open = false;
		action();
	}
</script>

<Sheet bind:open label="More">
	<ul role="list">
		<li>
			<button type="button" onclick={() => theme.next()}>
				<span class="tile">
					{#if theme.choice === 'light'}<Sun size={18} />{:else if theme.choice === 'dark'}<Moon
							size={18}
						/>{:else}<Monitor size={18} />{/if}
				</span>
				<span class="label">Theme</span>
				<span class="value">{themeLabel}</span>
			</button>
		</li>
		<li>
			<button type="button" onclick={() => then(() => (ui.problemsSheet = true))}>
				<span class="tile" class:bad={errors > 0}><TriangleAlert size={18} /></span>
				<span class="label">Problems</span>
				<span class="value"
					><span class="count" class:bad={errors > 0}>{errors + warnings}</span>
					<span class="visually-hidden">: {errors} errors, {warnings} warnings</span></span
				>
				<ChevronRight size={16} class="chev" />
			</button>
		</li>
		<li>
			<button type="button" onclick={() => then(() => ui.showDetails('full'))}>
				<span class="tile"><PanelBottomOpen size={18} /></span>
				<span class="label">Element details</span>
				<ChevronRight size={16} class="chev" />
			</button>
		</li>
		<li>
			<button type="button" onclick={() => then(() => (ui.paletteOpen = true))}>
				<span class="tile"><Search size={18} /></span>
				<span class="label">Search and commands</span>
				<ChevronRight size={16} class="chev" />
			</button>
		</li>
		<li>
			<button type="button" onclick={() => then(() => (ui.sourceControlOpen = true))}>
				<span class="tile"><GitBranch size={18} /></span>
				<span class="label">Source control</span>
				<ChevronRight size={16} class="chev" />
			</button>
		</li>
		<li>
			<button type="button" onclick={() => then(() => ui.showHelp())}>
				<span class="tile"><CircleQuestionMark size={18} /></span>
				<span class="label">Help</span>
				<ChevronRight size={16} class="chev" />
			</button>
		</li>
		<li>
			<button type="button" onclick={() => then(() => (ui.settingsOpen = true))}>
				<span class="tile"><Settings size={18} /></span>
				<span class="label">Settings</span>
				<ChevronRight size={16} class="chev" />
			</button>
		</li>
	</ul>
</Sheet>

<style>
	ul {
		display: grid;
		margin: 0;
		padding: 0;
		overflow: hidden;
		list-style: none;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
	}
	li + li {
		border-top: 1px solid var(--border);
	}
	button {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		min-height: 3.25rem;
		padding: 0 var(--space-3);
		border: 0;
		background: var(--surface);
		color: var(--text);
		font-size: var(--text-md);
		text-align: left;
		cursor: pointer;
	}
	button:active {
		background: var(--surface-hover);
	}
	.tile {
		display: grid;
		place-items: center;
		width: 2.125rem;
		height: 2.125rem;
		border-radius: 10px;
		background: var(--surface-2);
		color: var(--text-2);
	}
	.tile.bad {
		background: var(--danger-weak);
		color: var(--danger);
	}
	.label {
		flex: 1;
		font-weight: 550;
	}
	.value {
		color: var(--text-2);
	}
	.count {
		display: inline-block;
		min-width: 1.75rem;
		padding: 1px 8px;
		border-radius: 999px;
		background: var(--surface-2);
		font-variant-numeric: tabular-nums;
		text-align: center;
	}
	.count.bad {
		background: var(--danger-weak);
		color: var(--danger);
		font-weight: 650;
	}
	button :global(.chev) {
		color: var(--text-3);
	}
</style>
