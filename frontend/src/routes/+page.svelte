<script>
	import { goto } from '$app/navigation';
	import CheckoutsCard from '$lib/components/CheckoutsCard.svelte';
	import { cardHolder, clearSession } from '$lib/session.js';

	let { data } = $props();

	function signOut() {
		clearSession();
		goto('/signin');
	}
</script>

<CheckoutsCard
	items={data.items}
	accounts={data.accounts}
	householdName={data.session.householdName}
	holder={cardHolder(data.session)}
	updatedAt={data.updatedAt}
	onSignOut={signOut}
/>
