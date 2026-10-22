<script lang="ts">
	import { ExternalLink, X } from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import type { Engine } from '#lib/engine/client.ts';
	import type { ProjectSession } from '#lib/project/session.svelte.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import { runGuideAction, type GuideAction } from '#lib/workbench/guide.ts';
	import type { WorkbenchUi } from '#lib/workbench/ui.svelte.ts';
	import HelpGuide from './HelpGuide.svelte';

	/**
	 * The help, over the workbench: a dialog on a wide screen, the whole
	 * screen on a phone. Each "How do I…" answer's button does it here.
	 */
	let {
		workspace,
		ui,
		engine,
		session
	}: { workspace: Workspace; ui: WorkbenchUi; engine: Engine; session?: ProjectSession } = $props();

	const uid = $props.id();
	let dialog = $state<HTMLDialogElement>();

	$effect(() => {
		if (!dialog) return;
		if (ui.helpOpen && !dialog.open) dialog.showModal();
		else if (!ui.helpOpen && dialog.open) dialog.close();
	});

	function run(action: GuideAction) {
		void runGuideAction(action, { ui, workspace, engine, session });
	}

	function onbackdrop(event: MouseEvent) {
		if (event.target === dialog) ui.helpOpen = false;
	}
</script>

<!-- The backdrop click is a pointer shortcut; Escape closes the dialog for everyone else. -->
<dialog
	bind:this={dialog}
	class="help"
	aria-labelledby="{uid}-title"
	onclose={() => (ui.helpOpen = false)}
	onclick={onbackdrop}
>
	{#if ui.helpOpen}
		<header class="head">
			<h2 id="{uid}-title">Help</h2>
			<a class="page-link" href={resolve('/help')} target="_blank" rel="noopener">
				Open as a page <ExternalLink size={14} aria-hidden="true" />
			</a>
			<button
				type="button"
				class="close"
				aria-label="Close help"
				onclick={() => (ui.helpOpen = false)}
			>
				<X size={18} />
			</button>
		</header>
		<div class="body">
			<HelpGuide topic={ui.helpTopic} onaction={run} headingLevel={3} focusSearch={!ui.phone} />
		</div>
	{/if}
</dialog>

<style>
	.help {
		width: min(52rem, calc(100vw - 2rem));
		max-width: none;
		height: min(46rem, calc(100dvh - 3rem));
		max-height: none;
		padding: 0;
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: calc(var(--radius-lg) + 4px);
		background: var(--bg);
		color: var(--text);
		box-shadow: var(--shadow-lg);
	}
	.help[open] {
		display: flex;
		flex-direction: column;
		animation: pop 180ms var(--ease);
	}
	.help::backdrop {
		background: rgb(14 16 20 / 0.45);
		backdrop-filter: blur(6px);
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: translateY(8px) scale(0.98);
		}
	}
	.head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-2) var(--space-2) var(--space-5);
		border-bottom: 1px solid var(--border);
		background: var(--surface);
	}
	.head h2 {
		flex: 1;
		font-size: var(--text-xl);
	}
	.page-link {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		min-height: 2.75rem;
		padding: 0 var(--space-2);
		color: var(--text-2);
		font-size: var(--text-sm);
		text-decoration: none;
	}
	.page-link:hover {
		color: var(--accent);
	}
	.close {
		display: grid;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-2);
		cursor: pointer;
	}
	.close:hover {
		background: var(--surface-hover);
		color: var(--text);
	}
	.body {
		flex: 1;
		min-height: 0;
		padding: var(--space-4) var(--space-5) var(--space-7, 3rem);
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	@media (max-width: 760px) {
		.help {
			width: 100vw;
			height: 100dvh;
			margin: 0;
			border: 0;
			border-radius: 0;
		}
		.head {
			padding-top: max(var(--space-2), env(safe-area-inset-top));
		}
		.page-link {
			display: none;
		}
		.body {
			padding: var(--space-3) var(--space-4)
				calc(var(--space-7, 3rem) + env(safe-area-inset-bottom));
		}
	}
</style>
