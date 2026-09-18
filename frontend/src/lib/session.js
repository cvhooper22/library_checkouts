const KEY = 'dd.session';

/** @typedef {{ token: string, householdId: string, householdName: string, demo: boolean }} Session */

// Kept in memory as well as localStorage so sign-in still works for the tab if storage is blocked.
/** @type {Session | null} */
let current = null;

/** @returns {Session | null} */
export function getSession() {
	if (current) return current;
	try {
		const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
		if (s?.token && s?.householdId) current = s;
	} catch {
		// unreadable or unavailable storage: treat as signed out
	}
	return current;
}

/** @param {Session} session */
export function setSession(session) {
	current = session;
	try {
		localStorage.setItem(KEY, JSON.stringify(session));
	} catch {
		// memory copy above still covers this tab
	}
}

export function clearSession() {
	current = null;
	try {
		localStorage.removeItem(KEY);
	} catch {
		// nothing stored to clear
	}
}

/**
 * Library-card style holder line, e.g. "Demo Household" -> "D. HOUSEHOLD · 4471".
 * The 4-digit number is decorative: a stable hash of the id.
 * @param {string} name
 * @param {string} id
 */
export function holderLine(name, id) {
	const [first = '', ...rest] = name.trim().split(/\s+/);
	const short = rest.length ? `${first[0]}. ${rest.join(' ')}` : first;
	const hash = [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
	return `${short.toUpperCase()} · ${1000 + (hash % 9000)}`;
}

/**
 * The household's holder line, shown when no single account is selected.
 * @param {Pick<Session, 'householdName' | 'householdId'>} s
 */
export function cardHolder({ householdName, householdId }) {
	return holderLine(householdName, householdId);
}
