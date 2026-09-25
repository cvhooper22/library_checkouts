<script>
	import { goto, invalidateAll } from '$app/navigation';
	import { ApiError, api } from '$lib/api.js';
	import { startConnect } from '$lib/calendar.js';
	import { GOOGLE_CLIENT_ID } from '$lib/config.js';
	import { signInWithGoogle } from '$lib/google.js';
	import CalendarSection from '$lib/components/CalendarSection.svelte';
	import CardsRegister from '$lib/components/CardsRegister.svelte';
	import SignInSection from '$lib/components/SignInSection.svelte';
	import { clearSession, setSession } from '$lib/session.js';

	let { data } = $props();

	/** @type {string | null} */
	let error = $state(null);

	/**
	 * Files a new card. The card number and PIN are the library login, which the API encrypts before
	 * storing; the borrower name becomes the account's display name (one borrower per card).
	 * @param {import('$lib/cards.js').NewCard} card
	 * @returns {Promise<boolean>}  whether the card was filed
	 */
	async function addCard({ libraryId, cardNumber, pin, displayName }) {
		error = null;
		try {
			await api(`/households/${data.session.householdId}/accounts`, {
				method: 'POST',
				token: data.session.token,
				body: { libraryId, displayName, credentials: { username: cardNumber, pin } }
			});
			await invalidateAll();
			return true;
		} catch (e) {
			if (e instanceof ApiError && e.status === 401) {
				clearSession();
				await goto('/signin');
			} else {
				error = e instanceof Error ? e.message : 'Something went wrong';
			}
			return false;
		}
	}

	/**
	 * Soft-deletes a card (the register has already asked "are you sure").
	 * @param {string} accountId
	 * @returns {Promise<string | null>}  an error message, or null once it's gone
	 */
	async function removeCard(accountId) {
		try {
			await api(`/accounts/${accountId}`, { method: 'DELETE', token: data.session.token });
			await invalidateAll();
			return null;
		} catch (e) {
			if (e instanceof ApiError && e.status === 401) {
				clearSession();
				await goto('/signin');
				return null;
			}
			// A 404 means it was already removed (another tab); the reload below drops the row.
			if (e instanceof ApiError && e.status === 404) {
				await invalidateAll();
				return null;
			}
			return e instanceof Error ? e.message : 'Something went wrong';
		}
	}

	/**
	 * @param {string} name
	 * @returns {Promise<string | null>}  an error message, or null once it's saved
	 */
	async function renameHousehold(name) {
		try {
			const { household } = await api(`/households/${data.session.householdId}`, {
				method: 'PATCH',
				token: data.session.token,
				body: { name }
			});
			// Session, not just this page's data: the household name lives in localStorage
			// so it also shows up back on the checkouts page without a fresh /me lookup.
			setSession({ ...data.session, householdName: household.name });
			await invalidateAll();
			return null;
		} catch (e) {
			if (e instanceof ApiError && e.status === 401) {
				clearSession();
				await goto('/signin');
				return null;
			}
			return e instanceof Error ? e.message : 'Something went wrong';
		}
	}

	/**
	 * Runs one Set up section action (calendar, sign-in). Same contract as the register’s: an error message, or null
	 * once it's done (an expired sign-in goes back to /signin instead).
	 * @param {() => Promise<unknown>} action
	 * @returns {Promise<string | null>}
	 */
	async function sectionAction(action) {
		try {
			await action();
			return null;
		} catch (e) {
			if (e instanceof ApiError && e.status === 401) {
				clearSession();
				await goto('/signin');
				return null;
			}
			return e instanceof Error ? e.message : 'Something went wrong';
		}
	}

	const calendarPath = () => `/households/${data.session.householdId}/calendar`;

	// Leaves for Google on success; /calendar/callback brings the user back here.
	const connectCalendar = () => sectionAction(() => startConnect(data.session));

	/** @param {{ reminderTime?: number, timeZone?: string, showTitles?: boolean }} changes */
	const saveCalendar = (changes) =>
		sectionAction(async () => {
			await api(calendarPath(), { method: 'PATCH', token: data.session.token, body: changes });
			await invalidateAll();
		});

	/** @param {boolean} deleteCalendar */
	const disconnectCalendar = (deleteCalendar) =>
		sectionAction(async () => {
			await api(`${calendarPath()}?deleteCalendar=${deleteCalendar}`, { method: 'DELETE', token: data.session.token });
			await goto('/cards?calendar=disconnected', { invalidateAll: true, replaceState: true });
		});

	// Same error contract as the calendar’s. Google's prompt runs first, so a dismissed or
	// blocked prompt comes back as its message without touching the API.
	const linkGoogle = () =>
		sectionAction(async () => {
			const idToken = await signInWithGoogle();
			await api('/me/google', { method: 'POST', token: data.session.token, body: { idToken } });
			await invalidateAll();
		});

	const unlinkGoogle = () =>
		sectionAction(async () => {
			await api('/me/google', { method: 'DELETE', token: data.session.token });
			await invalidateAll();
		});
</script>

{#snippet sections()}
	{#if data.showCalendar}
		<CalendarSection
			calendar={data.calendar}
			notice={data.calendarNotice}
			onConnect={connectCalendar}
			onSave={saveCalendar}
			onDisconnect={disconnectCalendar}
		/>
	{/if}
	{#if data.user}
		<SignInSection
			email={data.user.email}
			hasPassword={data.user.hasPassword}
			googleLinked={data.user.googleLinked}
			googleAvailable={Boolean(GOOGLE_CLIENT_ID)}
			onLink={linkGoogle}
			onUnlink={unlinkGoogle}
		/>
	{/if}
{/snippet}

<CardsRegister
	accounts={data.accounts}
	libraries={data.libraries}
	householdName={data.session.householdName}
	readOnly={data.session.demo}
	startOpen={data.accounts.length === 0 && !data.session.demo}
	{error}
	onAdd={addCard}
	onRemove={removeCard}
	onRenameHousehold={renameHousehold}
	onCheckouts={() => goto('/')}
	{sections}
/>
