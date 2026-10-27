<script lang="ts">
	/**
	 * "Add to Home Screen", explained for the browser in hand: Safari's Share
	 * button on iPhone and iPad, the share menu of Chrome and Edge on iOS
	 * 16.4+, "open it in Safari" for other iOS browsers, the browser menu on
	 * Android, File → Add to Dock in Safari on a Mac, and Chromium's own
	 * install dialog where it offers one. The other devices' steps are one
	 * tap away, for someone reading this on a computer about their phone.
	 */
	import {
		Check,
		Copy,
		Ellipsis,
		EllipsisVertical,
		MonitorDown,
		Share,
		SquarePlus
	} from '@lucide/svelte';
	import Logo from '#lib/ui/Logo.svelte';
	import SheetDialog from '#lib/ui/SheetDialog.svelte';
	import type { InstallPlatform } from './install.ts';
	import { pwa } from './pwa.svelte.ts';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	const platform = $derived(pwa.platform);
	let copied = $state(false);

	/** Where Safari's Share button is: at the bottom on iPhone, at the top on iPad. */
	const appleDevice =
		typeof navigator !== 'undefined' &&
		(/iPad/.test(navigator.userAgent) ||
			(/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1))
			? 'iPad'
			: 'iPhone';

	const title = $derived(
		platform === 'mac-safari' || platform === 'mac-safari-old'
			? 'Add Tessera to your Dock'
			: platform === 'chromium' || platform === 'unsupported'
				? 'Install Tessera'
				: 'Add Tessera to your Home Screen'
	);

	/** The address to open in Safari: the projects page, where the installed app starts. */
	const link = $derived(
		typeof location === 'undefined' ? '' : new URL('projects', document.baseURI).href
	);

	async function copyLink() {
		try {
			await navigator.clipboard.writeText(link);
			copied = true;
			setTimeout(() => (copied = false), 2500);
		} catch {
			copied = false;
		}
	}

	async function install() {
		await pwa.install();
		open = false;
	}

	const OTHERS: { id: InstallPlatform; label: string }[] = [
		{ id: 'ios-safari', label: 'iPhone and iPad (Safari)' },
		{ id: 'ios-share', label: 'iPhone and iPad (Chrome or Edge)' },
		{ id: 'android', label: 'Android' },
		{ id: 'mac-safari', label: 'Mac (Safari)' },
		{ id: 'chromium', label: 'Computer (Chrome or Edge)' }
	];
</script>

