<script lang="ts" module>
	/** Chosen once, kept for every diagram this session. */
	const choices = $state({ transparent: false, dark: false });
</script>

<script lang="ts">
	import { Check, Copy, Download, FileCode, Image } from '@lucide/svelte';
	import { toasts } from '#lib/ui/toasts.svelte.ts';
	import type { Exportable } from './export/render.ts';

	/**
	 * Export a diagram as a picture: SVG for documents, PNG for slides, or
	 * either to the clipboard. The export code loads on first use; on phones
	 * the file goes to the share sheet.
	 */
	let {
		title,
		diagram,
		share = false,
		disabled = false
	}: {
		/** The view's name, for the file name (`drone-interconnection.svg`). */
		title: string;
		/** The whole diagram as it is drawn, read when exporting. */
		diagram: () => Promise<Exportable>;
		/** Offer the phone's share sheet instead of a download. */
		share?: boolean;
		disabled?: boolean;
	} = $props();

	let open = $state(false);
	let busy = $state(false);
	let root: HTMLDivElement | undefined = $state();
	let menu: HTMLDivElement | undefined = $state();
	const uid = $props.id();

	const canCopy =
		typeof ClipboardItem !== 'undefined' &&
		typeof navigator !== 'undefined' &&
		typeof navigator.clipboard?.write === 'function';
	/** Whether the app shows the dark theme now, so the export can match it. */
	let darkNow = $state(false);

	const load = () => import('./export/render.ts');
	const options = () => ({
		theme: darkNow && choices.dark ? ('dark' as const) : ('light' as const),
		transparent: choices.transparent
	});

	function fail(error: unknown) {
		const reason = error instanceof Error ? error.message : String(error);
		toasts.show(`Could not export the diagram: ${reason}`, { tone: 'error' });
	}

	async function save(kind: 'svg' | 'png') {
		close(true);
		busy = true;
		try {
			const [render, data] = await Promise.all([load(), diagram()]);
			if (kind === 'svg') await render.saveSvg(data, title, options(), share);
			else await render.savePng(data, title, options(), share);
		} catch (error) {
			fail(error);
		} finally {
			busy = false;
		}
	}

	/**
	 * Copy as PNG or as SVG markup. The clipboard item is made at once, with
	 * its content still to come, so Safari counts it as part of the click.
	 */
	async function copy(kind: 'png' | 'svg') {
		close(true);
		busy = true;
		const content = Promise.all([load(), diagram()]).then(([render, data]) =>
			kind === 'png'
				? render.pngBlob(data, options())
				: render.svgText(data, options()).then((svg) => new Blob([svg], { type: 'text/plain' }))
		);
		try {
			const type = kind === 'png' ? 'image/png' : 'text/plain';
			await navigator.clipboard.write([new ClipboardItem({ [type]: content })]);
			toasts.show(
				kind === 'png' ? 'Copied the diagram as an image.' : 'Copied the diagram as SVG.',
				{ tone: 'success' }
			);
		} catch (error) {
			if (error instanceof DOMException && error.name === 'NotAllowedError') {
				toasts.show('The browser did not allow copying. Download the file instead.', {
					tone: 'error'
				});
			} else fail(error);
		} finally {
			busy = false;
		}
	}

	function toggle() {
		if (open) return close(false);
		// Still exporting: the button keeps its focus, but waits.
		if (busy) return;
		darkNow =
			document.documentElement.dataset.theme === 'dark' ||
			(!document.documentElement.dataset.theme &&
				matchMedia('(prefers-color-scheme: dark)').matches);
		open = true;
		requestAnimationFrame(() => items()[0]?.focus({ preventScroll: true }));
	}

	function close(restore: boolean) {
		open = false;
		if (restore) root?.querySelector<HTMLButtonElement>('.trigger')?.focus({ preventScroll: true });
	}

	function items(): HTMLButtonElement[] {
		return [...(menu?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? [])];
	}

	function onkeydown(event: KeyboardEvent) {
		if (!open) return;
		const list = items();
		const index = list.indexOf(document.activeElement as HTMLButtonElement);
		const move = (to: number) => {
			event.preventDefault();
			list[(to + list.length) % list.length]?.focus();
		};
		if (event.key === 'ArrowDown') move(index + 1);
		else if (event.key === 'ArrowUp') move(index - 1);
		else if (event.key === 'Home') move(0);
		else if (event.key === 'End') move(list.length - 1);
		else if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			close(true);
		}
	}

	// Close on a press anywhere else, or when focus leaves.
	$effect(() => {
		if (!open) return;
		const away = (event: PointerEvent) => {
			if (!root?.contains(event.target as Node)) close(false);
		};
		window.addEventListener('pointerdown', away, true);
		return () => window.removeEventListener('pointerdown', away, true);
	});

	function onfocusout(event: FocusEvent) {
		if (open && !root?.contains(event.relatedTarget as Node | null)) open = false;
	}
</script>

