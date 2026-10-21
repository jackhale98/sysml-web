<script module lang="ts">
	export type SettingsSection = 'appearance' | 'editor' | 'projects' | 'accounts' | 'about';
</script>

<script lang="ts">
	/**
	 * Settings: appearance, editor, where projects are kept, accounts and
	 * about. A native modal dialog; a full-screen sheet on phones.
	 */
	import {
		Check,
		ExternalLink,
		HardDrive,
		Info,
		KeyRound,
		LogOut,
		Monitor,
		Moon,
		Palette,
		ShieldCheck,
		Sun,
		Trash2,
		Type,
		X
	} from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import type { Engine } from '#lib/engine/client.ts';
	import type { LibraryLicense } from '#lib/engine/types.ts';
	import { accounts } from '#lib/git/account.svelte.ts';
	import ConnectGitHub from '#lib/git/ConnectGitHub.svelte';
	import GitHubMark from '#lib/git/GitHubMark.svelte';
	import {
		deleteAllData,
		isStoragePersisted,
		listProjects,
		persistStorage,
		storageEstimate,
		type ProjectSummary
	} from '#lib/project/store.ts';
	import Logo from '#lib/ui/Logo.svelte';
	import { theme, type ThemeChoice } from '#lib/ui/theme.svelte.ts';
	import { version } from '#lib/version.ts';
	import engineInfo from '../../../engine.json';
	import { FONT_SIZES, settings } from './settings.svelte.ts';

	let {
		open = $bindable(false),
		section = $bindable<SettingsSection>('appearance'),
		engine
	}: { open?: boolean; section?: SettingsSection; engine?: Engine } = $props();

	const uid = $props.id();
	let dialog = $state<HTMLDialogElement>();
	let tabs = $state<HTMLDivElement>();

	const SECTIONS: { id: SettingsSection; label: string; icon: typeof Palette }[] = [
		{ id: 'appearance', label: 'Appearance', icon: Palette },
		{ id: 'editor', label: 'Editor', icon: Type },
		{ id: 'projects', label: 'Projects & storage', icon: HardDrive },
		{ id: 'accounts', label: 'Accounts', icon: KeyRound },
		{ id: 'about', label: 'About', icon: Info }
	];

	$effect(() => {
		settings.init();
		accounts.init();
	});

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		else if (!open && dialog.open) dialog.close();
	});

	// Arrow keys move between sections (WAI-ARIA tabs, vertical on wide screens).
	function ontabkey(event: KeyboardEvent) {
		const keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'];
		if (!keys.includes(event.key)) return;
		event.preventDefault();
		const i = SECTIONS.findIndex((s) => s.id === section);
		const n = SECTIONS.length;
		const next =
			event.key === 'Home'
				? 0
				: event.key === 'End'
					? n - 1
					: event.key === 'ArrowDown' || event.key === 'ArrowRight'
						? (i + 1) % n
						: (i - 1 + n) % n;
		section = SECTIONS[next]!.id;
		tabs?.querySelector<HTMLElement>(`#${CSS.escape(`${uid}-tab-${section}`)}`)?.focus();
	}

	function onbackdrop(event: MouseEvent) {
		if (event.target === dialog) open = false;
	}

	// --- Appearance ---------------------------------------------------------
	const THEMES: { id: ThemeChoice; label: string; icon: typeof Sun }[] = [
		{ id: 'system', label: 'Match system', icon: Monitor },
		{ id: 'light', label: 'Light', icon: Sun },
		{ id: 'dark', label: 'Dark', icon: Moon }
	];

	// --- Projects & storage --------------------------------------------------
	let projects = $state.raw<ProjectSummary[] | null>(null);
	let estimate = $state.raw<{ usage: number; quota: number } | null>(null);
	let persisted = $state<boolean | null>(null);
	let confirmWipe = $state(false);
	let wipeError = $state<string | null>(null);

	$effect(() => {
		if (open && section === 'projects') void loadStorage();
	});

	async function loadStorage() {
		[projects, estimate, persisted] = await Promise.all([
			listProjects().catch(() => []),
			storageEstimate(),
			isStoragePersisted()
		]);
	}

	async function persist() {
		persisted = await persistStorage();
	}

	async function wipe() {
		wipeError = null;
		try {
			accounts.signOut();
			await deleteAllData();
			location.assign(resolve('/'));
		} catch (e) {
			wipeError = e instanceof Error ? e.message : String(e);
		}
	}

	const counts = $derived.by(() => {
		const list = projects ?? [];
		return {
			total: list.length,
			git: list.filter((p) => p.git).length,
			folder: list.filter((p) => p.origin === 'folder').length
		};
	});

	function bytes(n: number): string {
		if (n < 1024) return `${n} B`;
		if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
		if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
		return `${(n / 1024 ** 3).toFixed(1)} GB`;
	}

	// --- About --------------------------------------------------------------
	let engineVersion = $state<string | null>(null);
	let license = $state.raw<LibraryLicense | null>(null);
	let showNotice = $state(false);

	async function getEngine(): Promise<Engine> {
		return engine ?? (await import('#lib/engine/instance.ts')).getEngine();
	}

	$effect(() => {
		if (open && section === 'about' && engineVersion === null)
			void getEngine()
				.then((e) => e.version())
				.then((v) => (engineVersion = v))
				.catch(() => (engineVersion = 'unavailable'));
	});

	async function toggleNotice() {
		showNotice = !showNotice;
		if (showNotice && !license) license = await (await getEngine()).libraryLicense();
	}
