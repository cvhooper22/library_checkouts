<script>
	import { goto } from '$app/navigation';
	import { api } from '$lib/api.js';
	import SignInCard from '$lib/components/SignInCard.svelte';
	import { setSession } from '$lib/session.js';

	let busy = $state(false);
	/** @type {string | null} */
	let error = $state(null);

	// Only the demo path is wired: POST /auth/demo is the one sign-in that returns a household id.
	// /auth/login and /auth/google return just a token, so signing in with either leaves the app
	// with no way to find the household yet (needs a backend "who am I" endpoint).
	async function tryDemo() {
		busy = true;
		error = null;
		try {
			const { token, householdId } = await api('/auth/demo', { method: 'POST' });
			// The API doesn't return the household's name; this matches worker/scripts/reseed-demo.js.
			setSession({ token, householdId, householdName: 'Demo Household', demo: true });
			await goto('/');
		} catch (e) {
			error = e instanceof Error ? e.message : 'Something went wrong';
		} finally {
			busy = false;
		}
	}
</script>

<SignInCard onDemo={tryDemo} {busy} {error} />
