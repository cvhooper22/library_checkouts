<script>
	let { children } = $props();
</script>

<!-- Every card is stock + patina (design-handoff svelte README, "Rules of the look"). -->
<article class="card">
	{@render children()}
</article>

<style>
	.card {
		position: relative;
		z-index: 1; /* above inactive tabs, below the active one, so it can overlap the card edge */
		overflow: hidden;
		background: var(--dd-paper);
		border: 1px solid var(--dd-edge);
		border-radius: var(--dd-radius-card);
		box-shadow: var(--dd-shadow-card);
		color: var(--dd-ink);
	}

	.card::before {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: var(--dd-patina);
	}

	/* children arrive via a snippet, so Svelte can't see them and would prune a plain `> *` */
	.card > :global(*) {
		position: relative;
	}
</style>
