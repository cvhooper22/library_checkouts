# Test scrapers

Roadmap for local-only fixtures that exercise the queue → worker → frontend path
without a live library. This folder (`roadmap/dev/`) is for dev tooling and
testing ideas that aren't user-facing features; product roadmap docs stay in
`roadmap/`.

## Where this stands right now

Done, and verified against a local worker, Postgres and Redis:

| Scraper | What it does | Path it exercises |
|---|---|---|
| `test-success` | Random 1–5s wait, then 2–8 checkouts from a fixed pool | Normal pull; carried-over, returned and new checkouts |
| `test-failure` | Throws after 1s | Failed run; existing checkouts kept; "Pull failed" |
| `test-partial-errors` | Returns checkouts **and** a non-empty `errors` array | Worker treats it as failed and applies none of it |
| `test-empty` | Succeeds with zero checkouts | Everything marked returned; card's tab disappears |
| `test-hang` | Waits 200s, then succeeds | Frontend gives up at 3 min: "Still working…" + Reload |

- Scrapers live in `worker/src/scrapers/test-*.js` and are registered only when `NODE_ENV !== 'production'`.
- `worker/scripts/test-fixtures.json` holds the libraries and cards (fixed ids); `npm run seed-test-fixtures` in `worker/` applies it idempotently. Run `npm run seed` in `db/` first. `-- --reset` puts the cards back to their starting checkouts.
- The `test-hang` card ships `"enabled": false`: the worker runs one job at a time, so while it hangs every other pull queues behind it (including the whole "All" tab). Flip it to `true` and re-run the seed script to use it.

## Still to add

Roughly in order of usefulness.

- [ ] **`test-flaky`** — fails about half the time (`config.failRate`, default 0.5).
      Gives repeatable *partial* results on the "All" tab without depending on two
      fixed-failure cards, and exercises retry-by-clicking-again.
- [ ] **Sequenced scraper** (`test-sequence`) — returns a scripted list per pull
      number (e.g. pull 1: A, B, C; pull 2: B, D; pull 3: none), with the pull
      counter kept in `scraperConfig` or derived from the account's run count.
      Unlike `test-success`'s randomness, it lets returned-detection be asserted
      exactly. This is the one to build first if automated tests get written.
- [ ] **`test-invalid-shape`** — returns a malformed result (missing `dueDate`,
      wrong types) to trigger the `validate.js` failure and confirm nothing is
      written when the shape is wrong.
- [ ] **`test-crash`** — kills the worker process mid-job. The run row is left at
      `running` forever, because nothing recovers stale runs. This is a real gap
      in the design, not just a test convenience; the fix (a sweeper that fails
      runs stuck past some age, or BullMQ stalled-job handling wired to the run
      row) belongs in the product code, and this scraper would be its test.
- [ ] **`test-many`** — returns 60+ checkouts, for layout and scroll testing of
      the ledger, and for seeing how long a large upsert takes.

## Ideas that need a decision first

- [ ] **Per-account tab state.** The refresh state lives on the page, not per tab,
      so a failure on one card still shows on another card's tab until the next
      pull. Not a test-scraper item, but the fixtures make it easy to see.
- [ ] **Login-failure scraper.** Throws "Invalid card number or PIN" to test
      surfacing a *reason*. Today the frontend only knows failed/succeeded; the
      message is in `runs.error`, and nothing shows it. Worth building only if
      the UI is going to show it.