<!-- Keys and focus bubble up from the menu inside; the wrapper only listens. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="export" bind:this={root} {onkeydown} {onfocusout}>
	<button
		type="button"
		class="trigger"
		aria-haspopup="menu"
		aria-expanded={open}
		aria-controls={open ? `${uid}-menu` : undefined}
		{disabled}
		aria-busy={busy}
		title="Export this diagram as SVG or PNG"
		onclick={toggle}
	>
		<Download size={14} /> <span>Export</span>
	</button>
	{#if open}
		<div class="menu" id="{uid}-menu" role="menu" aria-label="Export diagram" bind:this={menu}>
			<button
				type="button"
				role="menuitem"
				aria-describedby="{uid}-svg"
				onclick={() => save('svg')}
			>
				<FileCode size={15} />
				<span class="text">
					<strong>SVG</strong>
					<small aria-hidden="true" id="{uid}-svg">Vector, for documents and print</small>
				</span>
			</button>
			<button
				type="button"
				role="menuitem"
				aria-describedby="{uid}-png"
				onclick={() => save('png')}
			>
				<Image size={15} />
				<span class="text">
					<strong>PNG</strong>
					<small aria-hidden="true" id="{uid}-png">Image at 2× resolution: for slides</small>
				</span>
			</button>
			{#if canCopy}
				<button
					type="button"
					role="menuitem"
					aria-describedby="{uid}-copy"
					onclick={() => copy('png')}
				>
					<Copy size={15} />
					<span class="text">
						<strong>Copy image</strong>
						<small aria-hidden="true" id="{uid}-copy">PNG, to paste into slides or chat</small>
					</span>
				</button>
				<button
					type="button"
					role="menuitem"
					aria-describedby="{uid}-copy-svg"
					onclick={() => copy('svg')}
				>
					<Copy size={15} />
					<span class="text">
						<strong>Copy SVG</strong>
						<small aria-hidden="true" id="{uid}-copy-svg">The markup, for drawing tools</small>
					</span>
				</button>
			{/if}
			<div class="rule" role="separator"></div>
			<button
				type="button"
				role="menuitemcheckbox"
				class="option"
				aria-checked={choices.transparent}
				onclick={() => (choices.transparent = !choices.transparent)}
			>
				<span class="box" aria-hidden="true">
					{#if choices.transparent}<Check size={12} strokeWidth={3} />{/if}
				</span>
				<span>Transparent background</span>
			</button>
			{#if darkNow}
				<button
					type="button"
					role="menuitemcheckbox"
					class="option"
					aria-checked={choices.dark}
					onclick={() => (choices.dark = !choices.dark)}
				>
					<span class="box" aria-hidden="true">
						{#if choices.dark}<Check size={12} strokeWidth={3} />{/if}
					</span>
					<span>Dark, as on screen</span>
				</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.export {
		position: relative;
		display: flex;
	}
	/* The same as the other buttons of the diagram toolbar. */
	.trigger {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 2rem;
		padding: 0 var(--space-3);
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text);
		font-weight: 520;
		cursor: pointer;
	}
	.trigger:hover:not(:disabled),
	.trigger[aria-expanded='true'] {
		background: var(--surface-hover);
	}
	.trigger:disabled {
		color: var(--text-3);
		cursor: default;
	}
	.trigger[aria-busy='true'] {
		cursor: progress;
	}
	@container (max-width: 34rem) {
		.trigger span {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
		.trigger {
			padding: 0 var(--space-2);
		}
	}
	.menu {
		position: absolute;
		top: calc(100% + 8px);
		right: -3px;
		z-index: 20;
		display: grid;
		gap: 2px;
		width: min(17.5rem, calc(100vw - 2rem));
		padding: 4px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-lg);
		animation: appear var(--duration) var(--ease);
		transform-origin: top right;
	}
	.menu button {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		min-height: 2.75rem;
		padding: 7px 10px;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.menu button :global(svg) {
		flex: none;
		margin-top: 2px;
		color: var(--text-2);
	}
	.menu button:hover,
	.menu button:focus-visible {
		background: var(--surface-hover);
		outline: none;
	}
	.menu button:focus-visible {
		box-shadow: inset 0 0 0 2px var(--focus);
	}
	.text {
		display: grid;
		gap: 1px;
	}
	strong {
		font-size: var(--text-sm);
		font-weight: 600;
	}
	small {
		color: var(--text-2);
		font-size: var(--text-xs);
	}
	.rule {
		height: 1px;
		margin: 3px 6px;
		background: var(--border);
	}
	.menu .option {
		align-items: center;
		min-height: 2.25rem;
		padding: 0 10px;
		font-size: var(--text-sm);
	}
	.box {
		display: grid;
		place-items: center;
		flex: none;
		width: 15px;
		height: 15px;
		border: 1.5px solid var(--border-strong);
		border-radius: 4px;
	}
	.option[aria-checked='true'] .box {
		border-color: var(--accent);
		background: var(--accent);
	}
	.menu .option[aria-checked='true'] .box :global(svg) {
		margin: 0;
		color: var(--accent-text);
	}
	@keyframes appear {
		from {
			opacity: 0;
			scale: 0.96;
		}
	}
	@media (pointer: coarse) {
		.menu .option {
			min-height: 2.75rem;
		}
	}
</style>
