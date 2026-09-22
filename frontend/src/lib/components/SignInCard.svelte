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
	 *   onGoogle: () => void,
	 *   busy?: 'demo' | 'login' | 'register' | 'google' | null,
	 *   error?: string | null
	 * }}
	 */
	let { tab, onTab, onDemo, onLogin, onRegister, onGoogle, busy = null, error = null } = $props();

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
				<button class="google" onclick={onGoogle} disabled={busy !== null}>
					<span class="g" aria-hidden="true">
						<svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
							<path
								fill="#4285F4"
								d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
							/>
							<path
								fill="#34A853"
								d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"
							/>
							<path
								fill="#FBBC05"
								d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.348 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"
							/>
							<path
								fill="#EA4335"
								d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
							/>
						</svg>
					</span>
					<span>
						<span class="google-title">
							{busy === 'google' ? 'Signing in…' : 'Continue with Google'}
						</span>
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
	}

	.g svg {
		width: 18px;
		height: 18px;
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
