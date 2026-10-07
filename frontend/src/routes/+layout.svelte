<script>
	import '$lib/styles/tokens.css';
	import { page } from '$app/state';
	import DemoBanner from '$lib/components/DemoBanner.svelte';
	import { getSession } from '$lib/session.js';

	let { children } = $props();

	// Re-read on every navigation: the session changes when someone signs in or out.
	const demo = $derived.by(() => {
		page.url;
		return getSession()?.demo === true;
	});
</script>

<svelte:head>
	<title>Bookstamp</title>
</svelte:head>

{#if demo}
	<DemoBanner />
{/if}

<main>
	{@render children()}
</main>

<style>
	:global(*, *::before, *::after) {
		box-sizing: border-box;
	}

	:global(body) {
		margin: 0;
		background: var(--dd-page);
		color: var(--dd-ink-app);
		font-family: var(--dd-font-text);
	}

	main {
		display: flex;
		justify-content: center;
		padding: var(--dd-space-6) var(--dd-space-5) var(--dd-space-7);
	}
</style>
