<script>
	/**
	 * @type {{
	 *   tabs: { id: string, label: string, disabled?: boolean }[],
	 *   selected: string,
	 *   onselect?: (id: string) => void,
	 *   label?: string
	 * }}
	 */
	let { tabs, selected, onselect, label } = $props();
</script>

<div class="tabs" role="tablist" aria-label={label}>
	{#each tabs as tab (tab.id)}
		<button
			role="tab"
			class="tab"
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
		display: flex;
		gap: var(--dd-space-1);
		padding-left: var(--dd-tab-offset);
	}

	.tab {
		position: relative;
		margin-bottom: -1px;
		padding: 7px 9px 8px;
		border: 1px solid var(--dd-edge-soft);
		border-bottom: none;
		border-radius: var(--dd-radius-tab);
		background: var(--dd-paper-tab);
		box-shadow: var(--dd-shadow-tab-inactive);
		color: var(--dd-ink-tab);
		font: 700 var(--dd-text-tab) / 1.2 var(--dd-font-text);
		letter-spacing: var(--dd-track-tab);
		cursor: pointer;
	}

	.tab[aria-selected='true'] {
		z-index: 2;
		background: var(--dd-paper-tab-active);
		box-shadow: var(--dd-shadow-tab-active);
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
