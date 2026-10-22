<script lang="ts">
	import {
		BookLock,
		Eye,
		FileCode,
		FileText,
		GitCompareArrows,
		LayoutDashboard,
		ListChecks,
		Network,
		Play
	} from '@lucide/svelte';
	import type { Tab } from '#lib/workbench/ui.svelte.ts';

	/** The icon for an open view, as in the desktop tab strip. */
	let { tab, size = 16 }: { tab: Tab | undefined; size?: number } = $props();
</script>

{#if !tab || tab.kind === 'home'}<LayoutDashboard {size} aria-hidden="true" />
{:else if tab.kind === 'requirements'}<ListChecks {size} aria-hidden="true" />
{:else if tab.kind === 'diagram'}<Network {size} aria-hidden="true" />
{:else if tab.kind === 'view'}<Eye {size} aria-hidden="true" />
{:else if tab.kind === 'emulator'}<Play {size} aria-hidden="true" />
{:else if tab.kind === 'library'}<BookLock {size} aria-hidden="true" />
{:else if tab.kind === 'review'}<GitCompareArrows {size} aria-hidden="true" />
{:else if tab.path.endsWith('.md')}<FileText {size} aria-hidden="true" />
{:else}<FileCode {size} aria-hidden="true" />{/if}
