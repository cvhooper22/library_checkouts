<script>
	import CatalogTabs from './CatalogTabs.svelte';
	import EmailAuthForm from './EmailAuthForm.svelte';
	import PaperCard from './PaperCard.svelte';

	/**
	 * @type {{
	 *   tab: 'signin' | 'create',
	 *   onTab: (id: string) => void,
	 *   onDemo: () => void,
	 *   onLogin: (v: { email: string, password: string }) => void,
	 *   onRegister: (v: { email: string, password: string, householdName: string }) => void,
	 *   busy?: 'demo' | 'login' | 'register' | null,
	 *   error?: string | null
	 * }}
	 */
	let { tab, onTab, onDemo, onLogin, onRegister, busy = null, error = null } = $props();

	// The email form stays tucked behind its link until asked for (Google is the lead path).
	let emailOpen = $state(false);

	const tabs = [
		{ id: 'signin', label: 'Sign in' },
		{ id: 'create', label: 'Create account' }
	];
</script>

<section class="signin">
	<CatalogTabs {tabs} selected={tab} onselect={onTab} label="Account" />

	<PaperCard>
		<div class="body">
			<header class="head">
				<span class="form-no">Form<br />2·A</span>
			</header>

			{#if tab === 'signin'}
				<!-- Google sign-in isn't wired up yet; the email form below is. -->
				<button class="google" disabled title="Not available yet">
					<span class="g" aria-hidden="true">G</span>
					<span>
						<span class="google-title">Continue with Google</span>
						<span class="google-sub">Fastest way in — nothing to remember</span>
					</span>
				</button>

				<div class="or"><span>Or by email</span></div>

				{#if emailOpen}
					<div class="email-form">
						<EmailAuthForm mode="signin" onSubmit={onLogin} busy={busy === 'login'} focusFirst />
					</div>
				{:else}
					<div class="use-email">
						<button class="link" onclick={() => (emailOpen = true)}>Use an email and password</button>
					</div>
				{/if}

				<button class="link demo" onclick={onDemo} disabled={busy !== null}>
					{busy === 'demo' ? 'Opening the demo…' : 'Try the demo →'}
				</button>
			{:else}
				<EmailAuthForm mode="create" onSubmit={onRegister} busy={busy === 'register'} />
			{/if}

			{#if error}
				<p class="error" role="alert">{error}</p>
			{/if}
		</div>
	</PaperCard>
</section>

<style>
	.signin {
		width: 100%;
		max-width: var(--dd-card-width);
		font-family: var(--dd-font-text);
	}

	.body {
		padding: var(--dd-space-5) var(--dd-gutter) var(--dd-space-7);
	}

	.head {
		display: flex;
		justify-content: flex-end;
		align-items: flex-start;
		margin-bottom: var(--dd-space-7);
		font-family: var(--dd-font-display);
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.title {
		margin: 0;
		font-size: var(--dd-text-title);
		font-weight: 600;
		line-height: 1.2;
	}

	.form-no {
		text-align: right;
		font-size: var(--dd-text-callno);
		font-weight: 600;
		line-height: 1.15;
		color: var(--dd-ink-call);
	}

	/* ---------- Google: the inset control on the card ---------- */
	.google {
		display: flex;
		align-items: center;
		gap: var(--dd-space-5);
		width: 100%;
		padding: var(--dd-space-5) var(--dd-space-5);
		border: var(--dd-border-action);
		border-radius: var(--dd-radius-button);
		background: var(--dd-paper-raised);
		box-shadow: var(--dd-shadow-raised);
		text-align: left;
		color: var(--dd-stamp);
		cursor: pointer;
	}

	.google:hover:not(:disabled) {
		background: var(--dd-paper-raised-hover);
	}

	.g {
		display: flex;
		align-items: center;
		justify-content: center;
		flex: none;
		width: 28px;
		height: 28px;
		border: 1px solid var(--dd-rule-mark);
		font: 600 19px / 1 var(--dd-font-display);
	}

	.google-title {
		display: block;
		font: 600 15px / 1.2 var(--dd-font-display);
		letter-spacing: var(--dd-track-action);
		text-transform: uppercase;
	}

	.google-sub {
		display: block;
		margin-top: var(--dd-space-2);
		font-size: var(--dd-text-caption);
		font-weight: 700;
		letter-spacing: var(--dd-track-caption);
		text-transform: uppercase;
		color: var(--dd-ink-label);
	}

	/* ---------- divider ---------- */
	.or {
		display: flex;
		align-items: center;
		gap: var(--dd-space-5);
		margin: var(--dd-space-6) 0 var(--dd-space-5);
		font-size: var(--dd-text-caption);
		font-weight: 700;
		letter-spacing: var(--dd-track-label);
		text-transform: uppercase;
		color: var(--dd-ink-label);
	}

	.or::before,
	.or::after {
		content: '';
		flex: 1;
		border-top: 1px solid var(--dd-rule-input);
	}

	.use-email {
		display: flex;
		justify-content: center;
	}

	/* the revealed form sits where the link was, with the demo link still below it;
	   inset from the divider above so the inputs read as their own block */
	.email-form {
		margin-bottom: var(--dd-space-6);
		padding-inline: 2rem;
	}

	/* ---------- text links ---------- */
	.link {
		display: block;
		margin: 0 0 var(--dd-space-5);
		padding: 0 0 2px;
		border: none;
		border-bottom: 1px solid var(--dd-rule-input);
		background: none;
		font: 700 var(--dd-text-meta) / 1.2 var(--dd-font-text);
		letter-spacing: var(--dd-track-caption);
		text-transform: uppercase;
		color: var(--dd-stamp);
		cursor: pointer;
	}

	/* the lead path is the email form; the demo is a quieter aside, pushed to the right and faded */
	.link.demo {
		margin: 0 0 0 auto;
		opacity: 0.6;
	}

	.link.demo:hover:not(:disabled),
	.link.demo:focus-visible {
		opacity: 1;
	}

	:is(.google, .link):disabled {
		cursor: default;
		opacity: 0.5;
	}

	/* the demo link keeps its resting fade while busy (rather than dimming further) and shows progress */
	.link.demo:disabled {
		cursor: progress;
		opacity: 0.6;
	}

	.error {
		margin: var(--dd-space-5) 0 0;
		font-size: var(--dd-text-meta);
		font-weight: 700;
		letter-spacing: 0.05em;
		color: var(--dd-stamp-overdue);
	}

	:is(.google, .link):focus-visible {
		outline: 2px solid var(--dd-stamp);
		outline-offset: 2px;
	}
</style>
