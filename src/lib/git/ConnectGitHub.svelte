<script lang="ts">
	/**
	 * Connect a GitHub account with a fine-grained access token, explained
	 * step by step for people who have never made one.
	 */
	import { ExternalLink, Eye, EyeOff, LoaderCircle, Lock } from '@lucide/svelte';
	import { accounts } from './account.svelte.ts';
	import { messageOf } from './errors.ts';
	import { tokenUrl } from './github.ts';
	import type { GitUser } from './types.ts';

	let { onconnected }: { onconnected?: (user: GitUser) => void } = $props();

	const uid = $props.id();
	let token = $state('');
	let reveal = $state(false);
	let busy = $state(false);
	let error = $state<string | null>(null);

	async function connect(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		error = null;
		try {
			const user = await accounts.connect(token);
			token = '';
			onconnected?.(user);
		} catch (e) {
			error = messageOf(e);
		} finally {
			busy = false;
		}
	}
</script>

<form class="connect" onsubmit={connect}>
	<p class="intro">
		SysML Web works with GitHub straight from your browser. To let it open and save your models,
		give it an <strong>access token</strong>: a password just for this app, limited to the
		repositories you choose.
	</p>
	<ol class="steps">
		<li>
			<span class="n" aria-hidden="true">1</span>
			<div>
				<strong>Create a token on GitHub</strong>
				<p>
					The permissions are filled in for you: <em>Contents</em> and <em>Pull requests</em>, read
					and write. Under <em>Repository access</em>, choose <em>Only select repositories</em> and pick
					the ones with your models.
				</p>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external link -->
				<a class="button" href={tokenUrl()} target="_blank" rel="noopener noreferrer">
					Create a token on GitHub <ExternalLink size={14} aria-hidden="true" />
					<span class="visually-hidden">(opens in a new tab)</span>
				</a>
			</div>
		</li>
		<li>
			<span class="n" aria-hidden="true">2</span>
			<div>
				<label for="{uid}-token"><strong>Paste the token here</strong></label>
				<div class="field">
					<input
						id="{uid}-token"
						type={reveal ? 'text' : 'password'}
						bind:value={token}
						placeholder="github_pat_…"
						autocomplete="off"
						spellcheck="false"
						aria-describedby="{uid}-privacy"
						aria-invalid={error ? 'true' : undefined}
					/>
					<button
						type="button"
						class="reveal"
						aria-label={reveal ? 'Hide token' : 'Show token'}
						aria-pressed={reveal}
						onclick={() => (reveal = !reveal)}
					>
						{#if reveal}<EyeOff size={16} />{:else}<Eye size={16} />{/if}
					</button>
				</div>
			</div>
		</li>
	</ol>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	<button type="submit" class="primary" disabled={busy || !token.trim()}>
		{#if busy}<LoaderCircle size={16} class="spin" aria-hidden="true" /> Checking…{:else}Connect
			GitHub{/if}
	</button>
	<p class="privacy" id="{uid}-privacy">
		<Lock size={13} aria-hidden="true" />
		<span>
			The token stays in this browser and is only ever sent to <code>api.github.com</code>. Sign out
			any time in Settings → Accounts.
		</span>
	</p>
</form>

<style>
	.connect {
		display: grid;
		gap: var(--space-4);
	}
	.intro {
		color: var(--text-2);
	}
	.steps {
		display: grid;
		gap: var(--space-4);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.steps li {
		display: grid;
		grid-template-columns: 1.75rem 1fr;
		gap: var(--space-3);
	}
	.steps li > div {
		display: grid;
		gap: var(--space-2);
		justify-items: start;
		min-width: 0;
	}
	.steps p {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.n {
		display: grid;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 50%;
		background: var(--accent-weak);
		color: var(--accent);
		font-size: var(--text-sm);
		font-weight: 700;
	}
	.field {
		position: relative;
		width: 100%;
	}
	input {
		width: 100%;
		height: 2.5rem;
		padding: 0 2.75rem 0 var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
	}
	.reveal {
		position: absolute;
		top: 0;
		right: 0;
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		border: 0;
		background: transparent;
		color: var(--text-2);
		cursor: pointer;
	}
	.button,
	.primary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		min-height: 2.5rem;
		padding: 0 var(--space-4);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font-weight: 600;
		text-decoration: none;
		cursor: pointer;
	}
	.button:hover {
		border-color: var(--accent);
		text-decoration: none;
	}
	.primary {
		justify-self: start;
		border: 0;
		background: var(--accent);
		color: var(--accent-text);
	}
	.primary:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.primary :global(.spin) {
		animation: spin 900ms linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.error {
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--danger-weak);
		color: var(--text);
		font-size: var(--text-sm);
	}
	.privacy {
		display: flex;
		gap: var(--space-2);
		color: var(--text-3);
		font-size: var(--text-xs);
	}
	.privacy :global(svg) {
		flex: none;
		margin-top: 2px;
	}
</style>
