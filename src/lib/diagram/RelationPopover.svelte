<script lang="ts">
	/**
	 * After a drag (or a pick) from one element to another: the
	 * relationships that fit, the details they need, and the SysML each
	 * will write.
	 */
	import { ArrowRight } from '@lucide/svelte';
	import { simpleName } from './textpatch.ts';
	import {
		defaultChoice,
		describeHost,
		interfacesFor,
		planRelation,
		portsFor,
		type ModelContext,
		type Plan,
		type RelationChoice,
		type RelationOption
	} from './relationships.ts';

	let {
		source,
		target,
		options,
		ctx,
		x,
		y,
		sheet = false,
		onapply,
		onclose
	}: {
		source: string;
		target: string;
		options: RelationOption[];
		ctx: ModelContext;
		/** Position inside the canvas, px (ignored as a sheet). */
		x: number;
		y: number;
		/** Show as a bottom sheet (phones). */
		sheet?: boolean;
		onapply: (plan: Plan) => Promise<string | null>;
		onclose: () => void;
	} = $props();

	let index = $state(0);
	// svelte-ignore state_referenced_locally
	let choices = $state<RelationChoice[]>(options.map((o) => defaultChoice(o, ctx)));
	let error = $state<string | null>(null);
	let busy = $state(false);

	const option = $derived(options[index]!);
	const choice = $derived(choices[index]!);
	const ports = $derived(option.kind === 'connect' ? portsFor(option, ctx) : null);
	const interfaces = $derived.by(() => {
		if (!ports) return [];
		const a = ports.from.find((p) => p.name === choice.fromPort);
		const b = ports.to.find((p) => p.name === choice.toPort);
		return a && b ? interfacesFor(a, b, ctx) : [];
	});
	const plan = $derived(planRelation(option, choice, ctx));
	const host = $derived(describeHost(option, ctx));

	/** After a port changes, offer the interface that fits the new pair (or none). */
	function portsChanged() {
		if (!ports) return;
		const a = ports.from.find((p) => p.name === choice.fromPort);
		const b = ports.to.find((p) => p.name === choice.toPort);
		choice.interfaceDef = a && b ? (interfacesFor(a, b, ctx)[0]?.def.name ?? '') : '';
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (typeof plan === 'string') {
			error = plan;
			return;
		}
		busy = true;
		error = await onapply(plan);
		busy = false;
	}

	/** Stay inside the canvas, whatever the popover's height turns out to be. */
	function keepInside(node: HTMLElement) {
		if (sheet) return;
		const place = () => {
			const parent = node.offsetParent as HTMLElement | null;
			if (!parent) return;
			const top = Math.max(8, Math.min(y, parent.clientHeight - node.offsetHeight - 8));
			const left = Math.max(8, Math.min(x, parent.clientWidth - node.offsetWidth - 8));
			node.style.top = `${top}px`;
			node.style.left = `${left}px`;
		};
		place();
		const observer = new ResizeObserver(place);
		observer.observe(node);
		return () => observer.disconnect();
	}

	function focusFirst(node: HTMLElement) {
		node.querySelector<HTMLInputElement>('input:checked, input, select')?.focus();
	}

	const portLabel = (p: { name: string; type: string | null; conjugated: boolean }) =>
		`${simpleName(p.name)}${p.type ? ` : ${p.conjugated ? '~' : ''}${simpleName(p.type)}` : ''}`;
</script>

<div
	class="pop"
	class:sheet
	style:left={sheet ? undefined : `${x}px`}
	style:top={sheet ? undefined : `${y}px`}
	role="dialog"
	tabindex="-1"
	aria-label="New relationship from {source} to {target}"
	onkeydown={(e) => {
		e.stopPropagation();
		if (e.key === 'Escape') {
			e.preventDefault();
			onclose();
		}
	}}
	{@attach focusFirst}
	{@attach keepInside}
