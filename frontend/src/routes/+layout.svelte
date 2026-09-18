<script>
	import '$lib/styles/tokens.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<title>Date Due</title>
	<link rel="icon" href={favicon} />
</svelte:head>

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
