# Feature flags in the database

Not started. Today's flags are env vars on the API (`api/src/features.js`), which
is the right size for one flag. This is the follow-up if flipping them through
Render's dashboard starts to get in the way.

## Where this stands right now

- One flag, `refresh`, read from `REFRESH_ENABLED` (opt-in: on only when exactly `true`).
- `requireFeature('refresh')` guards `POST /accounts/:id/refresh`; `GET /features` tells the frontend, which reads it on every dashboard load and disables the Re-stamp button when it's off.
- Changing a flag means editing the env var on Render, which restarts the API (about a minute). No rebuild, no frontend redeploy.

## What the database version would add

- **Flip without touching Render or restarting anything.** A toggle on the local scrape admin page (`worker/admin/`), which already has database access.
- **Per-household rollout.** Turn refresh on for one household before everyone. Env vars can only be global.
- **A record of changes.** `updated_at` on each flag, or a small history table, for "who turned this on and when".

## Sketch

A `feature_flags` table:

| column | notes |
|---|---|
| `key` | text primary key, e.g. `refresh` |
| `enabled` | boolean, the global default |
| `household_ids` | optional `uuid[]` override list, only if per-household rollout is wanted |
| `updated_at` | timestamptz |

`api/src/features.js` already exposes the three functions everything calls
(`isEnabled`, `allFlags`, `requireFeature`), so callers shouldn't change. What does:

- `isEnabled(flag, { householdId })` becomes async, so `requireFeature` and `GET /features` need `await`. `requireFeature` can take the household from `req.account.householdId`, which `requireAccountAccess` sets.
- Cache the table in memory for a few seconds (5–10s). Flags are read on every guarded request; the table is a handful of rows and shouldn't add a query to each one.
- `GET /features` needs the caller's household to resolve per-household overrides. `/households/:id/checkouts` and the dashboard already know it, so pass it as `?householdId=` or derive it from the token's membership.
- Keep the env var as a fallback for a flag with no row, so a fresh database behaves like today and the guide's env table stays true until rows exist.

## Decisions to make first

- **Fail closed or open when the flags table can't be read?** Env flags can't fail. A database read can. For `refresh`, closed (off) is the safe answer; a flag guarding something users depend on may want the opposite.
- **Is per-household worth the added shape?** If flags will only ever be global, skip `household_ids` and keep this to a two-column table.
- **Who can flip them?** The local admin page is the only writer today, and it's local-only by design. Anything hosted needs auth first.

## Not worth it if

There's still just the one flag and it changes a few times a year. The env var
version costs nothing to keep. Reach for this when flips become frequent or a
flip needs to be scoped to some households.
