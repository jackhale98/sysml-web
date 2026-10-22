<script lang="ts">
	/**
	 * Back from GitHub: finish signing in, then return to the page the person
	 * started from. Also where GitHub lands after someone chooses which
	 * repositories SysML Web may use.
	 */
	import { onMount } from 'svelte';
	import { goto, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { CircleAlert, LoaderCircle } from '@lucide/svelte';
	import { accounts } from '#lib/git/account.svelte.ts';
	import { messageOf } from '#lib/git/errors.ts';
	import GitHubMark from '#lib/git/GitHubMark.svelte';
	import {
		completeSignIn,
		pendingSignIn,
		safeReturn,
		setResume,
		startSignIn,
		takeInstall,
		type Resume
	} from '#lib/git/oauth.ts';
	import { basePath, redirectUri, SIGN_IN } from '#lib/git/signin-config.ts';
	import Logo from '#lib/ui/Logo.svelte';

	const projects = resolve('/projects');
	let error = $state<string | null>(null);
	let back = $state<string>(projects);
	let backResume = $state<Resume | undefined>();
	let status = $state('Signing you in to GitHub…');

	const toPage = (path: string | null | undefined) => safeReturn(path, basePath(), projects);

	async function leave(path: string, resume?: Resume) {
		setResume(resume);
		try {
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- a page on this site, checked by safeReturn
			await goto(path, { replaceState: true });
		} catch {
			location.replace(path);
		}
	}

	async function signInAgain(returnTo: string, resume?: Resume) {
		if (!SIGN_IN) return;
		status = 'Taking you to GitHub…';
		error = null;
		location.replace(await startSignIn(SIGN_IN, { redirectUri: redirectUri(), returnTo, resume }));
	}

	async function finish() {
		const params = new URLSearchParams(location.search);
		// Keep the one-time code out of the address bar and history.
		try {
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- this page, without its query
			replaceState(location.pathname, {});
		} catch {
			// The router isn't ready: the code stays until the next page replaces it.
		}
		accounts.init();
		if (!SIGN_IN) throw new Error('Signing in with GitHub isn’t set up on this site.');

		// Back from choosing repositories on GitHub: GitHub adds its own code, but
		// not our state, so it isn't used; signing in again (if needed) is instant.
		if (params.has('setup_action') && !params.has('state')) {
			const install = takeInstall();
			const returnTo = toPage(install?.returnTo);
			const resume = install?.resume ?? 'open-repository';
			back = returnTo;
			backResume = resume;
			if (accounts.connected) return leave(returnTo, resume);
			return signInAgain(returnTo, resume);
		}

		const pending = pendingSignIn();
		back = toPage(pending?.returnTo);
		backResume = pending?.resume;
		const done = await completeSignIn(params, SIGN_IN);
		status = 'Signed in. Taking you back…';
		await accounts.signInWith(done.tokens);
		await leave(toPage(done.returnTo), done.resume);
	}

	onMount(() => {
		finish().catch((e: unknown) => (error = messageOf(e)));
	});
</script>

<svelte:head>
	<title>Signing in · SysML Web</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="callback">
	<div class="card">
		<div class="marks" aria-hidden="true">
			<Logo size={36} />
			<span class="github"><GitHubMark size={20} /></span>
		</div>
		{#if error}
			<h1>Couldn’t sign you in</h1>
			<p class="error" role="alert">
				<CircleAlert size={16} aria-hidden="true" />
				<span>{error}</span>
			</p>
			<div class="actions">
				{#if SIGN_IN}
					<button
						type="button"
						class="dark"
						onclick={() =>
							signInAgain(back, backResume).catch((e: unknown) => (error = messageOf(e)))}
					>
						<GitHubMark size={16} /> Try again
					</button>
				{/if}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- a page on this site, checked by safeReturn -->
				<a class="button" href={back}>Back to SysML Web</a>
			</div>
		{:else}
			<h1 class="visually-hidden">Signing in</h1>
			<p class="status" role="status">
				<LoaderCircle size={18} class="spin" aria-hidden="true" />
				{status}
			</p>
		{/if}
	</div>
</main>

<style>
	.callback {
		display: grid;
		place-items: center;
		min-height: 100dvh;
		padding: max(var(--space-4), env(safe-area-inset-top)) var(--space-4)
			max(var(--space-4), env(safe-area-inset-bottom));
		background: var(--bg);
	}
	.card {
		display: grid;
		justify-items: center;
		gap: var(--space-4);
		width: min(26rem, 100%);
		padding: var(--space-6) var(--space-5);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--surface);
		box-shadow: var(--shadow-sm);
		text-align: center;
	}
	.marks {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.github {
		display: grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: var(--radius-md);
		background: var(--text);
		color: var(--surface);
	}
	h1 {
		font-size: var(--text-xl);
	}
	.status {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--text-2);
	}
	.status :global(.spin) {
		animation: spin 900ms linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.status :global(.spin) {
			animation: none;
		}
	}
	.error {
		display: flex;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--danger-weak);
		color: var(--text);
		font-size: var(--text-sm);
		text-align: left;
	}
	.error :global(svg) {
		flex: none;
		margin-top: 2px;
		color: var(--danger);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-2);
	}
	.dark,
	.button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		min-height: 2.75rem;
		padding: 0 var(--space-4);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font-weight: 600;
		text-decoration: none;
		cursor: pointer;
	}
	.dark {
		border: 0;
		background: var(--text);
		color: var(--surface);
	}
	.dark:hover {
		opacity: 0.9;
	}
	.button:hover {
		border-color: var(--accent);
		text-decoration: none;
	}
</style>
