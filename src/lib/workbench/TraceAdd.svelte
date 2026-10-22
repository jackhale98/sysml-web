<script lang="ts">
	/**
	 * "Add what satisfies it" / "Add a test that verifies it", under a
	 * requirement in the inspector: a searchable list of the elements that fit,
	 * and for tests, a new verification case by name. Each pick writes the
	 * `satisfy … by …;` or `verify …;` statement, as drawing the line in a
	 * diagram does, as one undoable step.
	 */
	import { Plus } from '@lucide/svelte';
	import type { Engine } from '#lib/engine/client.ts';
	import { ownersOf } from '#lib/diagram/model.ts';
	import {
		planNewVerification,
		planRelation,
		relationsFor,
		type ModelContext,
		type Plan
	} from '#lib/diagram/relationships.ts';
	import type { ModelElement } from '#lib/project/elements.ts';
	import { isLibraryFile, type Workspace } from '#lib/project/workspace.svelte.ts';
	import KindGlyph from '#lib/ui/KindGlyph.svelte';
	import { toasts } from '#lib/ui/toasts.svelte.ts';
	import { applySteps } from './actions.ts';

	let {
		requirement,
		kind,
		linked,
		workspace,
		engine
	}: {
		requirement: ModelElement;
		kind: 'satisfy' | 'verify';
		/** Elements already linked, left out of the list. */
		linked: (ModelElement | undefined)[];
		workspace: Workspace;
		engine: Engine;
	} = $props();

	const uid = $props.id();
	const LIMIT = 50;
	let open = $state(false);
	let query = $state('');
	let busy = $state(false);

	const ctx: ModelContext = $derived({
		elements: workspace.elements,
		owners: ownersOf(workspace.tree),
		textOf: (path: string) => workspace.text(path),
		analyses: Object.values(workspace.analyses)
	});

	/** Parts first (what a design is made of), then what it does, then the rest. */
	const ORDER = ['part', 'action', 'port', 'state', 'use_case', 'item'];
	const rank = (e: ModelElement) => {
		const i = ORDER.indexOf(e.kind);
		return i < 0 ? ORDER.length : i;
	};
	/** Top-level parts before the ones nested inside them. */
	const depth = (e: ModelElement) => {
		let n = 0;
		for (let o = ctx.owners.get(e.key); o; o = ctx.owners.get(o.key)) n++;
		return n;
	};

	/** Elements that can satisfy (parts, actions, ports…) or verify (verification cases) it. */
	const candidates = $derived.by(() => {
		if (!open) return [];
		const taken = new Set(linked.map((e) => e?.key));
		return workspace.elements
			.filter(
				(e) =>
					!taken.has(e.key) &&
					!isLibraryFile(e.file) &&
					relationsFor(e, requirement, ctx).some((o) => o.kind === kind && o.from.key === e.key)
			)
			.sort((a, b) => rank(a) - rank(b) || depth(a) - depth(b) || a.label.localeCompare(b.label));
	});
	const matches = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const owner = (e: ModelElement) => ctx.owners.get(e.key)?.label ?? '';
		const found = q
			? candidates.filter((e) => `${e.label} ${owner(e)}`.toLowerCase().includes(q))
			: candidates;
		return found.slice(0, LIMIT);
	});
	const newName = $derived(
		kind === 'verify' && query.trim() && !candidates.some((e) => e.label === query.trim())
			? query.trim()
			: ''
	);

	async function write(plan: Plan | string) {
		if (typeof plan === 'string') {
			toasts.show(plan, { tone: 'error' });
			return;
		}
		busy = true;
		const error = await applySteps(workspace, plan.label, plan.steps, checkSyntax);
		busy = false;
		if (error) toasts.show(error, { tone: 'error' });
		else {
			open = false;
			query = '';
		}
	}

	function pick(element: ModelElement) {
		const option = relationsFor(element, requirement, ctx).find(
			(o) => o.kind === kind && o.from.key === element.key
		);
		if (option) void write(planRelation(option, {}, ctx));
	}

	/** Refuse a change that would add syntax errors. */
	async function checkSyntax(path: string, before: string, after: string) {
		const [was, now] = await Promise.all([
			engine.analyze(path, before),
			engine.analyze(path, after)
		]);
		return now.model.syntax_errors.length > was.model.syntax_errors.length
			? `That change would make the SysML invalid: ${now.model.syntax_errors[0]?.message ?? 'syntax error'}`
			: null;
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			open = false;
		} else if (event.key === 'Enter') {
			event.preventDefault();
			if (matches[0]) pick(matches[0]);
			else if (newName) void write(planNewVerification(requirement, newName, ctx));
		}
	}

	const focus = (node: HTMLInputElement) => node.focus({ preventScroll: true });
	/** Bring the field and its list into view (on a phone the sheet would leave the list below the fold). */
	const reveal = (node: HTMLElement) => {
		requestAnimationFrame(() => node.scrollIntoView({ block: 'start', behavior: 'smooth' }));
	};
	const what = $derived(kind === 'satisfy' ? 'what satisfies it' : 'a test that verifies it');
</script>

{#if !open}
	<button type="button" class="add" onclick={() => (open = true)}>
		<Plus size={14} aria-hidden="true" /> Add {what}
	</button>
{:else}
	<div class="picker" role="group" aria-label="Add {what}" {@attach reveal}>
		<input
			type="search"
			bind:value={query}
			placeholder={kind === 'satisfy' ? 'Find a part, action or port' : 'Find or name a test'}
			aria-label={kind === 'satisfy'
				? `Find what satisfies ${requirement.label}`
				: `Find or name a test for ${requirement.label}`}
			aria-controls="{uid}-list"
			disabled={busy}
			{onkeydown}
			{@attach focus}
		/>
		<ul id="{uid}-list" aria-label={kind === 'satisfy' ? 'Can satisfy it' : 'Tests'}>
			{#each matches as e (e.key)}
				<li>
					<button type="button" disabled={busy} onclick={() => pick(e)}>
						<KindGlyph kind={e.kind} isDefinition={e.isDefinition} size={14} />
						<span class="label">{e.label}</span>
						{#if ctx.owners.get(e.key)}<span class="owner">in {ctx.owners.get(e.key)?.label}</span
							>{/if}
					</button>
				</li>
			{/each}
			{#if newName}
				<li>
					<button
						type="button"
						class="new"
						disabled={busy}
						onclick={() => void write(planNewVerification(requirement, newName, ctx))}
					>
						<Plus size={14} aria-hidden="true" />
						<span class="label">New test “{newName}”</span>
					</button>
				</li>
			{:else if !matches.length}
				<li class="none">
					{#if kind === 'verify'}
						{candidates.length ? 'No test matches.' : 'No tests yet.'} Type a name to make one.
					{:else}
						Nothing in the design fits{query.trim() ? ' that search' : ''}. Add a part first.
					{/if}
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
</style>
