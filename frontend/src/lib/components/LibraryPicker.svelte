<script>
	import { tick } from 'svelte';
	import { pad2 } from '$lib/checkouts.js';

	/**
	 * A listbox styled as the "Catalogue of systems". The popover is `position: fixed` so the
	 * card's `overflow: hidden` can't clip it.
	 * @type {{
	 *   libraries: { id: string, name: string }[],
	 *   value: string,
	 *   onchange: (id: string) => void,
	 *   label?: string,
	 *   disabled?: boolean
	 * }}
	 */
	let { libraries, value, onchange, label = 'Library', disabled = false } = $props();

	const id = $props.id();

	let open = $state(false);
	let active = $state(0);
	let pos = $state({ left: 0, top: 0, width: 0, maxHeight: 0 });
	/** @type {HTMLButtonElement | undefined} */
	let button = $state();
	/** @type {HTMLDivElement | undefined} */
	let pop = $state();

	const selected = $derived(libraries.find((l) => l.id === value));

	function place() {
		if (!button) return;
		const r = button.getBoundingClientRect();
		const width = Math.max(r.width, 300);
		const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
		pos = { left, top: r.bottom + 4, width, maxHeight: Math.max(160, window.innerHeight - r.bottom - 16) };
	}

	async function show() {
		if (disabled || !libraries.length) return;
		active = Math.max(0, libraries.findIndex((l) => l.id === value));
		place();
		open = true;
		await tick();
		pop?.focus();
		pop?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
	}

	/** @param {boolean} [refocus] */
	function hide(refocus = true) {
		open = false;
		if (refocus) button?.focus();
	}

	/** @param {number} i */
	function choose(i) {
		onchange(libraries[i].id);
		hide();
	}

	/** @param {KeyboardEvent} e */
	function onListKey(e) {
		const last = libraries.length - 1;
		switch (e.key) {
			case 'ArrowDown':
				active = Math.min(active + 1, last);
				break;
			case 'ArrowUp':
				active = Math.max(active - 1, 0);
				break;
			case 'Home':
				active = 0;
				break;
			case 'End':
				active = last;
				break;
			case 'Enter':
			case ' ':
				choose(active);
				break;
			case 'Escape':
				hide();
				break;
			case 'Tab':
				hide(false);
				return;
			default:
				return;
		}
		e.preventDefault();
		pop?.querySelector(`#${CSS.escape(`${id}-o${active}`)}`)?.scrollIntoView({ block: 'nearest' });
	}

	/** @param {PointerEvent} e */
	function onWindowPointer(e) {
		if (!open) return;
		const t = /** @type {Node} */ (e.target);
		if (!pop?.contains(t) && !button?.contains(t)) hide(false);
	}
</script>

<svelte:window
	onpointerdown={onWindowPointer}
	onresize={() => open && place()}
	onscrollcapture={() => open && place()}
/>

<button
	bind:this={button}
	type="button"
	class="trigger"
	aria-label="{label}: {selected?.name ?? 'none chosen'}"
	aria-haspopup="listbox"
	aria-expanded={open}
	aria-controls="{id}-pop"
	{disabled}
	onclick={() => (open ? hide() : show())}
	onkeydown={(e) => {
		if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
			e.preventDefault();
			show();
		}
	}}
>
	<span class="name">{selected?.name ?? 'Choose a library'}</span>
	<span class="caret" aria-hidden="true"></span>
</button>

{#if open}
	<div
		bind:this={pop}
		id="{id}-pop"
		class="pop"
		style:left="{pos.left}px"
		style:top="{pos.top}px"
		style:width="{pos.width}px"
		style:max-height="{pos.maxHeight}px"
		role="listbox"
		tabindex="-1"
		aria-label={label}
		aria-activedescendant="{id}-o{active}"
		onkeydown={onListKey}
	>
		<div class="pop-head">
			<span>Catalogue of systems</span>
			<span class="count">{pad2(libraries.length)}</span>
		</div>
		{#each libraries as lib, i (lib.id)}
			<!-- keyboard is handled on the listbox via aria-activedescendant -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<div
				id="{id}-o{i}"
				class="opt"
				class:active={i === active}
				role="option"
				aria-selected={lib.id === value}
				tabindex="-1"
				onclick={() => choose(i)}
				onpointermove={() => (active = i)}
			>
				<span class="check" aria-hidden="true">{lib.id === value ? '✓' : ''}</span>
				<span class="sys">Sys {pad2(i + 1)}</span>
				<span class="opt-name">{lib.name}</span>
			</div>
		{/each}
	</div>
{/if}

<style>
	.trigger {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--dd-space-3);
		width: 100%;
		margin: 0;
		padding: 0 0 var(--dd-space-1);
		border: none;
		border-bottom: 1px solid var(--dd-rule-input);
		border-radius: 0;
		background: transparent;
		font: 600 var(--dd-text-subject) / 1.25 var(--dd-font-text);
		letter-spacing: var(--dd-track-title);
		text-align: left;
		color: var(--dd-ink);
		cursor: pointer;
	}

	.trigger:focus-visible {
		outline: none;
		padding-bottom: calc(var(--dd-space-1) - 1px);
		border-bottom: 2px solid var(--dd-stamp);
	}

	.trigger:disabled {
		cursor: default;
		opacity: 0.5;
	}

	.name {
		min-width: 0;
	}

	.caret {
		flex: none;
		width: 0;
		height: 0;
		border: 4px solid transparent;
		border-top: 5px solid var(--dd-stamp);
		border-bottom: none;
	}

	.trigger[aria-expanded='true'] .caret {
		border-top: none;
		border-bottom: 5px solid var(--dd-stamp);
	}

	/* ---------- popover ---------- */
	.pop {
		position: fixed;
		z-index: 50;
		overflow-y: auto;
		background: var(--dd-paper);
		border: 1px solid var(--dd-edge);
		border-radius: var(--dd-radius-card);
		box-shadow: var(--dd-shadow-card);
		color: var(--dd-ink);
	}

	.pop:focus {
		outline: none;
	}

	.pop-head {
		display: flex;
		justify-content: space-between;
		padding: var(--dd-space-4) var(--dd-space-5);
		background: var(--dd-panel-head);
		font-size: var(--dd-text-caption);
		font-weight: 700;
		letter-spacing: var(--dd-track-label);
		text-transform: uppercase;
		color: var(--dd-ink-label);
	}

	.count {
		font: 600 13px / 1 var(--dd-font-display);
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.05em;
	}

	.opt {
		display: grid;
		grid-template-columns: 16px auto 1fr;
		align-items: center;
		gap: var(--dd-space-4);
		min-height: var(--dd-row-min-h);
		padding: var(--dd-space-3) var(--dd-space-5);
		border-top: 1px solid var(--dd-rule-soft);
		cursor: pointer;
	}

	.opt.active {
		background: var(--dd-panel);
		box-shadow: inset 0 0 0 1px var(--dd-stamp-hairline);
	}

	.opt[aria-selected='true'] {
		background: var(--dd-panel-head);
	}

	.check {
		color: var(--dd-stamp);
		font-weight: 700;
	}

	.sys {
		font: 400 14px / 1 var(--dd-font-display);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--dd-ink-borrower);
		font-variant-numeric: tabular-nums;
	}

	.opt-name {
		font: 600 var(--dd-text-subject) / 1.2 var(--dd-font-text);
		letter-spacing: var(--dd-track-title);
	}
</style>
