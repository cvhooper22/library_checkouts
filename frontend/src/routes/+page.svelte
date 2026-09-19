<script>
	import { goto, invalidateAll } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import { ApiError } from '$lib/api.js';
	import CheckoutsCard from '$lib/components/CheckoutsCard.svelte';
	import { refreshAccounts } from '$lib/refresh.js';
	import { cardHolder, clearSession, holderLine } from '$lib/session.js';

	let { data } = $props();

	/** @type {import('$lib/refresh.js').RefreshPhase} */
	let refresh = $state('idle');

	// Leaving the page (sign-out, Cards) stops the poll rather than leaving it running unseen.
	const polling = new AbortController();
	onDestroy(() => polling.abort());

	function signOut() {
		clearSession();
		goto('/signin');
	}

	/** @param {string | null} accountId  one card's id, or null for every card */
	async function restamp(accountId) {
		refresh = 'running';
		try {
			const outcome = await refreshAccounts({
				token: data.session.token,
				householdId: data.session.householdId,
				accountId,
				signal: polling.signal
			});
			if (polling.signal.aborted) return;

			// Something new landed: pull it in now, staying "running" until it's on screen.
			if (outcome === 'ready' || outcome === 'partial') {
				await invalidateAll();
				refresh = outcome === 'ready' ? 'idle' : 'partial';
			} else {
				refresh = outcome;
			}
		} catch (e) {
			if (e instanceof ApiError && e.status === 401) {
				clearSession();
				await goto('/signin');
			} else {
				refresh = 'failed';
			}
		}
	}

	async function reload() {
		await invalidateAll();
		refresh = 'idle';
	}
</script>

<CheckoutsCard
	items={data.items}
	accounts={data.accounts}
	householdName={data.session.householdName}
	holder={cardHolder(data.session)}
	holderFor={(a) => holderLine(a.name, a.id)}
	updatedAt={data.updatedAt}
	{refresh}
	onRefresh={data.session.demo || !data.features.refresh ? undefined : restamp}
	onReload={reload}
	onSignOut={signOut}
	onManageCards={() => goto('/cards')}
/>
