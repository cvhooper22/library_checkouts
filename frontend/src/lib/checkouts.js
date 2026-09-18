/**
 * @typedef {{ id: string, name: string }} AccountTab
 * @typedef {{ id: string, title: string, accountId: string, borrower: string, due: string }} CheckoutItem
 *   `due` is YYYY-MM-DD.
 * @typedef {{ id: string, title: string, dueDate: string, lastSeenAt: string, account: { id: string, displayName: string } }} ApiCheckout
 *   One element of `checkouts` in GET /households/:id/checkouts.
 */

export const pad2 = (/** @type {number} */ n) => String(n).padStart(2, '0');

/** @param {number} days  days until due; negative = overdue */
export function bucketOf(days) {
	if (days < 0) return 'overdue';
	return days <= 7 ? 'week' : 'later';
}

/**
 * The API has no accounts endpoint yet, so tabs are derived from the checkouts
 * themselves (in due order). An account with nothing out gets no tab.
 * `updatedAt` (for "Pulled N min ago") is the newest `lastSeenAt`: the last time a run
 * confirmed any of these rows. There's no per-household last-run endpoint yet.
 * @param {ApiCheckout[]} checkouts
 * @returns {{ items: CheckoutItem[], accounts: AccountTab[], updatedAt: Date | null }}
 */
export function fromApi(checkouts) {
	/** @type {Map<string, AccountTab>} */
	const accounts = new Map();
	const items = checkouts.map((c) => {
		accounts.set(c.account.id, { id: c.account.id, name: c.account.displayName });
		return {
			id: c.id,
			title: c.title,
			accountId: c.account.id,
			borrower: c.account.displayName,
			// dueDate is a date-only column serialized as midnight UTC; the date part is the due date.
			due: c.dueDate.slice(0, 10)
		};
	});
	const seen = checkouts.map((c) => Date.parse(c.lastSeenAt));
	const updatedAt = seen.length ? new Date(Math.max(...seen)) : null;
	return { items, accounts: [...accounts.values()], updatedAt };
}

/**
 * @param {Date | null} updatedAt
 * @param {Date} now
 * @param {boolean} refreshing
 */
export function pulledLabel(updatedAt, now, refreshing) {
	if (refreshing) return 'Pulling records…';
	if (!updatedAt) return 'Never pulled';
	const mins = Math.round((now.getTime() - updatedAt.getTime()) / 60000);
	if (mins <= 0) return 'Pulled just now';
	if (mins < 60) return `Pulled ${mins} min ago`;
	const hrs = Math.round(mins / 60);
	return hrs === 1 ? 'Pulled 1 hr ago' : `Pulled ${hrs} hrs ago`;
}