{#snippet key(label: string)}<strong class="key">{label}</strong>{/snippet}

{#snippet steps(kind: InstallPlatform, device: string)}
	{#if kind === 'ios-safari'}
		<ol class="steps">
			<li>
				<span class="glyph" aria-hidden="true"><Share size={22} /></span>
				<span>
					Tap {@render key('Share')}
					{device === 'iPad' ? 'at the top of the screen' : 'in the bar at the bottom'}.
					<small
						>On iOS 26, tap <span class="inline-glyph"
							><Ellipsis size={14} aria-hidden="true" /></span
						>
						{@render key('More')} first, then {@render key('Share')}.</small
					>
				</span>
			</li>
			<li>
				<span class="glyph" aria-hidden="true"><SquarePlus size={22} /></span>
				<span
					>Scroll down and tap {@render key('Add to Home Screen')}.
					<small>Keep “Open as Web App” on if you see it.</small></span
				>
			</li>
			<li>
				<span class="glyph text" aria-hidden="true">Add</span>
				<span>Tap {@render key('Add')} at the top right.</span>
			</li>
		</ol>
	{:else if kind === 'ios-share'}
		<ol class="steps">
			<li>
				<span class="glyph" aria-hidden="true"><Share size={22} /></span>
				<span
					>Tap {@render key('Share')}: in Chrome it's in the address bar; in Edge, open the
					<span class="inline-glyph"><Ellipsis size={14} aria-hidden="true" /></span>
					menu first.</span
				>
			</li>
			<li>
				<span class="glyph" aria-hidden="true"><SquarePlus size={22} /></span>
				<span
					>Tap {@render key('Add to Home Screen')}.
					<small>Scroll down the list if you don't see it.</small></span
				>
			</li>
			<li>
				<span class="glyph text" aria-hidden="true">Add</span>
				<span>Tap {@render key('Add')}.</span>
			</li>
		</ol>
		<p class="note">Or open this page in Safari, which works the same way.</p>
	{:else if kind === 'ios-open-in-safari'}
		<p class="note">
			This browser can't add apps to the Home Screen. Open Tessera in <strong>Safari</strong> and add
			it from there.
		</p>
		<ol class="steps">
			<li>
				<span class="glyph" aria-hidden="true"><Copy size={20} /></span>
				<span class="copy">
					Copy the link:
					<button type="button" class="button small" onclick={copyLink}>
						{#if copied}<Check size={15} aria-hidden="true" /> Copied{:else}<Copy
								size={15}
								aria-hidden="true"
							/> Copy link{/if}
					</button>
					<code>{link}</code>
				</span>
			</li>
			<li>
				<span class="glyph text" aria-hidden="true">Safari</span>
				<span>Open {@render key('Safari')}, paste it in the address bar and go.</span>
			</li>
			<li>
				<span class="glyph" aria-hidden="true"><Share size={22} /></span>
				<span>Tap {@render key('Share')}, then {@render key('Add to Home Screen')}.</span>
			</li>
		</ol>
	{:else if kind === 'android'}
		<ol class="steps">
			<li>
				<span class="glyph" aria-hidden="true"><EllipsisVertical size={22} /></span>
				<span
					>Open the browser's menu.
					<small
						>Usually <strong>⋮</strong> at the top right, or <strong>≡</strong> at the bottom.</small
					></span
				>
			</li>
			<li>
				<span class="glyph" aria-hidden="true"><SquarePlus size={22} /></span>
				<span
					>Tap {@render key('Add to Home screen')} or {@render key('Install app')}.
					<small>In Samsung Internet: Add page to → Home screen.</small></span
				>
			</li>
			<li>
				<span class="glyph text" aria-hidden="true">Add</span>
				<span>Tap {@render key('Add')} or {@render key('Install')}.</span>
			</li>
		</ol>
	{:else if kind === 'mac-safari'}
		<ol class="steps">
			<li>
				<span class="glyph text" aria-hidden="true">File</span>
				<span
					>In the menu bar, choose {@render key('File')} → {@render key('Add to Dock')}.
					<small
						>Or click <span class="inline-glyph"><Share size={14} aria-hidden="true" /></span> Share in
						the toolbar, then Add to Dock.</small
					></span
				>
			</li>
			<li>
				<span class="glyph text" aria-hidden="true">Add</span>
				<span>Click {@render key('Add')}. Tessera opens in its own window from the Dock.</span>
			</li>
		</ol>
	{:else if kind === 'mac-safari-old'}
		<p class="note">
			Safari can add web apps to the Dock from macOS Sonoma on. Update macOS, or install Tessera
			from Chrome or Edge.
		</p>
	{:else if kind === 'chromium'}
		{#if pwa.canInstall && kind === platform}
			<p class="note">Your browser can install Tessera as an app, with its own window and icon.</p>
			<button type="button" class="primary" onclick={install}>
				<MonitorDown size={17} aria-hidden="true" /> Install Tessera
			</button>
		{:else}
			<ol class="steps">
				<li>
					<span class="glyph" aria-hidden="true"><MonitorDown size={20} /></span>
					<span
						>Click the install icon at the right of the address bar.
						<small
							>Or open the browser menu <strong>⋮</strong> and choose Install Tessera (in Chrome: Cast,
							save and share → Install page as app).</small
						></span
					>
				</li>
				<li>
					<span class="glyph text" aria-hidden="true">Install</span>
					<span>Click {@render key('Install')}.</span>
				</li>
			</ol>
		{/if}
	{:else}
		<p class="note">
			This browser can't install web apps. Chrome and Edge (on computers and Android) and Safari (on
			iPhone, iPad and Mac) can. Tessera works just as well here in the browser: keep a bookmark.
		</p>
	{/if}
{/snippet}

<SheetDialog bind:open {title} testid="install-guide">
	{#snippet icon()}<Logo size={40} variant="tile" />{/snippet}
	<div class="guide">
		{#if platform === 'installed'}
			<p class="note">You're using Tessera as an installed app already.</p>
		{:else}
			<p class="lede">
				Open Tessera like any app, straight into your projects. It works offline too, and your
				projects stay on this device.
			</p>
			{@render steps(platform, appleDevice)}
		{/if}
		<details class="others">
			<summary>On another device</summary>
			<div class="other-list">
				{#each OTHERS.filter((o) => o.id !== platform) as other (other.id)}
					<section>
						<h3>{other.label}</h3>
						{@render steps(other.id, 'iPhone')}
					</section>
				{/each}
			</div>
		</details>
	</div>
	{#snippet footer()}
		<button type="button" class="button" onclick={() => (open = false)}>Done</button>
	{/snippet}
</SheetDialog>

<style>
	.guide {
		display: grid;
		gap: var(--space-4);
	}
	.lede,
	.note {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.steps {
		display: grid;
		gap: var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
		counter-reset: step;
	}
	.steps li {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		font-size: var(--text-md);
	}
	.steps li > span:last-child {
		display: block;
		padding-top: 0.6rem;
	}
	.steps small {
		display: block;
		margin-top: 2px;
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.glyph {
		display: grid;
		flex: none;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface-2);
		color: var(--accent);
	}
	.glyph.text {
		color: var(--accent);
		font-size: var(--text-xs);
		font-weight: 700;
	}
	.inline-glyph {
		display: inline-flex;
		vertical-align: -2px;
	}
	.key {
		font-weight: 650;
	}
	.copy .button {
		margin: var(--space-1) 0;
	}
	.copy code {
		display: block;
		max-width: 100%;
		overflow-wrap: anywhere;
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}
	.others {
		border-top: 1px solid var(--border);
		padding-top: var(--space-3);
	}
	.others summary {
		display: flex;
		align-items: center;
		min-height: 2.75rem;
		color: var(--text-2);
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
	}
	.other-list {
		display: grid;
		gap: var(--space-4);
		padding-top: var(--space-2);
	}
	.other-list h3 {
		margin-bottom: var(--space-2);
		font-size: var(--text-md);
	}
	.button,
	.primary {
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
		cursor: pointer;
	}
	.button.small {
		min-height: 2.75rem;
		padding: 0 var(--space-3);
		font-size: var(--text-sm);
	}
	.primary {
		justify-self: start;
		border: 0;
		background: var(--accent);
		color: var(--accent-text);
	}
</style>
