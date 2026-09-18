<script>
	import { goto } from '$app/navigation';
	import { ApiError, api } from '$lib/api.js';
	import SignInCard from '$lib/components/SignInCard.svelte';
	import { setSession } from '$lib/session.js';

	/** @type {'signin' | 'create'} */
	let tab = $state('signin');
	/** @type {'demo' | 'login' | 'register' | null} */
	let busy = $state(null);
	/** @type {string | null} */
	let error = $state(null);

	/** @param {string} id */
	function selectTab(id) {
		tab = id === 'create' ? 'create' : 'signin';
		error = null;
	}

	// Demo, register and email login are wired up. Demo and register get a household back with the
	// token; /auth/login returns only a token, so login follows up with GET /me. Google sign-in
	// (/auth/google) is the same shape as login but isn't hooked to a button yet.
	async function tryDemo() {
		busy = 'demo';
		error = null;
		try {
			const { token, householdId } = await api('/auth/demo', { method: 'POST' });
			// The API doesn't return the household's name; this matches worker/scripts/reseed-demo.js.
			setSession({ token, householdId, householdName: 'Demo Household', demo: true });
			await goto('/');
		} catch (e) {
			error = e instanceof Error ? e.message : 'Something went wrong';
		} finally {
			busy = null;
		}
	}

	/** @param {{ email: string, password: string }} body */
	async function login(body) {
		busy = 'login';
		error = null;
		try {
			const { token } = await api('/auth/login', { method: 'POST', body });
			const { households } = await api('/me', { token });
			// A user can belong to several households but the app shows one; take the oldest,
			// which is the one they created at sign-up.
			const household = households[0];
			if (!household) throw new Error("This account doesn't belong to a household yet.");
			setSession({ token, householdId: household.id, householdName: household.name, demo: false });
			await goto('/');
		} catch (e) {
			error = e instanceof Error ? e.message : 'Something went wrong';
		} finally {
			busy = null;
		}
	}

	/** @param {{ email: string, password: string, householdName: string }} body */
	async function register(body) {
		busy = 'register';
		error = null;
		try {
			// Registering signs the user in: the response carries a token and their new household.
			const { token, household } = await api('/auth/register', { method: 'POST', body });
			setSession({ token, householdId: household.id, householdName: household.name, demo: false });
			// A new household has no library cards yet; finishing setup means filing one.
			await goto('/cards');
		} catch (e) {
			// The rate limiter answers with plain text, not the API's usual { error } JSON.
			error =
				e instanceof ApiError && e.status === 429
					? 'Too many sign-ups from this network. Try again in an hour.'
					: e instanceof Error
						? e.message
						: 'Something went wrong';
		} finally {
			busy = null;
		}
	}
</script>

<SignInCard
	{tab}
	onTab={selectTab}
	onDemo={tryDemo}
	onLogin={login}
	onRegister={register}
	{busy}
	{error}
/>
