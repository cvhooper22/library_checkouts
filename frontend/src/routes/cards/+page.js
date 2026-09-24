import { error, redirect } from '@sveltejs/kit';
import { ApiError, api } from '$lib/api.js';
import { clearSession, getSession } from '$lib/session.js';

// What /calendar/callback reports back with ?calendar=…
const CALENDAR_NOTICES = {
	connected: 'Google Calendar connected. Your reminder will be on it shortly.',
	reconnected: 'Google Calendar reconnected.',
	disconnected: 'Google Calendar disconnected.'
};

export async function load({ url }) {
	const session = getSession();
	if (!session) redirect(307, '/signin');

	try {
		const [{ accounts }, { libraries }, { features }] = await Promise.all([
			api(`/households/${session.householdId}/accounts`, { token: session.token }),
			api('/libraries', { token: session.token }),
			// Fails closed: if the flags can't be read (e.g. an older API), optional features stay off.
			api('/features', { token: session.token }).catch(() => ({ features: {} }))
		]);
		// The demo household never connects a calendar, so it doesn't get the section at all.
		const showCalendar = Boolean(features.calendar) && !session.demo;
		const { calendar } = showCalendar
			? await api(`/households/${session.householdId}/calendar`, { token: session.token })
			: { calendar: null };
		const notice = CALENDAR_NOTICES[/** @type {keyof typeof CALENDAR_NOTICES} */ (url.searchParams.get('calendar'))] ?? null;
		return { accounts, libraries, session, showCalendar, calendar, calendarNotice: notice };
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
