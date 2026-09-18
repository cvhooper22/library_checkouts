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
 * @throws {ApiError}  a 401 (expired token) or a failure to enqueue; polling hiccups are retried
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

	const runs = await Promise.all(
		ids.map(async (id) => ({
			accountId: id,
			runId: (await api(`/accounts/${id}/refresh`, { method: 'POST', token })).runId
		}))
	);

	const deadline = Date.now() + GIVE_UP_MS;
	let pending = runs;
	let failed = 0;

	while (pending.length && !signal.aborted) {
		if (Date.now() > deadline) return 'slow';
		await sleep(POLL_MS, signal);
		if (signal.aborted) break;

		const results = await Promise.all(
			pending.map(async (run) => {
				try {
					const { latestRun } = await api(`/accounts/${run.accountId}/status`, { token });
					// A newer run means ours was already picked up and finished ahead of it.
					if (latestRun?.id !== run.runId) return { run, done: true, ok: true };
					return { run, done: latestRun.status !== 'running', ok: latestRun.status === 'success' };
				} catch (e) {
					if (e instanceof ApiError && e.status === 401) throw e;
					return { run, done: false, ok: true }; // network blip: try again next tick
				}
			})
		);

		failed += results.filter((r) => r.done && !r.ok).length;
		pending = results.filter((r) => !r.done).map((r) => r.run);
	}

	if (failed === 0) return 'ready';
	return failed === runs.length ? 'failed' : 'partial';
}
