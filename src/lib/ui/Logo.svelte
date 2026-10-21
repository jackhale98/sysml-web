<script lang="ts">
	let { size = 24 }: { size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
	<rect width="32" height="32" rx="8" fill="var(--accent)" />
	<rect x="6.5" y="6.5" width="9" height="9" rx="2" fill="var(--accent-text)" />
	<rect x="16.5" y="16.5" width="9" height="9" rx="4.5" fill="var(--accent-text)" />
	<path
		d="M15.5 11h3a2.5 2.5 0 0 1 2.5 2.5v3"
		fill="none"
		stroke="var(--accent-text)"
		stroke-opacity="0.65"
		stroke-width="2"
	/>
</svg>
