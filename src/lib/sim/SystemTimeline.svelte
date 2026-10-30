<script lang="ts">
	import { ArrowRight, CircleDot, Info, Send, TriangleAlert } from '@lucide/svelte';
	import { explain, timeText, type Part } from './model.ts';
	import type { SystemEvent } from './system.ts';

	/** The one timeline of several parts' machines: who stepped, and who sent what to whom. */
	interface Props {
		timeline: SystemEvent[];
		labelOf: (part: string, state: string) => string;
	}

	let { timeline, labelOf }: Props = $props();

	const values = (v: Record<string, unknown> | undefined) =>
		v && Object.keys(v).length
			? ` (${Object.entries(v)
					.map(([k, x]) => `${k} = ${typeof x === 'string' ? `"${x}"` : String(x)}`)
					.join(', ')})`
			: '';

	function text(e: SystemEvent): Part[] {
		if (e.kind === 'step') {
			const s = e.step;
			if (s.step === 0)
				return [{ text: 'started in ' }, { text: labelOf(e.part, s.to_state), code: true }];
			return [
				{ text: labelOf(e.part, s.from_state), code: true },
				{ text: ' → ' },
				{ text: labelOf(e.part, s.to_state), code: true },
				...(s.cause ? [{ text: ': ' }, ...explain(s.cause)] : [])
			];
		}
		if (e.kind === 'note') return explain(e.text);
		const head: Part[] = [
			{ text: 'sent ' },
			{ text: e.signal, code: true },
			{ text: values(e.values) },
			...(e.via ? [{ text: ' through ' }, { text: e.via, code: true }] : [])
		];
		if (e.lost) return [...head, { text: ': lost, ' }, ...explain(e.lost)];
		return [
			...head,
			{ text: ' to ' },
			{ text: e.to ?? '', code: true },
			...(e.port ? [{ text: ', at ' }, { text: e.port, code: true }] : [])
		];
	}

	let list = $state<HTMLOListElement>();
	$effect(() => {
		void timeline.length;
		list?.lastElementChild?.scrollIntoView({ block: 'nearest' });
	});
</script>

{#if timeline.length}
	<ol class="timeline" bind:this={list} aria-label="Timeline of every part">
		{#each timeline as e, i (i)}
			<li class={e.kind} class:lost={e.kind === 'signal' && !!e.lost}>
				<span class="time">{timeText(e.time)}</span>
				<span class="icon" aria-hidden="true">
					{#if e.kind === 'step'}<CircleDot size={13} />{:else if e.kind === 'note'}<Info
							size={13}
						/>{:else if e.lost}<TriangleAlert size={13} />{:else}<Send size={13} />{/if}
				</span>
				<span class="who">
					{e.kind === 'signal' ? e.from : e.part}
					{#if e.kind === 'signal' && !e.lost}<ArrowRight size={12} aria-hidden="true" /><span
							class="visually-hidden">to</span
						>
						{e.to}{/if}
				</span>
				<span class="what">
					{#each text(e) as part, p (p)}{#if part.code}<code>{part.text}</code
							>{:else}{part.text}{/if}{/each}
				</span>
			</li>
		{/each}
	</ol>
{:else}
	<p class="empty">Nothing has happened yet.</p>
{/if}

<style>
	.timeline {
		display: grid;
		gap: 2px;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: var(--text-sm);
	}
	li {
		display: grid;
		grid-template-columns: 3.6rem 16px minmax(0, 1fr);
		grid-template-areas: 'time icon who' 'time icon what';
		column-gap: var(--space-2);
		padding: 6px var(--space-2);
		background: var(--surface);
		border-radius: var(--radius-sm);
	}
	.time {
		grid-area: time;
		color: var(--text-2);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
	}
	.icon {
		grid-area: icon;
		padding-top: 2px;
		color: var(--kind-behavior);
	}
	.signal .icon {
		color: var(--info);
	}
	.lost .icon,
	.note .icon {
		color: var(--warn);
	}
	.who {
		grid-area: who;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-weight: 600;
	}
	.what {
		grid-area: what;
		min-width: 0;
		color: var(--text-2);
		overflow-wrap: anywhere;
	}
	code {
		font-size: 0.92em;
	}
	.empty {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
</style>
