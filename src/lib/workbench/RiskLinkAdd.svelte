<script lang="ts" module>
	import type { ModelElement } from '#lib/project/elements.ts';

	/** A risk control (a `RiskControl` requirement) or a mitigation (a `Mitigation` action) a line can name. */
	export interface RiskLink {
		kind: 'control' | 'mitigation';
		element: ModelElement;
		qualifiedName: string;
		/** `RC-001 Battery thermal protection`, `batteryManagementSystem`. */
		label: string;
	}
</script>

<script lang="ts">
	/**
	 * "Link a risk control", under an FMEA line in the details: a searchable
	 * list of the project's risk controls and mitigations the line doesn't
	 * name yet, and a new control or mitigation by the name typed, as "Add a
	 * test that verifies it" does for a requirement.
	 */
	import { Plus } from '@lucide/svelte';
	import KindGlyph from '#lib/ui/KindGlyph.svelte';

	let {
		candidates,
		about,
		busy = false,
		open = $bindable(false),
		onpick,
		oncreate
	}: {
		/** What the line doesn't name yet. */
		candidates: RiskLink[];
		/** The line, in words, for the field's name. */
		about: string;
		busy?: boolean;
		open?: boolean;
		onpick: (link: RiskLink) => void;
		oncreate: (kind: 'control' | 'mitigation', name: string) => void;
	} = $props();

	const uid = $props.id();
	let query = $state('');
	const matches = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return (q ? candidates.filter((c) => c.label.toLowerCase().includes(q)) : candidates).slice(
			0,
			50
		);
	});
	const newName = $derived(
		query.trim() && !candidates.some((c) => c.element.label === query.trim()) ? query.trim() : ''
	);

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			open = false;
		} else if (event.key === 'Enter') {
			event.preventDefault();
			if (matches[0]) onpick(matches[0]);
			else if (newName) oncreate('control', newName);
		}
	}

	const focus = (node: HTMLInputElement) => node.focus({ preventScroll: true });
	const reveal = (node: HTMLElement) => {
		requestAnimationFrame(() => node.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
	};
</script>

{#if !open}
	<button type="button" class="add" onclick={() => (open = true)}>
		<Plus size={14} aria-hidden="true" /> Link a risk control or mitigation
	</button>
{:else}
	<div class="picker" role="group" aria-label="Link a risk control or mitigation" {@attach reveal}>
		<input
			type="search"
			bind:value={query}
			placeholder="Find or name a control"
			aria-label="Find or name a risk control or mitigation for {about}"
			aria-controls="{uid}-list"
			disabled={busy}
			{onkeydown}
			{@attach focus}
		/>
		<ul id="{uid}-list" aria-label="Risk controls and mitigations">
			{#each matches as c (c.element.key)}
				<li>
					<button type="button" disabled={busy} onclick={() => onpick(c)}>
						<KindGlyph kind={c.element.kind} isDefinition={false} size={14} />
						<span class="label">{c.label}</span>
						<span class="owner">{c.kind === 'control' ? 'risk control' : 'mitigation'}</span>
					</button>
				</li>
			{/each}
			{#if newName}
				<li>
					<button
						type="button"
						class="new"
						disabled={busy}
						onclick={() => oncreate('control', newName)}
					>
						<Plus size={14} aria-hidden="true" />
						<span class="label">New risk control “{newName}”</span>
					</button>
				</li>
				<li>
					<button
						type="button"
						class="new"
						disabled={busy}
						onclick={() => oncreate('mitigation', newName)}
					>
						<Plus size={14} aria-hidden="true" />
						<span class="label">New mitigation “{newName}”</span>
					</button>
				</li>
			{:else if !matches.length}
				<li class="none">
					{candidates.length ? 'Nothing matches.' : 'No risk controls or mitigations yet.'} Type a name
					to make one.
				</li>
			{/if}
		</ul>
		<button type="button" class="cancel" onclick={() => (open = false)}>Cancel</button>
	</div>
{/if}

<style>
	.add {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 2.25rem;
		margin-top: var(--space-1);
		padding: 0 var(--space-3);
		border: 1px dashed var(--border-strong);
		border-radius: var(--radius-sm);
		background: none;
		color: var(--accent);
		font: inherit;
		font-size: var(--text-sm);
		text-align: left;
		cursor: pointer;
	}
	.add:hover {
		border-color: var(--accent);
		background: var(--accent-weak);
	}
	.picker {
		scroll-margin-top: 6rem;
		display: grid;
		gap: var(--space-2);
		margin-top: var(--space-1);
		padding: var(--space-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-md, 8px);
		background: var(--surface);
	}
	input {
		width: 100%;
		min-height: 2.5rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--bg);
		color: var(--text);
		font: inherit;
		font-size: 16px; /* no zoom on iPhone */
	}
	ul {
		max-height: 15rem;
		overflow-y: auto;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li button {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		min-height: 2.75rem;
		padding: 0 var(--space-2);
		border: 0;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--text-sm);
		text-align: left;
		cursor: pointer;
	}
	li button:hover,
	li button:focus-visible {
		background: var(--surface-hover);
	}
	.label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.owner {
		margin-left: auto;
		flex-shrink: 0;
		color: var(--text-3);
		font-size: var(--text-xs);
	}
	.new {
		color: var(--accent);
	}
	.none {
		padding: var(--space-2);
		color: var(--text-3);
		font-size: var(--text-sm);
	}
	.cancel {
		justify-self: end;
		min-height: 2.25rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: none;
		color: var(--text-2);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	@media (max-width: 760px) {
		.add,
		.cancel {
			min-height: 2.75rem;
		}
	}
</style>
