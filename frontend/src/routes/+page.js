import { error, redirect } from '@sveltejs/kit';
import { ApiError, api } from '$lib/api.js';
import { fromApi } from '$lib/checkouts.js';
import { clearSession, getSession } from '$lib/session.js';

export async function load() {
	const session = getSession();
	if (!session) redirect(307, '/signin');

	try {
		const { checkouts } = await api(`/households/${session.householdId}/checkouts`, {
			token: session.token
		});
		return { ...fromApi(checkouts), session };
	} catch (e) {
		if (!(e instanceof ApiError)) throw e;
		// Expired or invalid token (demo tokens last an hour): back to sign-in.
		if (e.status === 401) {
			clearSession();
			redirect(307, '/signin');
		}
		error(e.status || 503, e.message);
	}
}
