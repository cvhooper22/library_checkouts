import { api } from './api.js';

/**
 * @typedef {{
 *   reminderTime: number,
 *   timeZone: string,
 *   showTitles: boolean,
 *   enabled: boolean,
 *   lastSyncedAt: string | null,
 *   lastError: string | null,
 *   connectedBy: string,
 *   isYou: boolean
 * }} CalendarStatus  GET /households/:id/calendar's `calendar` (null when nothing is connected)
 */

// Connecting runs through Google and back to /calendar/callback. The PKCE verifier and the
// state stay in this tab's sessionStorage the whole time, so only the browser that started
// a connection can finish it (api/src/routes/calendar.js explains the other half).
const PENDING_KEY = 'dd.calendarConnect';

/** @param {Uint8Array} bytes */
function base64url(bytes) {
	return btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

/**
 * Asks the API for Google's consent URL and goes there.
 * @param {{ token: string, householdId: string }} session
 */
export async function startConnect({ token, householdId }) {
	const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
	const { url, state } = await api(`/households/${householdId}/calendar/connect/start`, {
		method: 'POST',
		token,
		body: { codeChallenge: base64url(new Uint8Array(digest)) }
	});
	try {
		sessionStorage.setItem(PENDING_KEY, JSON.stringify({ state, verifier, householdId }));
	} catch {
		throw new Error('Connecting needs this browser to allow site storage. Allow it, then try again.');
	}
	window.location.assign(url);
}

/**
 * Finishes a connection on /calendar/callback. The stored attempt is used once and cleared,
 * whatever happens; a `state` that isn't the one this tab stored is refused before the API
 * ever sees the code.
 * @param {{ token: string, householdId: string, code: string, state: string }} args
 * @returns {Promise<CalendarStatus>}
 */
export async function finishConnect({ token, householdId, code, state }) {
	let pending = null;
	try {
		pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null');
		sessionStorage.removeItem(PENDING_KEY);
	} catch {
		// unreadable storage: treated as no attempt below
	}
	if (!pending || pending.state !== state || pending.householdId !== householdId) {
		throw new Error('This connection wasn’t started in this browser tab. Start again from Set up.');
	}
	const { calendar } = await api(`/households/${householdId}/calendar/connect/finish`, {
		method: 'POST',
		token,
		body: { code, state, verifier: pending.verifier, timeZone: browserTimeZone() }
	});
	return calendar;
}

export function browserTimeZone() {
	return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Every IANA zone the browser knows, with `current` kept in the list even if it doesn't.
 * @param {string} current
 */
export function timeZones(current) {
	/** @type {string[]} */
	let zones = [];
	try {
		zones = Intl.supportedValuesOf('timeZone');
	} catch {
		// older browsers: the saved zone alone still renders
	}
	return zones.includes(current) ? zones : [current, ...zones];
}

// The API only accepts reminder times on the half hour (0, 30, … 1410 minutes after midnight).
export const HALF_HOURS = Array.from({ length: 48 }, (_, i) => i * 30);

/** @param {number} minutes  after midnight, e.g. 480 -> "8:00 AM" */
export function formatMinutes(minutes) {
	const h = Math.floor(minutes / 60);
	const m = String(minutes % 60).padStart(2, '0');
	return `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}
