# 2. Demo mode: one shared, read-only household that never reaches the scrape queue

Date: 2026-09-17

## Status

Accepted

## Context

The product wants a "Try it out" button on the login page: a visitor clicks it and lands straight in a populated dashboard, no signup or credentials required.

Two shapes were considered:

- **Ephemeral per-visitor sandbox** — each click clones a fresh demo household so visitors are isolated and can freely interact (add an account, trigger a refresh). Requires a real write on every click plus a cleanup job for abandoned ones.
- **One shared, read-only demo household** — seeded once, reset periodically, every visitor sees the same data. No per-click writes.

Chosen: the shared, read-only household. It has one real cost — concurrent visitors share state, so nothing on the demo path can mutate anything — but it avoids a write-and-cleanup cycle on every anonymous click, which matters given the next constraint.

The queue and worker pool (architecture.md §5) are shared infrastructure sized for real accounts' scheduled and on-demand scrapes. A public, credential-less entry point must never be able to land a job on that queue — not because the `demo` scraper is expensive, but because "any anonymous visitor can repeatedly trigger an enqueue" is a resource/abuse surface regardless of how cheap the job itself is.

The leverage point that makes any of this cheap: architecture.md already decided the API reads `checkouts` directly from Postgres, decoupled from how the row got there (§4). Demo data can be plain seeded rows; the read path needs no changes.

## Decision

1. **`Household.isDemo`** (boolean, default `false`) marks the one canonical demo household. It lives on `Household`, not `Account` or `User`, because Household is the unit the API token scopes to, and it lets a single join filter exclude every demo account from the daily enqueue in one place rather than tagging accounts individually.

2. **A `demo` scraper module is registered like any other** (`worker/src/scrapers/demo.js`, contract per architecture.md §2), but it is never dispatched through BullMQ for the demo household. It exists only to be called in-process by a reseed script. This is how "reuse the scraper contract for realistic data" and "never run live for anonymous traffic" coexist — the module gets exercised, the queue never sees it.

3. **`worker/scripts/reseed-demo.js`** regenerates the demo household's `runs`/`checkouts` end to end (full replace each run, not incremental — there's no real prior state to diff against) by calling `demo.scrape()` directly and writing through the same shape the real worker writes. It runs on its **own schedule as a second, independent Render Cron Job**, never as a BullMQ job type, so it structurally cannot contend with or be mistaken for a real account's scrape.

4. **`enqueueDaily.js` excludes accounts whose household is a demo household.** Without this, the demo account would get swept into the real nightly cron and land on the same queue as everyone else's live scrapes.

5. **`POST /auth/demo`** mints a short-lived JWT for a fixed, seeded demo user with no credential check. Gated behind a `DEMO_MODE_ENABLED` env var (kill switch with no deploy needed) and rate-limited independently of `/auth/login`, since it's a public, no-password way to obtain a valid token and therefore the more attractive target for abuse.

6. **Read-only enforcement is a single global chokepoint, not per-handler checks.** One middleware runs ahead of every route: if the token carries `demo: true` and the request method isn't `GET`, reject with 403. A future mutating endpoint inherits this for free instead of depending on someone remembering to add an `isDemo` check inside it.

## Consequences

- `checkouts.due_date` / `checkouts.overdue` are static values written at scrape time, not computed at read time (architecture.md §4). Left un-reseeded, the demo household's due dates drift into the past and stop looking like a demo. The reseed job's cadence has to keep pace with that drift, not just run "often enough to look active."
- Because the household is shared across every visitor, any future feature needing per-visitor state (marking an item read, a personalized onboarding checklist) does not fit this model and needs a separate carve-out — it is not something this design extends to.
- Disabling demo mode entirely is a one-line env flip (`DEMO_MODE_ENABLED=false`), not a code or schema rollback.
- The middleware is the only place read-only-ness is enforced. A new mutating route is safe by default as long as it sits behind that middleware; it is not safe if something bypasses it.
