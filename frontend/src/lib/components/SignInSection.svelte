<script>
	import { tick } from 'svelte';

	/**
	 * The Set up page's sign-in methods: the account's email and password, and whether a
	 * Google account is linked. Linking lets a password account sign in with any Google
	 * account, not just one with the same address. Unlinking is only offered while there's
	 * a password to fall back on (the API refuses otherwise).
	 * @type {{
	 *   email: string,
	 *   hasPassword: boolean,
	 *   googleLinked: boolean,
	 *   googleAvailable?: boolean,
	 *   onLink: () => Promise<string | null>,
	 *   onUnlink: () => Promise<string | null>
	 * }}
	 */
	let { email, hasPassword, googleLinked, googleAvailable = true, onLink, onUnlink } = $props();

	const id = $props.id();

	let linking = $state(false);
	let confirming = $state(false);
	let unlinking = $state(false);
	/** @type {string | null} */
	let error = $state(null);
	/** @type {HTMLElement | undefined} */
	let root = $state();

	async function link() {
		if (linking) return;
		linking = true;
		error = null;
		try {
			error = await onLink();
		} finally {
			linking = false;
		}
	}

	async function askUnlink() {
		error = null;
		confirming = true;
		await tick();
		// land on the safe choice, so a stray Enter keeps the link
		/** @type {HTMLElement | null | undefined} */ (root?.querySelector('.confirm .keep'))?.focus();
	}

	function keep() {
		if (unlinking) return;
		confirming = false;
	}

	async function unlink() {
		if (unlinking) return;
		unlinking = true;
		error = null;
		try {
			error = await onUnlink();
			if (!error) confirming = false;
		} finally {
			unlinking = false;
		}
	}
</script>

