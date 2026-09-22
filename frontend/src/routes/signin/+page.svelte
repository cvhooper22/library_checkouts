<script>
	import { goto } from '$app/navigation';
	import { ApiError, api } from '$lib/api.js';
	import SignInCard from '$lib/components/SignInCard.svelte';
	import { signInWithGoogle } from '$lib/google.js';
	import { setSession } from '$lib/session.js';

	/** @type {'signin' | 'create'} */
	let tab = $state('signin');
	/** @type {'demo' | 'login' | 'register' | 'google' | null} */
	let busy = $state(null);
	/** @type {string | null} */
	let error = $state(null);

	/** @param {string} id */
	function selectTab(id) {
		tab = id === 'create' ? 'create' : 'signin';
		error = null;
	}

	// Demo, register and email login are wired up. Demo and register get a household back with the
	// token; /auth/login and /auth/google return only a token, so both follow up with GET /me.
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

	// Shared by /auth/login and /auth/google: both hand back only a token, so the household
	// to sign into comes from a follow-up GET /me.
	/** @param {string} token */
	async function establishSession(token) {
		const { households } = await api('/me', { token });
		// A user can belong to several households but the app shows one; take the oldest,
		// which is the one they created at sign-up.
		const household = households[0];
		if (!household) throw new Error("This account doesn't belong to a household yet.");
		setSession({ token, householdId: household.id, householdName: household.name, demo: false });
		await goto('/');
	}

	/** @param {{ email: string, password: string }} body */
	async function login(body) {
		busy = 'login';
		error = null;
		try {
			const { token } = await api('/auth/login', { method: 'POST', body });
			await establishSession(token);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Something went wrong';
		} finally {
			busy = null;
		}
	}

	async function loginWithGoogle() {
		busy = 'google';
		error = null;
		try {
			const idToken = await signInWithGoogle();
			const { token } = await api('/auth/google', { method: 'POST', body: { idToken } });
			await establishSession(token);
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
	onGoogle={loginWithGoogle}
	{busy}
	{error}
/>
