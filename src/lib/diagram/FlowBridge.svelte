<script lang="ts" module>
	import { useSvelteFlow } from '@xyflow/svelte';

	export type FlowApi = ReturnType<typeof useSvelteFlow>;
</script>

<script lang="ts">
	/**
	 * Gives the canvas the viewport helpers of Svelte Flow, which are only
	 * available inside <SvelteFlow>.
	 */
	import { onMount } from 'svelte';

	let { onready }: { onready: (api: FlowApi) => void } = $props();

	const api = useSvelteFlow();
	onMount(() => onready(api));
</script>
