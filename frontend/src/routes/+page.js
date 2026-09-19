import { error, redirect } from '@sveltejs/kit';
import { ApiError, api } from '$lib/api.js';
import { fromApi } from '$lib/checkouts.js';
import { clearSession, getSession } from '$lib/session.js';

export async function load() {
	const session = getSession();
	if (!session) redirect(307, '/signin');

	try {
		const [{ checkouts }, { features }] = await Promise.all([
			api(`/households/${session.householdId}/checkouts`, { token: session.token }),
			// Fails closed: if the flags can't be read (e.g. an older API), optional features stay off.
			api('/features', { token: session.token }).catch(() => ({ features: {} }))
		]);
		return { ...fromApi(checkouts), session, features };
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