</script>

<!-- A backdrop click closes it; so does Escape. -->
<dialog
	bind:this={dialog}
	class="settings"
	aria-labelledby="{uid}-title"
	onclose={() => (open = false)}
	onclick={onbackdrop}
>
	{#if open}
		<header class="head">
			<h2 id="{uid}-title">Settings</h2>
			<button type="button" class="icon" aria-label="Close settings" onclick={() => (open = false)}>
				<X size={18} />
			</button>
		</header>
		<div class="layout">
			<div
				class="tabs"
				role="tablist"
				aria-label="Settings sections"
				aria-orientation="vertical"
				bind:this={tabs}
			>
				{#each SECTIONS as s (s.id)}
					<button
						type="button"
						role="tab"
						id="{uid}-tab-{s.id}"
						aria-selected={section === s.id}
						aria-controls="{uid}-panel"
						tabindex={section === s.id ? 0 : -1}
						onclick={() => (section = s.id)}
						onkeydown={ontabkey}
					>
						<s.icon size={16} aria-hidden="true" />
						<span>{s.label}</span>
					</button>
				{/each}
			</div>

			<div
				class="panel"
				role="tabpanel"
				id="{uid}-panel"
				aria-labelledby="{uid}-tab-{section}"
				tabindex="-1"
			>
				{#if section === 'appearance'}
					<fieldset>
						<legend>Theme</legend>
						<div class="tiles">
							{#each THEMES as t (t.id)}
								<label class="tile">
									<input
										type="radio"
										name="{uid}-theme"
										value={t.id}
										checked={theme.choice === t.id}
										onchange={() => theme.set(t.id)}
									/>
									<span class="preview {t.id}" aria-hidden="true">
										<span class="bar"></span><span class="line"></span><span class="line short"
										></span>
									</span>
									<span class="tile-label"><t.icon size={14} aria-hidden="true" /> {t.label}</span>
								</label>
							{/each}
						</div>
					</fieldset>

					<fieldset>
						<legend>Density</legend>
						<p class="help">How much fits on screen.</p>
						<div class="segmented">
							<label>
								<input
									type="radio"
									name="{uid}-density"
									value="comfortable"
									bind:group={settings.density}
								/>
								<span>Comfortable</span>
							</label>
							<label>
								<input
									type="radio"
									name="{uid}-density"
									value="compact"
									bind:group={settings.density}
								/>
								<span>Compact</span>
							</label>
						</div>
					</fieldset>

					<fieldset>
						<legend>Motion</legend>
						<p class="help">Animations when panels open and diagrams move.</p>
						<div class="segmented">
							<label>
								<input
									type="radio"
									name="{uid}-motion"
									value="system"
									bind:group={settings.motion}
								/>
								<span>Match system</span>
							</label>
							<label>
								<input
									type="radio"
									name="{uid}-motion"
									value="reduce"
									bind:group={settings.motion}
								/>
								<span>Reduce</span>
							</label>
							<label>
								<input
									type="radio"
									name="{uid}-motion"
									value="allow"
									bind:group={settings.motion}
								/>
								<span>Full</span>
							</label>
						</div>
					</fieldset>
				{:else if section === 'editor'}
					<div class="field">
						<label for="{uid}-font">Text size</label>
						<div class="range">
							<input
								id="{uid}-font"
								type="range"
								min={FONT_SIZES.min}
								max={FONT_SIZES.max}
								step="1"
								bind:value={settings.editorFontSize}
								aria-valuetext="{settings.editorFontSize} pixels"
							/>
							<output for="{uid}-font">{settings.editorFontSize}px</output>
						</div>
						<pre
							class="sample"
							style:font-size="{settings.editorFontSize}px"
							aria-hidden="true"><span class="k">part def</span> <span class="d">Drone</span> {'{'}
    <span class="k">attribute</span> mass : <span class="t">MassValue</span>;
{'}'}</pre>
					</div>

					<label class="switch">
						<span>
							<strong>Wrap long lines</strong>
							<small>Long lines continue on the next line instead of scrolling sideways.</small>
						</span>
						<input type="checkbox" role="switch" bind:checked={settings.lineWrapping} />
					</label>
					<label class="switch">
						<span>
							<strong>Line numbers</strong>
							<small>Show the number of each line beside the text.</small>
						</span>
						<input type="checkbox" role="switch" bind:checked={settings.lineNumbers} />
					</label>

					<fieldset>
						<legend>On phones, open a file as</legend>
						<p class="help">Phones show one at a time; switch any time above the editor.</p>
						<div class="segmented">
							<label>
								<input
									type="radio"
									name="{uid}-phone"
									value="diagram"
									bind:group={settings.phoneStart}
								/>
								<span>Diagram</span>
							</label>
							<label>
								<input
									type="radio"
									name="{uid}-phone"
									value="text"
									bind:group={settings.phoneStart}
								/>
								<span>Text</span>
							</label>
						</div>
					</fieldset>
				{:else if section === 'projects'}
					<section class="block">
						<h3>Where your projects are kept</h3>
						<p>
							In <strong>this browser, on this device</strong>. Every change is saved here as you
							work; nothing is uploaded to a SysML Web server (there isn't one).
						</p>
						<ul class="facts">
							<li>
								<GitHubMark size={15} />
								<span>
									Projects connected to <strong>GitHub</strong> are also saved to their repository
									when you choose <em>Save to GitHub</em>.
								</span>
							</li>
							<li>
								<HardDrive size={15} aria-hidden="true" />
								<span>
									Projects opened from a <strong>folder</strong> are saved back to it when you
									choose
									<em>Save to folder</em>.
								</span>
							</li>
						</ul>
						{#if projects}
							<p class="muted">
								{counts.total}
								{counts.total === 1 ? 'project' : 'projects'} here{#if counts.git || counts.folder}
									({[
										counts.git && `${counts.git} on GitHub`,
										counts.folder && `${counts.folder} from folders`
									]
										.filter(Boolean)
										.join(', ')}){/if}.
							</p>
						{/if}
					</section>

					<section class="block">
						<h3>Storage</h3>
						{#if estimate}
							{@const share = estimate.quota
								? Math.max(0.5, (estimate.usage / estimate.quota) * 100)
								: 0}
							<div
								class="meter"
								role="meter"
								aria-label="Storage used"
								aria-valuemin={0}
								aria-valuemax={estimate.quota}
								aria-valuenow={estimate.usage}
								aria-valuetext="{bytes(estimate.usage)} of {bytes(estimate.quota)}"
							>
								<span style:width="{Math.min(100, share)}%"></span>
							</div>
							<p class="muted">
								Using <strong>{bytes(estimate.usage)}</strong> of about {bytes(estimate.quota)} this browser
								allows.
							</p>
						{:else}
							<p class="muted">This browser doesn't say how much space is used.</p>
						{/if}
						<div class="persist">
							{#if persisted}
								<ShieldCheck size={18} aria-hidden="true" class="ok-icon" />
								<p>
									<strong>Protected.</strong> The browser won't clear your projects to free space.
								</p>
							{:else}
								<ShieldCheck size={18} aria-hidden="true" class="muted-icon" />
								<p>
									<strong>Not protected yet.</strong> When space runs low, the browser may clear sites'
									data. Ask it to keep yours.
								</p>
								<button type="button" class="button" onclick={persist}>Keep my data</button>
							{/if}
						</div>
					</section>

					<section class="block danger-zone">
						<h3>Delete all local data</h3>
						<p>
							Removes every project, setting and your GitHub sign-in from this browser. Repositories
							on GitHub and folders on your computer are not touched. This can't be undone.
						</p>
						{#if wipeError}<p class="error" role="alert">{wipeError}</p>{/if}
						{#if confirmWipe}
							<div class="confirm">
								<button type="button" class="danger" onclick={wipe}>
									<Trash2 size={15} aria-hidden="true" /> Delete everything
								</button>
								<button type="button" class="button" onclick={() => (confirmWipe = false)}
									>Cancel</button
								>
							</div>
						{:else}
							<button
								type="button"
								class="button danger-outline"
								onclick={() => (confirmWipe = true)}
							>
								<Trash2 size={15} aria-hidden="true" /> Delete all local data…
							</button>
						{/if}
					</section>
				{:else if section === 'accounts'}
					<section class="block">
						<h3><GitHubMark size={18} /> GitHub</h3>
						{#if accounts.github}
							{@const user = accounts.github.user}
							<div class="account">
								{#if user.avatarUrl}<img src={user.avatarUrl} alt="" width="40" height="40" />{/if}
								<div>
									<strong>{user.name || user.login}</strong>
									<span class="muted"
										>@{user.login} · connected {new Date(
											accounts.github.connectedAt
										).toLocaleDateString()}</span
									>
								</div>
								<span class="pill"><Check size={13} aria-hidden="true" /> Connected</span>
							</div>
							<p class="muted">
								Your access token is kept only in this browser. Signing out forgets it here; to
								disable it everywhere, delete it on GitHub too.
							</p>
							<div class="row">
								<button type="button" class="button" onclick={() => accounts.signOut()}>
									<LogOut size={15} aria-hidden="true" /> Sign out and forget token
								</button>
								<a
									class="button"
									href="https://github.com/settings/personal-access-tokens"
									target="_blank"
									rel="noopener noreferrer"
								>
									Manage tokens on GitHub <ExternalLink size={13} aria-hidden="true" /><span
										class="visually-hidden">(opens in a new tab)</span
									>
								</a>
							</div>
						{:else}
							<ConnectGitHub />
						{/if}
					</section>
					<p class="muted small">GitLab and sign-in without a token are planned.</p>
				{:else if section === 'about'}
					<section class="block about">
						<div class="brand">
							<Logo size={40} />
							<div>
								<strong>SysML Web</strong>
								<span class="muted">Version {version}</span>
							</div>
						</div>
						<dl>
							<dt>App</dt>
							<dd>{version}</dd>
							<dt>Engine</dt>
							<dd>
								{engineVersion ?? '…'}
								<span class="muted"
									>(<a
										href="{engineInfo.repository}/tree/{engineInfo.rev}"
										target="_blank"
										rel="noopener noreferrer">{engineInfo.rev.slice(0, 7)}</a
									>)</span
								>
							</dd>
						</dl>
					</section>
					<section class="block">
						<h3>Licences</h3>
						<p>
							SysML Web and its engine are free software, available under either the
							<a
								href="https://spdx.org/licenses/Apache-2.0.html"
								target="_blank"
								rel="noopener noreferrer">Apache License 2.0</a
							>
							or the
							<a href="https://spdx.org/licenses/MIT.html" target="_blank" rel="noopener noreferrer"
								>MIT License</a
							>, at your choice.
						</p>
						<p>
							The OMG SysML v2 and KerML standard library is included unmodified under the
							<a
								href="https://spdx.org/licenses/LGPL-3.0-only.html"
								target="_blank"
								rel="noopener noreferrer">GNU LGPL 3.0</a
							>; you may replace it.
						</p>
						<button
							type="button"
							class="button"
							aria-expanded={showNotice}
							aria-controls="{uid}-notice"
							onclick={toggleNotice}
						>
							{showNotice ? 'Hide' : 'Show'} the library notice
						</button>
						{#if showNotice}
							<div id="{uid}-notice" class="notice">
								{#if license}
									<p class="muted">
										{license.spdx}{#if license.source}
											· <a href={license.source} target="_blank" rel="noopener noreferrer">source</a
											>{/if}{#if license.licenseUrl}
											· <a href={license.licenseUrl} target="_blank" rel="noopener noreferrer"
												>licence text</a
											>{/if}
									</p>
									<!-- Focusable so keyboard users can scroll the notice. -->
									<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
									<pre
										tabindex="0"
										role="region"
										aria-label="Library licence notice">{license.notice}</pre>
								{:else}
									<p class="muted">Loading…</p>
								{/if}
							</div>
						{/if}
					</section>
					<section class="block">
						<h3>Trademarks</h3>
						<p class="muted">
							SysML is a registered trademark of the Object Management Group (OMG). SysML Web is an
							independent project, not affiliated with or endorsed by OMG.
						</p>
					</section>
				{/if}
			</div>
		</div>
	{/if}
</dialog>

<style>
	.settings {
		width: min(52rem, calc(100vw - 2rem));
		max-width: none;
		height: min(40rem, calc(100dvh - 4rem));
		max-height: none;
		padding: 0;
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: calc(var(--radius-lg) + 4px);
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-lg);
	}
	.settings[open] {
		display: flex;
		flex-direction: column;
		animation: pop 180ms var(--ease);
	}
	.settings::backdrop {
		background: rgb(14 16 20 / 0.45);
		backdrop-filter: blur(6px);
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: translateY(8px) scale(0.98);
		}
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-3) var(--space-3) var(--space-3) var(--space-5);
		border-bottom: 1px solid var(--border);
	}
	.head h2 {
		font-size: var(--text-xl);
	}
	.icon {
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-2);
		cursor: pointer;
	}
	.icon:hover {
		background: var(--surface-hover);
	}
	.layout {
		display: grid;
		flex: 1;
		grid-template-columns: 13.5rem 1fr;
		min-height: 0;
	}
	.tabs {
		display: grid;
		align-content: start;
		gap: 2px;
		padding: var(--space-3);
		border-right: 1px solid var(--border);
		background: var(--surface-2);
	}
	.tabs button {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		height: 2.375rem;
		padding: 0 var(--space-3);
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-2);
		font-weight: 500;
		text-align: left;
		white-space: nowrap;
		cursor: pointer;
	}
	.tabs button:hover {
		background: var(--surface-hover);
		color: var(--text);
	}
	.tabs button[aria-selected='true'] {
		background: var(--surface);
		color: var(--text);
		font-weight: 600;
		box-shadow: var(--shadow-sm);
	}
	.tabs button[aria-selected='true'] :global(svg) {
		color: var(--accent);
	}
	.panel {
		display: grid;
		align-content: start;
		gap: var(--space-5);
		padding: var(--space-5) var(--space-6) var(--space-6);
		overflow: auto;
		outline: 0;
	}
	fieldset {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		border: 0;
	}
	legend,
	.field > label,
	h3 {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-1);
		padding: 0;
		font-size: var(--text-md);
		font-weight: 600;
	}
	.help,
	.muted {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.small {
		font-size: var(--text-xs);
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--space-3);
	}
	.tile {
		position: relative;
		display: grid;
		gap: var(--space-2);
		padding: var(--space-2);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		cursor: pointer;
	}
	.tile input,
	.segmented input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}
	.tile:has(input:checked) {
		border-color: var(--accent);
		box-shadow: 0 0 0 2px var(--accent-weak);
	}
	.tile:has(input:focus-visible),
	.segmented label:has(input:focus-visible) {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
	.preview {
		display: grid;
		align-content: start;
		gap: 5px;
		height: 4.25rem;
		padding: 8px;
		border-radius: 6px;
		background: #f6f6f3;
	}
	.preview.dark {
		background: #16171a;
	}
	.preview.system {
		background: linear-gradient(135deg, #f6f6f3 50%, #16171a 50%);
	}
	.preview .bar {
		width: 40%;
		height: 7px;
		border-radius: 4px;
		background: #2f55d4;
	}
	.preview.dark .bar {
		background: #7d95ff;
	}
	.preview .line {
		height: 5px;
		border-radius: 3px;
		background: rgb(128 128 128 / 0.45);
	}
	.preview .short {
		width: 60%;
	}
	.tile-label {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: var(--text-sm);
		font-weight: 500;
	}
	.segmented {
		display: inline-flex;
		justify-self: start;
		padding: 3px;
		border-radius: var(--radius-md);
		background: var(--surface-2);
		border: 1px solid var(--border);
	}
	.segmented label {
		position: relative;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}
	.segmented span {
		display: block;
		padding: 6px var(--space-4);
		color: var(--text-2);
		font-size: var(--text-sm);
		font-weight: 500;
	}
	.segmented label:has(input:checked) {
		background: var(--surface);
		box-shadow: var(--shadow-sm);
	}
	.segmented label:has(input:checked) span {
		color: var(--text);
		font-weight: 600;
	}
	.field {
		display: grid;
		gap: var(--space-2);
	}
	.range {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.range input {
		flex: 1;
		accent-color: var(--accent);
	}
	output {
		min-width: 3.5rem;
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		text-align: right;
	}
	.sample {
		margin: 0;
		padding: var(--space-3);
		overflow: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface-2);
		line-height: 1.6;
	}
	.sample .k {
		color: var(--syntax-keyword);
	}
	.sample .d {
		color: var(--syntax-definition);
	}
	.sample .t {
		color: var(--syntax-type);
	}
	.switch {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		cursor: pointer;
	}
	.switch span {
		display: grid;
	}
	.switch small {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.switch input {
		appearance: none;
		position: relative;
		flex: none;
		width: 2.5rem;
		height: 1.5rem;
		margin: 0;
		border-radius: var(--radius-pill);
		background: var(--border-strong);
		cursor: pointer;
		transition: background var(--duration) var(--ease);
	}
	.switch input::after {
		content: '';
		position: absolute;
		top: 3px;
		left: 3px;
		width: 1.125rem;
		height: 1.125rem;
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.3);
		transition: transform var(--duration) var(--ease);
	}
	.switch input:checked {
		background: var(--accent);
	}
	.switch input:checked::after {
		transform: translateX(1rem);
	}
	.block {
		display: grid;
		gap: var(--space-2);
	}
	.block p {
		font-size: var(--text-sm);
	}
	.facts {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: var(--text-sm);
	}
	.facts li {
		display: flex;
		gap: var(--space-2);
		color: var(--text-2);
	}
	.facts :global(svg) {
		flex: none;
		margin-top: 2px;
	}
	.meter {
		height: 8px;
		overflow: hidden;
		border-radius: var(--radius-pill);
		background: var(--surface-2);
		border: 1px solid var(--border);
	}
	.meter span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--accent);
	}
	.persist {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
		padding: var(--space-3);
		border-radius: var(--radius-md);
		background: var(--surface-2);
	}
	.persist p {
		flex: 1;
		min-width: 12rem;
	}
	.persist :global(.ok-icon) {
		color: var(--ok);
	}
	.persist :global(.muted-icon) {
		color: var(--text-3);
	}
	.button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		justify-self: start;
		gap: var(--space-2);
		min-height: 2.375rem;
		padding: 0 var(--space-4);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text);
		font-size: var(--text-sm);
		font-weight: 600;
		text-decoration: none;
		cursor: pointer;
	}
	.button:hover {
		border-color: var(--text-3);
		text-decoration: none;
	}
	.danger-zone {
		padding: var(--space-4);
		border: 1px solid color-mix(in oklab, var(--danger) 35%, var(--border));
		border-radius: var(--radius-md);
	}
	.danger-outline {
		border-color: color-mix(in oklab, var(--danger) 50%, var(--border));
		color: var(--danger);
	}
	.danger {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2.375rem;
		padding: 0 var(--space-4);
		border: 0;
		border-radius: var(--radius-sm);
		background: var(--danger);
		color: var(--surface);
		font-weight: 600;
		cursor: pointer;
	}
	.confirm,
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.error {
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--danger-weak);
	}
	.account {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}
	.account img {
		border-radius: 50%;
	}
	.account div {
		display: grid;
		flex: 1;
		min-width: 0;
	}
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px var(--space-2);
		border-radius: var(--radius-pill);
		background: var(--ok-weak);
		color: var(--ok);
		font-size: var(--text-xs);
		font-weight: 600;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.brand div {
		display: grid;
	}
	.brand strong {
		font-size: var(--text-xl);
	}
	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--space-1) var(--space-4);
		margin: var(--space-2) 0 0;
		font-size: var(--text-sm);
	}
	dt {
		color: var(--text-2);
	}
	dd {
		margin: 0;
		font-family: var(--font-mono);
	}
	.notice pre {
		max-height: 14rem;
		margin: var(--space-2) 0 0;
		padding: var(--space-3);
		overflow: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface-2);
		font-size: 11px;
		white-space: pre-wrap;
	}
	@media (max-width: 760px) {
		.settings {
			width: 100vw;
			height: 100dvh;
			margin: 0;
			border: 0;
			border-radius: 0;
		}
		.settings[open] {
			animation-name: rise;
		}
		@keyframes rise {
			from {
				opacity: 0.4;
				transform: translateY(24px);
			}
		}
		.head {
			padding-top: max(var(--space-3), env(safe-area-inset-top));
		}
		.layout {
			grid-template-columns: 1fr;
			grid-template-rows: auto 1fr;
		}
		.tabs {
			display: flex;
			gap: var(--space-1);
			padding: var(--space-2) var(--space-3);
			overflow-x: auto;
			border-right: 0;
			border-bottom: 1px solid var(--border);
			scrollbar-width: none;
		}
		.tabs button {
			flex: none;
		}
		.panel {
			padding: var(--space-4) var(--space-4) max(var(--space-6), env(safe-area-inset-bottom));
		}
		.tiles {
			gap: var(--space-2);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.settings[open] {
			animation: none;
		}
	}
</style>