>
	<form onsubmit={submit}>
		<p class="ends">
			<strong>{source}</strong>
			<ArrowRight size={14} aria-hidden="true" />
			<strong>{target}</strong>
		</p>

		<fieldset class="choices">
			<legend class="visually-hidden">Relationship</legend>
			{#each options as o, i (i)}
				<label class="choice" class:active={i === index}>
					<input type="radio" name="relationship" value={i} bind:group={index} />
					<span class="verb">{o.label}</span>
					<span class="sentence">
						{o.label.startsWith('is part') ||
						o.label.startsWith('is satisfied') ||
						o.label.startsWith('is verified') ||
						o.label.startsWith('is included')
							? `${o.to.label} ${o.label} ${o.from.label}`
							: `${o.from.label} ${o.label} ${o.to.label}`}
					</span>
				</label>
			{/each}
		</fieldset>

		{#if option.kind === 'compose'}
			<label class="field">
				<span>Name of the new part in {option.from.label}</span>
				<input bind:value={choice.name} autocomplete="off" spellcheck="false" required />
			</label>
		{:else if option.kind === 'actor' || option.kind === 'include'}
			<label class="field">
				<span
					>{option.kind === 'actor'
						? `Name of the actor in ${option.to.label}`
						: `Name of the included use case in ${option.from.label}`}</span
				>
				<input bind:value={choice.name} autocomplete="off" spellcheck="false" required />
			</label>
		{:else if option.kind === 'connect' && ports && (ports.from.length || ports.to.length)}
			<!-- A part without ports is connected itself. -->
			<div class="row">
				{#if ports.from.length}
					<label class="field">
						<span>Port of {option.from.label}</span>
						<select bind:value={choice.fromPort} onchange={portsChanged}>
							{#each ports.from as p (p.name)}<option value={p.name}>{portLabel(p)}</option>{/each}
						</select>
					</label>
				{/if}
				{#if ports.to.length}
					<label class="field">
						<span>Port of {option.to.label}</span>
						<select bind:value={choice.toPort} onchange={portsChanged}>
							{#each ports.to as p (p.name)}<option value={p.name}>{portLabel(p)}</option>{/each}
						</select>
					</label>
				{/if}
			</div>
			{#if ports.from.length && ports.to.length}
				<label class="field">
					<span>Typed by</span>
					<select bind:value={choice.interfaceDef}>
						<option value="">No interface (plain connect)</option>
						{#each interfaces as f (f.def.key)}
							<option value={f.def.name}>interface {f.def.label}</option>
						{/each}
					</select>
				</label>
			{/if}
		{/if}

		<div class="preview">
			<span class="where">Writes {host}</span>
			<code aria-label="SysML that will be written"
				>{typeof plan === 'string' ? '…' : plan.statement}</code
			>
		</div>

		{#if error}<p class="error" role="alert">{error}</p>{/if}

		<div class="actions">
			<button type="button" class="quiet" onclick={onclose}>Cancel</button>
			<button type="submit" class="primary" disabled={busy}>Create</button>
		</div>
	</form>
</div>

<style>
	form {
		display: grid;
		gap: var(--space-3);
	}
	.pop {
		position: absolute;
		z-index: 20;
		width: min(21rem, calc(100% - 24px));
		max-height: calc(100% - 16px);
		overflow-y: auto;
		padding: var(--space-3) var(--space-4) var(--space-4);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		animation: appear var(--duration) var(--ease);
	}
	.pop.sheet {
		left: 0;
		right: 0;
		bottom: 0;
		width: auto;
		max-height: 75%;
		overflow-y: auto;
		border-radius: var(--radius-lg) var(--radius-lg) 0 0;
		padding-bottom: max(var(--space-4), env(safe-area-inset-bottom));
		animation-name: rise;
	}
	.ends {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0;
		min-width: 0;
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.ends strong {
		overflow: hidden;
		color: var(--text);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.choices {
		display: grid;
		gap: 4px;
		margin: 0;
		padding: 0;
		border: 0;
	}
	.choice {
		display: grid;
		grid-template-columns: auto 1fr;
		column-gap: 8px;
		align-items: center;
		padding: 5px 10px;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition:
			border-color var(--duration) var(--ease),
			background var(--duration) var(--ease);
	}
	.choice:hover {
		background: var(--surface-hover);
	}
	.choice.active {
		border-color: var(--accent);
		background: var(--accent-weak);
	}
	.choice input {
		grid-row: span 2;
		margin: 0;
		accent-color: var(--accent);
	}
	.verb {
		font-weight: 620;
	}
	.sentence {
		overflow: hidden;
		color: var(--text-2);
		font-size: var(--text-xs);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* On a phone sheet the verbs say enough; keep Create in reach. */
	.sheet .sentence {
		display: none;
	}
	.row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-2);
	}
	.field {
		display: grid;
		gap: 4px;
		min-width: 0;
		color: var(--text-2);
		font-size: var(--text-xs);
	}
	.field input,
	.field select {
		width: 100%;
		min-width: 0;
		height: 2.25rem;
		padding: 0 var(--space-2);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-size: var(--text-md);
	}
	.field input {
		font-family: var(--font-mono);
	}
	.preview {
		display: grid;
		gap: 4px;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--surface-2);
	}
	.where {
		color: var(--text-3);
		font-size: var(--text-xs);
	}
	.preview code {
		overflow-wrap: anywhere;
		color: var(--text);
		font-family: var(--font-mono);
		font-size: 12px;
	}
	.error {
		margin: 0;
		color: var(--danger);
		font-size: var(--text-sm);
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
	}
	.actions button {
		height: 2.25rem;
		padding: 0 var(--space-4);
		border: 0;
		border-radius: var(--radius-sm);
		font: inherit;
		font-weight: 580;
		cursor: pointer;
	}
	.primary {
		background: var(--accent);
		color: var(--accent-text);
	}
	.primary:hover {
		background: var(--accent-hover);
	}
	.quiet {
		background: transparent;
		color: var(--text-2);
	}
	.quiet:hover {
		background: var(--surface-hover);
	}
	@keyframes appear {
		from {
			opacity: 0;
			translate: 0 4px;
		}
	}
	@keyframes rise {
		from {
			translate: 0 100%;
		}
	}
</style>
