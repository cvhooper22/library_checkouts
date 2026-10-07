<script>
	/**
	 * @type {{
	 *   tabs: { id: string, label: string, disabled?: boolean, end?: boolean }[],
	 *   selected: string,
	 *   onselect?: (id: string) => void,
	 *   label?: string
	 * }}
	 */
	let { tabs, selected, onselect, label } = $props();

	let strip = $state();

	// The selected tab joins the card's top edge, where the card's bloom highlight (tokens.css) has
	// a colour that depends on x. Hand the tab the card's width/height and its own left offset so it
	// can rebuild that gradient in px and blend into the card.
	$effect(() => {
		selected; // re-measure when the selection changes
		const card = strip?.nextElementSibling;
		const tab = strip?.querySelector('[aria-selected="true"]');
		if (!card || !tab) return;
		const measure = () => {
			const c = card.getBoundingClientRect();
			const t = tab.getBoundingClientRect();
			tab.style.setProperty('--card-w', `${c.width}px`);
			tab.style.setProperty('--card-h', `${c.height}px`);
			tab.style.setProperty('--tab-left', `${t.left - c.left}px`);
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(card);
		// tab widths shift with fonts/labels without the strip resizing, so watch each tab too
		for (const el of strip.children) ro.observe(el);
		return () => ro.disconnect();
	});
</script>

<div class="tabs" role="tablist" aria-label={label} bind:this={strip}>
	{#each tabs as tab (tab.id)}
		<button
			role="tab"
			class="tab"
			class:end={tab.end}
			aria-selected={selected === tab.id}
			disabled={tab.disabled}
			onclick={() => onselect?.(tab.id)}
		>
			{tab.label.toUpperCase()}
		</button>
	{/each}
</div>

<style>
	/* catalog dividers overlapping the card's top edge */
	.tabs {
		position: relative;
		z-index: 2; /* above the card's top border */
		display: flex;
		align-items: flex-end;
		gap: var(--dd-space-1);
		padding-inline: var(--dd-tab-offset);
	}

	/* a tab flagged `end` (and any after it) sits at the far right of the strip */
	.tab.end {
		margin-left: auto;
	}

	.tab {
		position: relative;
		margin-bottom: 0;
		padding: 6px 9px 7px;
		border: 1px solid rgba(38, 34, 28, 0.24);
		border-bottom: none;
		border-radius: var(--dd-radius-tab);
		background: var(--dd-paper-tab);
		box-shadow: inset 0 -4px 6px rgba(38, 34, 28, 0.1);
		color: var(--dd-ink-tab);
		font: 700 var(--dd-text-tab) / 1.2 var(--dd-font-text);
		letter-spacing: var(--dd-track-tab);
		cursor: pointer;
	}

	.tab[aria-selected='true'] {
		z-index: 2;
		/* taller, and overlaps exactly the card's 1px top border so the line under the tab disappears and the side borders end flush with it */
		padding: 8px 10px 11px;
		margin-bottom: -1px;
		border-color: var(--dd-edge);
		/* the card's bloom, re-centred on the tab's bottom edge (= the card's top edge) in px, over a
		   fade up from the stock colour; --card-w/--card-h/--tab-left are set by the script above */
		/* Layers, top to bottom. The tab's bottom edge must equal the card's colour at that x, so only
		   the bloom (the card's own gradient, re-centred in px) and plain paper reach the bottom edge;
		   everything decorative fades to nothing before it. */
		background:
			/* sheen: soft glow in the upper-middle of the tab, zero by the bottom edge */
			radial-gradient(130% 65% at 40% 35%, rgba(255, 251, 236, 0.5), rgba(255, 251, 236, 0) 70%),
			radial-gradient(
				calc(var(--dd-bloom-rx) * var(--card-w, 100vw)) calc(var(--dd-bloom-ry) * var(--card-h, 100vh))
					at calc(var(--dd-bloom-cx) * var(--card-w, 100vw) - var(--tab-left, 0px)) 100%,
				var(--dd-bloom-color),
				transparent var(--dd-bloom-fade)
			),
			/* slightly darker at the top, easing to exactly the stock colour at the bottom */
			linear-gradient(180deg, color-mix(in srgb, var(--dd-paper) 40%, var(--dd-paper-tab)), var(--dd-paper));
		box-shadow: none;
		color: var(--dd-ink);
	}

	.tab:disabled {
		cursor: default;
		opacity: 0.6;
	}

	.tab:focus-visible {
		outline: 2px solid var(--dd-stamp);
		outline-offset: 2px;
	}
</style>
