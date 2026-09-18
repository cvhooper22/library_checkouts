import { ApiError, api } from './api.js';

const POLL_MS = 3000;
// Past this we stop watching and let the user reload on their own; the worker may
// be backed up or down, and its run row would otherwise sit at "running" forever.
const GIVE_UP_MS = 3 * 60 * 1000;

/**
 * @typedef {'idle' | 'ready' | 'partial' | 'slow' | 'failed'} RefreshOutcome
 *   How a pull ended. `idle`: there was nothing to pull. `ready`: every run succeeded. `partial`:
 *   some succeeded, some failed. `slow`: we stopped waiting. `failed`: every run failed.
 *   `ready` and `partial` mean new data is in, so the caller reloads it.
 * @typedef {Exclude<RefreshOutcome, 'ready'> | 'running'} RefreshPhase
 *   What the card shows. `ready` is never shown: the caller reloads and returns to `idle`, where
 *   "Pulled just now" is the confirmation. `partial` sticks around after that reload as a warning.
 */

/** @type {Record<Exclude<RefreshPhase, 'idle'>, string>} */
const LABELS = {
	running: 'Pulling — may take a minute',
	partial: 'Some cards failed — try again',
	slow: 'Still working…',
	failed: 'Pull failed — try again'
};

/** @param {RefreshPhase} phase  the footer line for a refresh in flight or just finished */
export const refreshLabel = (phase) => (phase === 'idle' ? null : LABELS[phase]);

/** @param {RefreshPhase} phase  whether we gave up waiting, so the user has to reload themselves */
export const canReload = (phase) => phase === 'slow';

/** @param {number} ms @param {AbortSignal} signal */
const sleep = (ms, signal) =>
	new Promise((resolve) => {
		const timer = setTimeout(resolve, ms);
		signal.addEventListener('abort', () => (clearTimeout(timer), resolve(undefined)), { once: true });
	});

/**
 * Enqueues a scrape for one card, or every card in the household when `accountId` is null, and
 * resolves once all of those runs have finished (or we give up waiting). The worker runs jobs
 * one at a time, so several cards take several times as long as one.
 *
 * @param {{ token: string, householdId: string, accountId: string | null, signal: AbortSignal }} opts
 * @returns {Promise<RefreshOutcome>}
 * @throws {ApiError}  a 4xx (expired token, not a member…) or a failure to enqueue; network
 *   errors and 5xx while polling are retried until we give up
 */
export async function refreshAccounts({ token, householdId, accountId, signal }) {
	// The checkouts list only knows about cards with something out, so ask for the cards themselves.
	/** @type {string[]} */
	const ids = accountId
		? [accountId]
		: (await api(`/households/${householdId}/accounts`, { token })).accounts.map(
				(/** @type {{ id: string }} */ a) => a.id
			);

	if (ids.length === 0) return 'idle'; // no cards, nothing to pull

	/** @type {string[]} */
	const runIds = await Promise.all(
		ids.map(async (id) => (await api(`/accounts/${id}/refresh`, { method: 'POST', token })).runId)
	);

	const deadline = Date.now() + GIVE_UP_MS;
	let pending = runIds;
	let failed = 0;

	while (pending.length && !signal.aborted) {
		if (Date.now() > deadline) return 'slow';
		await sleep(POLL_MS, signal);
		if (signal.aborted) break;

		/** @type {{ id: string, status: string }[]} */
		let runs;
		try {
			({ runs } = await api(`/households/${householdId}/runs?ids=${pending.join(',')}`, { token }));
		} catch (e) {
			// A 4xx won't fix itself on the next tick; a network error or 5xx might.
			if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
			continue;
		}

		const status = new Map(runs.map((r) => [r.id, r.status]));
		// A run the API doesn't return can't finish, so it counts as failed rather than polling forever.
		const settled = pending.filter((id) => status.get(id) !== 'running');
		failed += settled.filter((id) => status.get(id) !== 'success').length;
		pending = pending.filter((id) => status.get(id) === 'running');
	}

	if (failed === 0) return 'ready';
	return failed === runIds.length ? 'failed' : 'partial';
}
