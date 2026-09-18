<script>
	import CatalogTabs from './CatalogTabs.svelte';
	import PaperCard from './PaperCard.svelte';

	/** @type {{ onDemo: () => void, busy?: boolean, error?: string | null }} */
	let { onDemo, busy = false, error = null } = $props();

	const tabs = [
		{ id: 'signin', label: 'Sign in' },
		{ id: 'create', label: 'Create account', disabled: true }
	];
</script>

<section class="signin">
	<CatalogTabs {tabs} selected="signin" label="Account" />

	<PaperCard>
		<div class="body">
			<header class="head">
				<h1 class="title">Date Due</h1>
				<span class="form-no">Form<br />2·A</span>
			</header>

			<!-- Google and email sign-in aren't wired up yet; see the note in the sign-in route. -->
			<button class="google" disabled title="Not available yet">
				<span class="g" aria-hidden="true">G</span>
				<span>
					<span class="google-title">Continue with Google</span>
					<span class="google-sub">Fastest way in — nothing to remember</span>
				</span>
			</button>

			<div class="or"><span>Or by email</span></div>

			<button class="link" disabled title="Not available yet">Use an email and password</button>

			<button class="link demo" onclick={onDemo} disabled={busy}>
				{busy ? 'Opening the demo…' : 'Try the demo →'}
			</button>

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
		justify-content: space-between;
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

	.link.demo {
		margin-bottom: 0;
	}

	:is(.google, .link):disabled {
		cursor: default;
		opacity: 0.5;
	}

	/* the working control stays at full strength even while "busy" */
	.link.demo:disabled {
		cursor: progress;
		opacity: 0.7;
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
