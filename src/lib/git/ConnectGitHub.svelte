<script lang="ts">
	/**
	 * Connect a GitHub account. When this build has sign-in set up, "Sign in
	 * with GitHub" comes first (a round trip to GitHub, then back to this
	 * page, which reopens what the person was doing). Making a fine-grained
	 * access token, explained step by step for people who have never made
	 * one, is always available: as the quieter fallback, or on its own when
	 * sign-in isn't set up. With a GitHub Enterprise Server set in Settings
	 * (`githubServer`), only the token: it is made on, and sent only to, that
	 * server ("Sign in with GitHub" is github.com's).
	 */
	import { ChevronRight, ExternalLink, Eye, EyeOff, LoaderCircle, Lock } from '@lucide/svelte';
	import { pwa } from '#lib/offline/pwa.svelte.ts';
	import { settings } from '#lib/settings/settings.svelte.ts';
	import { accounts } from './account.svelte.ts';
	import { messageOf } from './errors.ts';
	import GitHubMark from './GitHubMark.svelte';
	import { GITHUB_API, githubApi, tokenUrl } from './github.ts';
	import type { Resume } from './oauth.ts';
	import { SIGN_IN, signInWithGitHub } from './signin.ts';
	import type { GitUser } from './types.ts';

	let {
		onconnected,
		resume,
		another = false
	}: {
		onconnected?: (user: GitUser) => void;
		/** What to reopen after coming back from signing in on GitHub. */
		resume?: Resume;
		/** Adding a second (or later) account: say how GitHub picks the account. */
		another?: boolean;
	} = $props();

	const uid = $props.id();
	let token = $state('');
	let reveal = $state(false);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let leaving = $state(false);
	let signInError = $state<string | null>(null);

	/** The API the token is for: github.com's, or the Enterprise server's from Settings. */
	const server = $derived.by(() => {
		try {
			return { api: githubApi(settings.githubServer), error: null };
		} catch (e) {
			return { api: GITHUB_API, error: messageOf(e) };
		}
	});
	const enterprise = $derived(server.api !== GITHUB_API);
	const apiHost = $derived(new URL(server.api).host);

	async function connect(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		error = null;
		try {
			if (server.error) throw new Error(`The GitHub server in Settings: ${server.error}`);
			const user = await accounts.connect(token, server.api);
			token = '';
			onconnected?.(user);
		} catch (e) {
			error = messageOf(e);
		} finally {
			busy = false;
		}
	}

	async function signIn() {
		leaving = true;
		signInError = null;
		try {
			if (await signInWithGitHub(resume, { another }))
				// On the way to GitHub; if the browser stays (it was stopped), allow another try.
				setTimeout(() => (leaving = false), 5000);
			else leaving = false;
		} catch (e) {
			signInError = messageOf(e);
			leaving = false;
		}
	}
</script>

