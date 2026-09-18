import { error, redirect } from '@sveltejs/kit';
import { ApiError, api } from '$lib/api.js';
import { clearSession, getSession } from '$lib/session.js';

export async function load() {
	const session = getSession();
	if (!session) redirect(307, '/signin');

	try {
		const [{ accounts }, { libraries }] = await Promise.all([
			api(`/households/${session.householdId}/accounts`, { token: session.token }),
			api('/libraries', { token: session.token })
		]);
		return { accounts, libraries, session };
	} catch (e) {
		if (!(e instanceof ApiError)) throw e;
		// Expired or invalid token: back to sign-in.
		if (e.status === 401) {
			clearSession();
			redirect(307, '/signin');
		}
		error(e.status || 503, e.message);
	}
}
