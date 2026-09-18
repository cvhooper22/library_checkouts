# Demo environment

## Where this stands right now

Branch: `demo`. **Nothing below is committed** — it's all uncommitted working-tree
state on this branch as of 2026-09-18. Treat it as a working prototype of the
idea, not a design to build further on as-is (see "Planned direction" below).

What's there and manually verified end-to-end against a local Postgres/Redis:

- `Household.isDemo` boolean + migration (`db/prisma/migrations/20260918033026_add_household_is_demo`)
- `worker/src/scrapers/demo.js` — synthetic scraper, registered in `REGISTRY`, but never dispatched via the queue
- `worker/scripts/reseed-demo.js` — idempotent: creates the demo user/household/library/accounts on first run, full-replaces their `runs`/`checkouts` every run
- `worker/src/enqueueDaily.js` — excludes accounts whose household is demo
- `api/` — the demo layer on top of the Express API: JWT auth (`/auth/demo`, alongside `/auth/login`), a single `demoReadOnly` middleware chokepoint that 403s any non-`GET` request carrying a `demo: true` token claim, plus `/households/:id/checkouts`, `/accounts/:id/runs`, `/accounts/:id/status`, `/accounts/:id/refresh`, `/households/:id/accounts`
- `adr/0002-demo-mode.md` — records the shared-household, read-only, never-enqueued design
- `render-deployment-guide.html` — updated with a second, independent cron job (Phase 8) for the reseed script

Verified live: demo login returns a token → checkouts load → `/refresh` and
`/households/:id/accounts` both return 403 for that token → daily enqueue
skips the demo account entirely.

## Planned direction: separate Neon-backed demo deployment

Talking it through further, the `isDemo` column approach has real downsides
that a schema flag can't fully fix:

- It's a one-off column on `Household` that exists for exactly one purpose.
- The frontend still has to know *something* — a demo household/account ID —
  to know it's in demo mode, which means hardcoding it client-side.
- Read-only enforcement depends on every request correctly carrying and
  checking a `demo` claim. Renaming it to something reusable like `isActive`
  doesn't remove that dependency, it just relabels it.

Decided direction instead: **a fully separate demo deployment**, not a flag in
the shared schema.

- Own Postgres — via **Neon's free tier**, not a second Render Postgres.
  Render's free Postgres expires 30 days after creation (14-day grace period,
  then hard delete) and only one is allowed per workspace — a bad fit for
  something meant to just sit there indefinitely. Neon's free tier doesn't
  expire, is plain Postgres (no Prisma/schema changes, just a different
  `DATABASE_URL`), and scales to zero when idle, which fits a rarely-visited
  demo well.
- Own API deploy, same codebase as prod, pointed at the Neon `DATABASE_URL`.
  Read-only enforcement becomes unconditional (reject any non-`GET`, no claim
  to check) since nothing else runs on that deployment — no `isDemo` column
  needed at all.
- No Redis, no Background Worker for demo — it never scrapes, so there's
  nothing to enqueue. `reseed-demo.js` runs as a plain cron job hitting
  Postgres directly, same as today, just against Neon instead of Render's
  Postgres.
- Frontend for demo is the same build as prod, just configured (env var, not
  hardcoded) to call the demo API's URL. It never needs to know a household ID
  — the demo API's login just hands back whatever's seeded there.

### Follow-up work this implies

- [ ] Roll back `Household.isDemo` (column + migration) once the separate
      deployment replaces it — don't carry it forward into prod's schema.
- [ ] Provision a Neon project for demo; point `worker/scripts/reseed-demo.js`
      and the demo API's `DATABASE_URL` at it instead of Render Postgres.
- [ ] Simplify `demoReadOnly` in `api/src/auth/middleware.js` to an unconditional
      env-driven `READ_ONLY_MODE` check — drop the `demo` JWT claim and the
      distinction between `/auth/login` and `/auth/demo` (the demo deployment
      only ever has one seeded user, so a no-credential login is the only
      login it needs).
- [ ] Write an ADR superseding `adr/0002-demo-mode.md` with the separate-
      deployment design (or revise it in place — TBD which reads better once
      it's written).
- [ ] Update `render-deployment-guide.html` Phase 8 — replace "second Render
      Postgres" guidance with Neon project setup, and document the demo API/
      frontend as their own Render services pointed at Neon.
