<script>
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ApiError } from '$lib/api.js';
	import { finishConnect } from '$lib/calendar.js';
	import PaperCard from '$lib/components/PaperCard.svelte';
	import { clearSession, getSession } from '$lib/session.js';

	// Google sends the user back here (GOOGLE_CALENDAR_REDIRECT_URI) with ?code&state, or
	// ?error when they backed out. finishConnect only goes ahead if `state` is the one this
	// tab stored when it started; then it's straight back to Set up.

	/** @type {string | null} */
	let problem = $state(null);

	onMount(async () => {
		const session = getSession();
		if (!session) {
			await goto('/signin', { replaceState: true });
			return;
		}

		const params = page.url.searchParams;
		const code = params.get('code');
		const state = params.get('state');
		if (params.get('error') || !code || !state) {
			problem =
				params.get('error') === 'access_denied'
					? 'Connection cancelled. Nothing was changed.'
					: 'Google didn’t finish the connection. Nothing was changed.';
			return;
		}

		try {
			const calendar = await finishConnect({ token: session.token, householdId: session.householdId, code, state });
			// replaceState: the code in this URL is single-use; keep it out of history.
			await goto(`/cards?calendar=${calendar.lastSyncedAt ? 'reconnected' : 'connected'}`, { replaceState: true });
		} catch (e) {
			if (e instanceof ApiError && e.status === 401) {
				clearSession();
				await goto('/signin', { replaceState: true });
				return;
			}
			problem = e instanceof Error ? e.message : 'Something went wrong';
		}
	});
</script>

<div class="wrap">
	<PaperCard>
		<div class="body">
			<h1 class="title">Google Calendar</h1>
			{#if problem}
				<p class="msg" role="alert">{problem}</p>
				<a class="link" href="/cards">Back to Set up →</a>
			{:else}
				<p class="msg" role="status">Connecting your calendar…</p>
			{/if}
		</div>
	</PaperCard>
</div>

<style>
	.wrap {
		width: 100%;
		max-width: 520px;
	}

	.body {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--dd-space-5);
		padding: var(--dd-space-6) var(--dd-gutter);
	}

	.title {
		margin: 0;
		font: 600 var(--dd-text-title) / 1.2 var(--dd-font-display);
		letter-spacing: var(--dd-track-title);
		text-transform: uppercase;
	}

	.msg {
		margin: 0;
		font-size: var(--dd-text-input);
		line-height: 1.45;
	}

	.link {
		padding-bottom: 2px;
		border-bottom: 1px solid var(--dd-rule-input);
		font: 700 var(--dd-text-meta) / 1.2 var(--dd-font-text);
		letter-spacing: var(--dd-track-caption);
		text-decoration: none;
		text-transform: uppercase;
		color: var(--dd-stamp);
	}

	.link:focus-visible {
		outline: 2px solid var(--dd-stamp);
		outline-offset: 2px;
	}
</style>
