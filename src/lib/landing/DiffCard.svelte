<!--
	A commit as it appears in review: a port drawn on the diagram becomes one added line of SysML.
-->
<script lang="ts">
	import { GitBranch, GitCommitHorizontal, MousePointerClick } from '@lucide/svelte';

	const lines: { sign: ' ' | '+'; n: number; text: string }[] = [
		{ sign: ' ', n: 1, text: 'part def Drone {' },
		{ sign: ' ', n: 2, text: '    doc /* Delivers parcels. */' },
		{ sign: ' ', n: 3, text: '    part rotors : Rotor[4];' },
		{ sign: ' ', n: 4, text: '    part battery : Battery;' },
		{ sign: '+', n: 5, text: '    port power : ~PowerPort;' },
		{ sign: ' ', n: 6, text: '}' }
	];
</script>

<figure class="diff">
	<figcaption>
		<span class="commit"><GitCommitHorizontal size={16} /> Add power port to Drone</span>
		<span class="meta"><GitBranch size={13} /> main · 3f9c1e7</span>
	</figcaption>
	<div class="file">
		<span>system/Drone.sysml</span>
		<span class="stat"><span class="plus">+1</span> <span class="minus">−0</span></span>
	</div>
	<div class="body">
		{#each lines as line (line.n)}
			<div class="row" class:add={line.sign === '+'}>
				<span class="n" aria-hidden="true">{line.n}</span><span class="sign">{line.sign}</span><span
					class="src">{line.text}</span
				>
			</div>
		{/each}
	</div>
	<p class="note">
		<MousePointerClick size={15} />
		Drawn on the diagram, saved as one readable line — formatting and comments untouched.
	</p>
</figure>

<style>
	.diff {
		margin: 0;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		overflow: hidden;
	}
	figcaption {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--border);
	}
	.commit {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-weight: 600;
	}
	.meta {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	.file {
		display: flex;
		justify-content: space-between;
		padding: 0.4rem var(--space-4);
		background: var(--surface-2);
		border-bottom: 1px solid var(--border);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--text-2);
	}
	.plus {
		color: var(--ok);
		font-weight: 600;
	}
	.minus {
		color: var(--danger);
		font-weight: 600;
	}
	.body {
		padding: var(--space-2) 0;
		font-family: var(--font-mono);
		font-size: 12.5px;
		line-height: 1.85;
	}
	.row {
		display: flex;
		white-space: pre;
		color: var(--text-2);
	}
	.n {
		flex: none;
		width: 2.5rem;
		padding-right: 0.75rem;
		text-align: right;
		color: var(--text-3);
	}
	.sign {
		flex: none;
		width: 1.25rem;
	}
	.src {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.add {
		background: var(--ok-weak);
		color: var(--text);
		box-shadow: inset 3px 0 0 var(--ok);
	}
	.add .sign,
	.add .n {
		color: var(--ok);
		font-weight: 700;
	}
	.note {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		border-top: 1px solid var(--border);
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.note :global(svg) {
		flex: none;
		margin-top: 0.15rem;
		color: var(--accent);
	}
</style>