{#snippet tokenForm(fallback: boolean)}
	<form class="connect" class:fallback onsubmit={connect}>
		{#if fallback}
			<p class="intro">
				Rather not sign in? Give Tessera an <strong>access token</strong> instead: a password just for
				this app, limited to the repositories you choose.
			</p>
		{:else}
			<p class="intro">
				Tessera works with GitHub straight from your browser. To let it open and save your models,
				give it an <strong>access token</strong>: a password just for this app, limited to the
				repositories you choose.
			</p>
		{/if}
		<ol class="steps">
			<li>
				<span class="n" aria-hidden="true">1</span>
				<div>
					<strong>Create a token on {enterprise ? apiHost : 'GitHub'}</strong>
					<p>
						The permissions are filled in for you: <em>Contents</em> and <em>Pull requests</em>,
						read and write. Under <em>Repository access</em>, choose
						<em>Only select repositories</em> and pick the ones with your models.
					</p>
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external link -->
					<a class="button" href={tokenUrl(server.api)} target="_blank" rel="noopener noreferrer">
						Create a token on {enterprise ? apiHost : 'GitHub'}
						<ExternalLink size={14} aria-hidden="true" />
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
		{#if !pwa.online && !fallback}<p class="offline" role="status">
				You're offline. Connect GitHub once you're back online.
			</p>{/if}
		<button
			type="submit"
			class={fallback ? 'button' : 'primary'}
			disabled={busy || !token.trim() || !pwa.online}
		>
			{#if busy}<LoaderCircle size={16} class="spin" aria-hidden="true" /> Checking…{:else}Connect
				GitHub{/if}
		</button>
		<p class="privacy" id="{uid}-privacy">
			<Lock size={13} aria-hidden="true" />
			<span>
				The token stays in this browser and is only ever sent to <code>{apiHost}</code>. Sign out
				any time in Settings → Accounts.
			</span>
		</p>
	</form>
{/snippet}

{#snippet anotherNote()}
	<p class="another" id="{uid}-another">
		GitHub signs in whichever account is signed in on github.com in this browser. To add a different
		account, <strong>sign out of GitHub in the browser first</strong> (or switch accounts there), or
		use an <strong>access token</strong> made for the other account.
	</p>
{/snippet}

{#if SIGN_IN && !enterprise}
	<div class="connect">
		{#if another}
			{@render anotherNote()}
		{:else}
			<p class="intro">
				Sign in with GitHub to open your models and save them back. You choose which repositories
				Tessera can use.
			</p>
		{/if}
		<button
			type="button"
			class="signin"
			onclick={signIn}
			disabled={leaving || !pwa.online}
			aria-describedby="{uid}-how"
		>
			{#if leaving}
				<LoaderCircle size={18} class="spin" aria-hidden="true" /> Opening GitHub…
			{:else}
				<GitHubMark size={18} /> Sign in with GitHub
			{/if}
		</button>
		{#if signInError}<p class="error" role="alert">{signInError}</p>{/if}
		{#if !pwa.online}<p class="offline" role="status">
				You're offline. Sign in once you're back online.
			</p>{/if}
		<p class="privacy" id="{uid}-how">
			<Lock size={13} aria-hidden="true" />
			<span>
				You'll confirm on GitHub, then come straight back here. Your sign-in is kept only in this
				browser; sign out any time in Settings → Accounts.
			</span>
		</p>
		<details class="other">
			<summary><ChevronRight size={15} aria-hidden="true" /> Use an access token instead</summary>
			{@render tokenForm(true)}
		</details>
	</div>
{:else}
	{#if another}<p class="another">
			Signed in to GitHub as someone else? Make the token while signed in to the other account.
		</p>{/if}
	{@render tokenForm(false)}
{/if}

<style>
	.connect {
		display: grid;
		gap: var(--space-4);
	}
	.connect.fallback {
		gap: var(--space-3);
		padding-top: var(--space-3);
	}
	.signin {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		justify-self: start;
		min-height: 2.75rem;
		padding: 0 var(--space-5);
		border: 0;
		border-radius: var(--radius-sm);
		background: var(--text);
		color: var(--surface);
		font-weight: 600;
		cursor: pointer;
	}
	.signin:hover:not(:disabled) {
		opacity: 0.9;
	}
	.signin:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.signin :global(.spin) {
		animation: spin 900ms linear infinite;
	}
	.other {
		border-top: 1px solid var(--border);
		padding-top: var(--space-3);
	}
	.other summary {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		min-height: 2.25rem;
		color: var(--text-2);
		font-size: var(--text-sm);
		font-weight: 600;
		list-style: none;
		cursor: pointer;
	}
	.other summary::-webkit-details-marker {
		display: none;
	}
	.other summary:hover {
		color: var(--text);
	}
	.other summary :global(svg) {
		transition: transform var(--duration) var(--ease);
	}
	.other[open] summary :global(svg) {
		transform: rotate(90deg);
	}
	.intro {
		color: var(--text-2);
	}
	.another {
		padding: var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--info-weak);
		color: var(--text);
		font-size: var(--text-sm);
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
	.button:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.connect.fallback > .button {
		justify-self: start;
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
	@media (prefers-reduced-motion: reduce) {
		.other summary :global(svg) {
			transition: none;
		}
	}
	.error,
	.offline {
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--danger-weak);
		color: var(--text);
		font-size: var(--text-sm);
	}
	.offline {
		background: var(--warn-weak);
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
