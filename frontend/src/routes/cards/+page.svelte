<script>
	import { goto, invalidateAll } from '$app/navigation';
	import { ApiError, api } from '$lib/api.js';
	import CardsRegister from '$lib/components/CardsRegister.svelte';
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
</script>

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
/>
