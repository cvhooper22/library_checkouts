<script>
	/**
	 * The eyeball on a password field. The parent flips its input between `password` and `text`
	 * on `revealed`; this only draws the button. Place it inside a `position: relative` wrapper
	 * that holds just the input, and leave room on the input's right for it.
	 * @type {{ revealed: boolean, label: string, disabled?: boolean }}
	 */
	let { revealed = $bindable(false), label, disabled = false } = $props();
</script>

<button
	class="reveal"
	type="button"
	aria-pressed={revealed}
	aria-label="{revealed ? 'Hide' : 'Show'} {label}"
	title="{revealed ? 'Hide' : 'Show'} {label}"
	{disabled}
	onclick={() => (revealed = !revealed)}
>
	<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
		<path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12Z" />
		<circle cx="12" cy="12" r="3" />
		{#if revealed}
			<path d="M4 20 20 4" />
		{/if}
	</svg>
</button>

<style>
	/* sits over the input's right edge, above its underline */
	.reveal {
		position: absolute;
		top: 0;
		right: 0;
		bottom: var(--dd-space-1);
		display: flex;
		align-items: center;
		padding: 0 var(--dd-space-1);
		border: none;
		background: transparent;
		color: var(--dd-ink-muted);
		cursor: pointer;
	}

	.reveal:hover:not(:disabled) {
		color: var(--dd-stamp);
	}

	.reveal:focus-visible {
		outline: 2px solid var(--dd-stamp);
		outline-offset: 1px;
	}

	.reveal:disabled {
		cursor: default;
		opacity: 0.6;
	}

	svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