<section class="signin" aria-labelledby="{id}-title" bind:this={root}>
	<div class="head">
		<h2 class="title" id="{id}-title">Sign-in methods</h2>
		<span class="meta">{email}</span>
	</div>

	<dl class="methods">
		<div>
			<dt>Email &amp; password</dt>
			<dd>{hasPassword ? 'On file' : 'Not set'}</dd>
		</div>
		<div>
			<dt>Google</dt>
			<dd>{googleLinked ? 'Linked' : 'Not linked'}</dd>
		</div>
	</dl>

	{#if !googleLinked}
		{#if googleAvailable}
			<div class="actions">
				<button class="file" type="button" onclick={link} disabled={linking}>
					{linking ? 'Opening Google…' : 'Link Google account'}
				</button>
			</div>
			<p class="fine">Any Google account works, even with a different email</p>
		{:else}
			<p class="fine">Google sign-in isn’t set up for this site</p>
		{/if}
	{:else if !hasPassword}
		<p class="fine">Google is how you sign in, so it stays linked</p>
	{:else if confirming}
		<!-- Escape is a shortcut; "Keep it" is the accessible way out -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="confirm"
			role="group"
			aria-label="Confirm unlinking Google"
			onkeydown={(e) => e.key === 'Escape' && keep()}
		>
			<p class="confirm-msg">Unlink Google? You’ll sign in with your email and password only.</p>
			<div class="confirm-actions">
				<button class="file destroy" type="button" onclick={unlink} disabled={unlinking}>
					{unlinking ? 'Unlinking…' : 'Unlink'}
				</button>
				<button class="cancel keep" type="button" onclick={keep} disabled={unlinking}>Keep it</button>
			</div>
		</div>
	{:else}
		<button class="link" type="button" onclick={askUnlink}>Unlink Google</button>
	{/if}

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
</section>

<style>
	/* Same ruled-section look as CalendarSection.svelte. */
	.signin {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--dd-space-4);
		padding: var(--dd-space-6) var(--dd-gutter);
		border-bottom: 1px solid var(--dd-rule-strong);
	}

	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--dd-space-5);
		width: 100%;
	}

	.title {
		margin: 0;
		font: 600 var(--dd-text-title) / 1.2 var(--dd-font-display);
		letter-spacing: var(--dd-track-title);
		text-transform: uppercase;
	}

	/* the email keeps its case: it's what you type to sign in */
	.meta {
		min-width: 0;
		overflow-wrap: anywhere;
		text-align: right;
		font-size: var(--dd-text-meta);
		font-weight: 700;
		letter-spacing: var(--dd-track-caption);
		color: var(--dd-ink-label);
	}

	.fine,
	dt {
		font-size: var(--dd-text-meta);
		font-weight: 700;
		letter-spacing: var(--dd-track-label);
		text-transform: uppercase;
		color: var(--dd-ink-label);
	}

	.fine {
		margin: 0;
		line-height: 1.5;
	}

	/* printed entries, like the calendar's read-only facts */
	.methods {
		display: flex;
		flex-wrap: wrap;
		gap: var(--dd-space-5) var(--dd-space-7);
		margin: 0;
	}

	.methods div {
		display: flex;
		flex-direction: column-reverse;
	}

	.methods dd {
		margin: 0 0 var(--dd-space-1);
		padding-bottom: var(--dd-space-1);
		border-bottom: 1px solid var(--dd-rule);
		font: var(--dd-text-input) / 1.3 var(--dd-font-text);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: var(--dd-space-6);
		padding-block: var(--dd-space-2);
	}

	/* ---------- unlink ---------- */
	.confirm {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--dd-space-4) var(--dd-space-6);
		padding: var(--dd-space-5) var(--dd-gutter);
		margin-inline: calc(-1 * var(--dd-gutter));
		width: calc(100% + 2 * var(--dd-gutter));
		border-top: 1px solid var(--dd-rule-soft);
		background: var(--dd-panel);
	}

	.confirm-msg {
		flex: 1 1 100%;
		margin: 0;
		font-size: var(--dd-text-meta);
		font-weight: 700;
		letter-spacing: var(--dd-track-caption);
		line-height: 1.5;
		text-transform: uppercase;
		color: var(--dd-ink);
	}

	.confirm-actions {
		display: flex;
		align-items: center;
		gap: var(--dd-space-6);
	}

	/* ---------- buttons: the register's stamp and links ---------- */
	.file {
		padding: var(--dd-space-4) 22px;
		border: var(--dd-border-action);
		border-radius: var(--dd-radius-button);
		background: transparent;
		color: var(--dd-stamp);
		font: 600 15px / 1.2 var(--dd-font-display);
		letter-spacing: 0.22em;
		text-transform: uppercase;
		cursor: pointer;
		opacity: 0.82;
		transform: rotate(var(--dd-action-tilt));
	}

	.file:hover:not(:disabled) {
		opacity: 1;
		background: var(--dd-stamp-wash);
	}

	.file:disabled {
		cursor: progress;
		opacity: 0.5;
	}

	.confirm .file {
		padding: var(--dd-space-3) 16px;
		font-size: 13px;
	}

	.destroy {
		border: var(--dd-border-danger);
		color: var(--dd-danger);
		opacity: 1;
	}

	.destroy:hover:not(:disabled) {
		background: var(--dd-danger-wash);
	}

	.destroy:focus-visible {
		outline-color: var(--dd-danger);
	}

	.cancel,
	.link {
		padding: 0 0 2px;
		border: none;
		border-bottom: 1px solid var(--dd-rule-input);
		background: none;
		font: 700 var(--dd-text-meta) / 1.2 var(--dd-font-text);
		letter-spacing: var(--dd-track-caption);
		text-transform: uppercase;
		color: var(--dd-ink-borrower);
		cursor: pointer;
	}

	.link {
		color: var(--dd-stamp-overdue);
	}

	.cancel:disabled {
		cursor: default;
		opacity: 0.5;
	}

	.error {
		margin: 0;
		font-size: var(--dd-text-meta);
		font-weight: 700;
		letter-spacing: 0.05em;
		color: var(--dd-stamp-overdue);
	}

	:is(.file, .cancel, .link):focus-visible {
		outline: 2px solid var(--dd-stamp);
		outline-offset: 2px;
	}
</style>
