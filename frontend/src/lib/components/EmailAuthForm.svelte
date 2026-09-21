<script>
	import { onMount } from 'svelte';
	import RevealToggle from './RevealToggle.svelte';

	/**
	 * One form for both email paths: `signin` asks for email + password, `create` also asks for
	 * the household to open. `householdName` is only present in the `create` submission.
	 * @type {{
	 *   mode: 'signin' | 'create',
	 *   onSubmit: (v: { email: string, password: string, householdName: string }) => void,
	 *   busy?: boolean,
	 *   focusFirst?: boolean
	 * }}
	 */
	let { mode, onSubmit, busy = false, focusFirst = false } = $props();

	const id = $props.id();
	const create = $derived(mode === 'create');

	let email = $state('');
	let password = $state('');
	let showPassword = $state(false);
	let householdName = $state('');
	/** @type {HTMLInputElement | undefined} */
	let emailInput;

	// For a form revealed by a click, where the user's next move is obviously to type.
	onMount(() => {
		if (focusFirst) emailInput?.focus();
	});

	/** @param {SubmitEvent} e */
	function submit(e) {
		e.preventDefault();
		if (busy) return;
		onSubmit({ email, password, householdName: householdName.trim() });
	}
</script>

<!-- Printed-form fields: value on a rule, label beneath (design-handoff svelte README). -->
<form class="form" onsubmit={submit}>
	<div class="field">
		<input
			id="{id}-email"
			type="email"
			bind:this={emailInput}
			bind:value={email}
			autocomplete="email"
			autocapitalize="off"
			spellcheck="false"
			required
		/>
		<label for="{id}-email">Email</label>
	</div>

	<div class="field">
		<div class="pw">
			<input
				id="{id}-password"
				type={showPassword ? 'text' : 'password'}
				bind:value={password}
				autocomplete={create ? 'new-password' : 'current-password'}
				autocapitalize="off"
				spellcheck="false"
				required
			/>
			<RevealToggle bind:revealed={showPassword} label="password" />
		</div>
		<label for="{id}-password">Password</label>
	</div>

	{#if create}
		<div class="field">
			<input
				id="{id}-household"
				type="text"
				bind:value={householdName}
				autocomplete="off"
				required
			/>
			<label for="{id}-household">Household name</label>
		</div>
	{/if}

	<button class="submit" class:centered={!create} type="submit" disabled={busy}>
		{#if create}
			{busy ? 'Creating…' : 'Create account'}
		{:else}
			{busy ? 'Signing in…' : 'Sign in'}
		{/if}
	</button>
</form>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--dd-field-gap);
	}

	input {
		display: block;
		width: 100%;
		margin: 0;
		padding: 0 0 var(--dd-space-1);
		border: none;
		border-bottom: 1px solid var(--dd-rule-input);
		border-radius: 0;
		background: transparent;
		font: var(--dd-text-input) / 1.3 var(--dd-font-text);
		color: var(--dd-ink);
	}

	.pw {
		position: relative;
	}

	/* keeps typed text clear of the eyeball */
	.pw input {
		padding-right: 28px;
	}

	/* focus swaps the underline to stamp violet; the 1px padding trade keeps the row from jumping */
	input:focus {
		outline: none;
		padding-bottom: calc(var(--dd-space-1) - 1px);
		border-bottom: 2px solid var(--dd-stamp);
	}

	/* browsers paint autofilled inputs; keep the field unfilled so it reads as printed paper */
	input:-webkit-autofill {
		-webkit-box-shadow: 0 0 0 1000px var(--dd-paper) inset;
		-webkit-text-fill-color: var(--dd-ink);
	}

	label {
		display: block;
		margin-top: var(--dd-space-1);
		font-size: var(--dd-text-label);
		font-weight: 700;
		letter-spacing: var(--dd-track-label);
		text-transform: uppercase;
		color: var(--dd-ink-label);
	}

	.submit {
		align-self: flex-start;
		margin-top: var(--dd-space-2);
		padding: var(--dd-space-3) 18px;
		border: var(--dd-border-action);
		border-radius: var(--dd-radius-button);
		background: transparent;
		color: var(--dd-stamp);
		font: 600 var(--dd-text-action) / 1.2 var(--dd-font-display);
		letter-spacing: var(--dd-track-action);
		text-transform: uppercase;
		cursor: pointer;
		opacity: 0.82;
		transform: rotate(var(--dd-action-tilt));
	}

	/* sign-in sits centered under its fields; create-account stays left like a form to be filled in */
	.submit.centered {
		align-self: center;
	}

	.submit:hover:not(:disabled) {
		opacity: 1;
		background: var(--dd-stamp-wash);
	}

	.submit:disabled {
		cursor: progress;
		opacity: 0.5;
	}

	.submit:focus-visible {
		outline: 2px solid var(--dd-stamp);
		outline-offset: 2px;
	}
</style>
