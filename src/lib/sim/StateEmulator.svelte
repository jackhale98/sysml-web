<script lang="ts">
	// Placeholder until the interactive emulator lands.
	import type { Engine } from '#lib/engine/client.ts';
	import type { Workspace } from '#lib/project/workspace.svelte.ts';
	import type { WorkbenchUi } from '#lib/workbench/ui.svelte.ts';

	let { machine }: { machine: string; workspace?: Workspace; ui?: WorkbenchUi; engine?: Engine } =
		$props();
</script>

<p>The emulator for {machine} is on its way.</p>
