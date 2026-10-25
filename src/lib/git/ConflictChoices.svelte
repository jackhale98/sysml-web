<script lang="ts">
	/**
	 * Files changed on both sides, one choice each: combine both (when the
	 * changes touch different lines), keep mine, or take theirs, with the
	 * differences a click away. Used by "Get latest" (theirs: GitHub's) and
	 * "Save to folder" (theirs: the folder's).
	 */
	import DiffView from './DiffView.svelte';
	import type { Conflict, Resolution } from './sync.ts';

	let {
		conflicts,
		choices = $bindable(),
		where
	}: {
		conflicts: Conflict[];
		choices: Record<string, Resolution>;
		/** The other side, in words. */
		where: {
			/** "Take GitHub's" */
			take: string;
			/** "deleted on GitHub" */
			deleted: string;
			/** "GitHub's", heading the other side of the differences */
			theirs: string;
			/** "only on GitHub" */
			only: string;
		};
	} = $props();

	const uid = $props.id();
	const parts = (path: string) => {
		const i = path.lastIndexOf('/');
		return { dir: i < 0 ? '' : path.slice(0, i + 1), name: path.slice(i + 1) };
	};
</script>

<ul class="conflict-list">
	{#each conflicts as conflict (conflict.path)}
		{@const p = parts(conflict.path)}
		<li>
			<fieldset>
				<legend><span class="dir">{p.dir}</span><strong>{p.name}</strong></legend>
				<div class="choices">
					{#if conflict.merged !== null}
						<label class="choice">
							<input
								type="radio"
								name="{uid}-{conflict.path}"
								value="merged"
								bind:group={choices[conflict.path]}
							/>
							<span><strong>Combine both</strong><small>changes touch different lines</small></span>
						</label>
					{/if}
					<label class="choice">
						<input
							type="radio"
							name="{uid}-{conflict.path}"
							value="mine"
							bind:group={choices[conflict.path]}
						/>
						<span
							><strong>Keep mine</strong><small
								>{conflict.mine === null ? 'deleted here' : 'your version'}</small
							></span
						>
					</label>
					<label class="choice">
						<input
							type="radio"
							name="{uid}-{conflict.path}"
							value="theirs"
							bind:group={choices[conflict.path]}
						/>
						<span
							><strong>{where.take}</strong><small
								>{conflict.theirs === null ? where.deleted : 'the newer version there'}</small
							></span
						>
					</label>
				</div>
				<details>
					<summary>Show the differences</summary>
					<DiffView
						before={conflict.theirs}
						after={conflict.mine}
						oldLabel={where.theirs}
						newLabel="Yours"
					/>
					<p class="legend">
						<span class="del-key">−</span>
						{where.only} ·
						<span class="add-key">+</span> only yours
					</p>
				</details>
			</fieldset>
		</li>
	{/each}
</ul>

<style>
	.conflict-list {
		display: grid;
		gap: var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	fieldset {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface);
	}
	legend {
		float: left;
		width: 100%;
		margin-bottom: var(--space-1);
		font-size: var(--text-sm);
	}
	.dir {
		color: var(--text-3);
		font-weight: 400;
	}
	.choices {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr));
		gap: var(--space-2);
	}
	.choice {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-2);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}
	.choice:has(input:checked) {
		border-color: var(--accent);
		background: var(--accent-weak);
	}
	.choice input {
		width: auto;
		height: auto;
		margin-top: 3px;
		accent-color: var(--accent);
	}
	.choice span {
		display: grid;
		font-size: var(--text-sm);
	}
	summary {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: 2rem;
		padding: 0;
		border-radius: var(--radius-lg);
		color: var(--accent);
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
		list-style: none;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	summary + :global(.diff) {
		margin-top: var(--space-2);
	}
	.legend {
		margin-top: 4px;
		color: var(--text-3);
		font-size: var(--text-xs);
	}
	.add-key {
		color: var(--ok);
		font-weight: 700;
	}
	.del-key {
		color: var(--danger);
		font-weight: 700;
	}
</style>
