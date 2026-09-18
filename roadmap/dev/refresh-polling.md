# Refresh polling: known gaps

Follow-ups for the on-demand re-stamp flow: `frontend/src/lib/refresh.js` enqueues
a scrape per card and polls `GET /households/:id/runs?ids=…` until every run
settles (see `architecture.md` §6). Nothing here is broken today; these are
couplings and rough edges to know about before changing the surrounding code.

## Where this stands right now

- One poll request per tick for any number of cards; each run is judged by its own row (`running` / `success` / `failed`).
- 4xx while polling ends the pull immediately; network errors and 5xx are retried until the 3-minute give-up.
- A run the API doesn't return counts as failed.

## Retries would break the "failed is final" assumption

The client treats `failed` as the end of a run. That's true only because no
retries are configured: `enqueueRefresh` (`api/src/queue.js`) calls `queue.add`
with no options, so BullMQ's default of one attempt applies, even though the
worker's `catch` rethrows "so BullMQ's retry policy applies" (`worker/src/index.js`).

If retries are ever turned on (`attempts` / `backoff` on the job or as
`defaultJobOptions` on the queue), on-demand pulls go wrong:

1. Attempt 1 fails. The worker's `catch` writes `status: 'failed'`, `finishedAt` and `error`, then rethrows.
2. The next poll sees `failed` and the frontend reports "Pull failed", possibly reloading nothing.
3. BullMQ starts attempt 2 and the worker does `prisma.run.update({ status: 'running' })` on the **same** run row (that's how a caller-supplied `runId` is handled). It doesn't clear `finishedAt` or `error`, so the row briefly reads `running` with a stale error and end time.
4. Attempt 2 succeeds and the data changes, but the UI already gave up and nothing tells it to reload.

The daily cron path (`enqueueDaily.js`) sends no `runId`, so each attempt there
creates a fresh run row. Only the on-demand path has this coupling.

**Likely fix:** make the worker mark a run `failed` only on the *final* attempt.
On an earlier attempt, leave it `running` and just record the error, so the
client's existing "still `running` means keep waiting" rule holds and needs no
change. The check is `job.attemptsMade` against `job.opts.attempts`; confirm the
exact off-by-one semantics for the installed BullMQ version before relying on it.
Either way, reset `finishedAt` and `error` whenever a run goes back to `running`.

Avoid introducing a new status like `retrying` unless the client is updated in
the same change: `refresh.js` currently counts any status other than `running`
as settled, and anything other than `success` as failed.

**Test:** `test-flaky` (see `test-scrapers.md`) plus `attempts: 3` on the queue
exercises this end to end.

- [ ] Decide whether on-demand pulls should retry at all. A user is watching a
      spinner, so a fast, clear failure may be better than a silent retry.
- [ ] If yes: final-attempt-only `failed`, reset `finishedAt`/`error` on re-run, add a test.

## Other open items

- [ ] **`slow` doesn't cancel anything.** After the 3-minute give-up the job is
      still in Redis. If the worker comes back it finishes later, and the page
      won't notice until the next reload. Options: leave it (Reload button
      covers it), or have the page resume polling when the tab regains focus.
- [ ] **Abort listener leak in `sleep`.** Each 3s tick adds an `abort` listener
      to the shared signal that is only removed on abort, so a long pull
      accumulates up to ~60. Harmless (released with the page); fix by removing
      the listener when the timer fires.
- [ ] **Stale `running` runs after a worker crash.** Nothing sweeps them, so a
      crash leaves a run at `running` forever. The client's 3-minute give-up
      hides this, but the row stays wrong. See `test-crash` in `test-scrapers.md`.
