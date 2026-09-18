# Library Checkout Tracker — Architecture Handoff

## 1. Problem statement

Families/households often have multiple library accounts (one per person) and libraries rarely offer a unified view across accounts. This system scrapes each account on a schedule (or on demand), normalizes the data, and powers a frontend showing all checkouts across a household in one place — with the primary goal of surfacing items before they're overdue.

Long-term goal: support arbitrary libraries/accounts contributed by other users, not just the original owner. A user hands over credentials for their library account; the system either finds an API or a new scraper gets written for it; from then on it runs on their schedule.

---

## 2. Core architectural principle

**Accounts are decoupled from scrapers.** An `account` row just references a `scraper_type` string. A registry maps that string to a scraper module implementing a shared contract. This means:

- Adding a new library = write one scraper module + register it. No changes to the queue, worker, scheduler, or API.
- One scraper module can serve many accounts if the library platform is shared (e.g. many US public libraries run BiblioCommons or Koha) — per-account variation (subdomain, org ID) is passed through a `scraper_config` field, not hardcoded into the module.

### Scraper contract

Every scraper module must export:

```js
{
  id: "bibliocommons",           // matches accounts.scraper_type
  async scrape({ credentials, config }) {
    // Puppeteer logic (or a direct API call, if one exists)
    return {
      checkouts: [
        { externalId, title, dueDate, overdue, imgSrc }
      ],
      errors: []
    };
  }
}
```

`externalId` is the scraper's stable identifier for a checked-out item (item ID, barcode, ISBN — whatever the source service exposes as durable), scoped to that account. It's the join key used to match a checkout across runs; scrapers that genuinely have nothing stable to offer can fall back to a `title + dueDate` composite, but should prefer a real ID wherever the source data has one, since title-only matching breaks on duplicate titles or holds re-checked-out with a new due date.

The worker never branches on library type — it looks up the module by `scraper_type`, calls `.scrape()`, and validates the shape of what comes back before writing anything.

---

## 3. High-level system flow

```
Scheduler (cron, daily)  ──┐
                            ├──> Queue (BullMQ/Redis) ──> Worker ──> scraper module ──> validate ──> write to Postgres
On-demand API endpoint  ───┘

Frontend ──> GET /households/:id/checkouts ──> reads Postgres directly (no S3 / no static file layer)
```

Key decision: **no S3 or object storage in the primary data path.** The original design (append/overwrite a JSON blob) was a proxy for a real database. Once Postgres is in place, it's the sole source of truth. Object storage is only used as scratch space for scraper-failure debugging artifacts (see §7), not as a data layer.

---

## 4. Database schema

Postgres (SQLite viable if this stays single-tenant/small — schema is portable either way).

### `households`
Groups people who share a dashboard. Distinct from `accounts`, which are library cards — a person can be a household member without having their own library card, and vice versa.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `name` | text | e.g. "The Smiths" |
| `owner_user_id` | uuid, FK → `users.id` | |
| `is_demo` | boolean, default `false` | marks the one shared, read-only demo household — see adr/0002-demo-mode.md |
| `created_at` | timestamptz | |

### `household_members`
Links login-capable people to a household.

| Column | Type | Notes |
|---|---|---|
| `household_id` | uuid, FK → `households.id` | |
| `user_id` | uuid, FK → `users.id` | |
| `role` | text | `"owner"` \| `"member"` |

### `users`
Standard auth table (not detailed here — see §6, auth is token-based).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `email` | text, unique | |
| `password_hash` | text | or delegate to an auth provider |
| `created_at` | timestamptz | |

### `libraries`
Reference table of known libraries and their default scraper.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `slug` | text, unique | stable public identifier |
| `name` | text | |
| `base_url` | text | |
| `scraper_type_default` | text | FK-like reference to a registry key, not an enforced FK |
| `is_active` | boolean | false hides it from `GET /libraries` without breaking accounts that reference it |
| `city`, `state`, `postal_code` | text, nullable | for filtering; a many-to-many service-area table is the path to real zip lookup |

### `accounts`
A single library card belonging to a household.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `household_id` | uuid, FK → `households.id` | |
| `display_name` | text | e.g. "Ian" |
| `library_id` | uuid, FK → `libraries.id` | |
| `scraper_type` | text | registry key — **not** always equal to `libraries.scraper_type_default`, can be overridden per account |
| `scraper_config` | jsonb | per-account params (subdomain, org ID, etc.) |
| `credentials_encrypted` | bytea/text | KMS- or libsodium-encrypted blob, decrypted only in-memory at scrape time |
| `schedule_cron` | text | default `"0 6 * * *"`, overridable per account |
| `last_run_at` | timestamptz | |
| `last_status` | text | `"success"` \| `"failed"` \| `"running"` |
| `deleted_at` | timestamptz, nullable | soft delete — set when the user removes the card; the API, daily enqueue and worker all ignore rows where it's set |

### `runs`
One row per scrape attempt — the audit/debug trail.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `account_id` | uuid, FK → `accounts.id` | |
| `started_at` | timestamptz | |
| `finished_at` | timestamptz | nullable until complete |
| `status` | text | `"running"` \| `"success"` \| `"failed"` |
| `error` | text | nullable |
| `scraper_version` | text | hardcoded string bumped when a scraper's parsing logic changes — separates "site changed" bugs from "scraper regressed" bugs |
| `raw_output` | jsonb | full scraper response for this run, small enough to inline rather than needing object storage |

### `checkouts`
Current + historical checkout state, not a blob per run — enables natural "returned" detection.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `account_id` | uuid, FK → `accounts.id` | |
| `run_id` | uuid, FK → `runs.id` | the run that last confirmed this row |
| `external_id` | text | scraper-supplied stable ID for the item (or `title + due_date` composite fallback) — see §2. Unique together with `account_id` |
| `title` | text | |
| `due_date` | date | |
| `overdue` | boolean | |
| `img_src` | text | |
| `first_seen_at` | timestamptz | |
| `last_seen_at` | timestamptz | |
| `returned_at` | timestamptz | nullable — set when a checkout no longer appears in a successful run; this is how "book returned" events are derived without extra logic |

**Upsert key:** `(account_id, external_id)`. A run's checkouts are matched against existing rows on this pair — matches update `last_seen_at`/`run_id`, new `external_id`s insert, and existing rows missing from a successful run get `returned_at` set. This is why every scraper must emit `externalId`, even as a fallback composite — without it, "returned" detection degrades to unreliable title matching.

**Query pattern for the frontend** — all current checkouts for a household:

```sql
SELECT c.* FROM checkouts c
JOIN accounts a ON a.id = c.account_id
WHERE a.household_id = $1 AND c.returned_at IS NULL
ORDER BY c.due_date;
```

---

## 5. Queue & worker design

- **Queue:** BullMQ on Redis. Chosen over firing scrapes directly from HTTP handlers because it provides concurrency control (don't hit one library account from two triggers simultaneously — risks account lockout), retries with backoff, and a natural audit log via job state.
- **Two producers, one consumer path:**
  - Cron trigger (daily) queries accounts due to run, enqueues one job per account.
  - On-demand API endpoint (`POST /accounts/:id/refresh`) enqueues the same job shape.
  - Both land in the same queue, processed by the same worker pool — no duplicate code paths.
- **Job payload is minimal:** `{ accountId }`. The worker does all lookups (account row, scraper module, decrypted credentials) at process time rather than passing sensitive data through the queue.
- **Worker steps per job:**
  1. Load account row.
  2. Look up scraper module via registry (`REGISTRY[account.scraper_type]`).
  3. Decrypt credentials in-memory.
  4. Create a `runs` row with `status: "running"` before starting, so crashes are still logged.
  5. Call `scraper.scrape({ credentials, config })`.
  6. Validate the returned shape against a shared schema (ajv or similar) before writing anything downstream.
  7. Upsert `checkouts` keyed on `(account_id, external_id)` (mark missing rows `returned_at`), update `runs` to `success`/`failed`.
  8. On failure: capture debug artifacts (see §7), rethrow so BullMQ's retry policy applies.

---

## 6. API design

Small Express/Fastify service. Token-based auth from day one (not cookie/session) — this is deliberate: it keeps the API client-agnostic so a future Electron app or mobile app can hit the same endpoints without an auth rewrite.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/auth/login` | Returns a token |
| `POST` | `/auth/demo` | No credentials required — returns a token scoped to the shared demo household, for the "Try it out" flow. Gated by `DEMO_MODE_ENABLED`, rate-limited independently of `/auth/login`. See adr/0002-demo-mode.md |
| `GET` | `/me` | The token's user and the households they belong to (with role) — how a client builds its session after `/auth/login` or `/auth/google`, which return only a token |
| `GET` | `/households/:id/checkouts` | Current (non-returned) checkouts across all accounts in a household |
| `GET` | `/accounts/:id/runs` | Run history for one account (debugging/status) |
| `POST` | `/accounts/:id/refresh` | Enqueues an on-demand scrape job for one account |
| `DELETE` | `/accounts/:id` | Soft-deletes a library account (sets `deleted_at`; `204`). It disappears from the household's accounts and checkouts and is no longer scraped |
| `GET` | `/accounts/:id/status` | Poll endpoint — latest run status, for frontend "refreshing…" UI |
| `GET` | `/households/:id/accounts` | The library accounts (cards) in a household, with their library and last run status — never credentials |
| `POST` | `/households/:id/accounts` | Add a new library account to a household. Body: `displayName`, `libraryId`, `credentials` (`username`, `pin`). The scraper type and its config (`baseUrl`) are filled in from the `libraries` row, not sent by the client; credentials are encrypted before storage |

Notes:
- `/refresh` returns immediately with a `run_id`; the frontend polls `/accounts/:id/status` or `/accounts/:id/runs` rather than blocking on the scrape.
- Credentials are only ever written encrypted, decrypted only inside the worker process, never returned by any API response.

---

## 7. Resilience & debugging decisions

- **Scraper output is validated before it touches the DB.** A partially broken scrape (library changed HTML) should fail loudly, not silently corrupt `checkouts`.
- **`scraper_version` on every run** distinguishes "the library's site changed" from "the scraper code regressed" when diagnosing failures.
- **Debug artifacts (screenshots, HTML snapshots) on failure** go to lightweight object storage (Cloudflare R2, or Render disk, or any S3-compatible bucket) — this is the one place a blob store still earns its keep, since it's scratch/debug data, not the source of truth. Tag artifacts with the `run_id`.
- **Diffing runs is the mechanism for overdue alerts**, not a separate notification pipeline — `returned_at` and `due_date` changes surfaced from the `checkouts` table are sufficient to drive "due soon" logic later.

---

## 8. Key decisions log (for context in a new session)

| Decision | Rationale |
|---|---|
| No S3/object storage in the primary data path | Was a proxy for a real DB; redundant once Postgres exists. Kept only for scraper debug artifacts. |
| Scraper registry pattern (string → module) | Adding a library never touches the worker/queue/scheduler — only adds a file + one registry line. |
| Household ≠ Account | A household is people who log in; an account is a library card. Conflating them breaks the moment a kid has a card but no login, or a parent logs in but has no card. |
| `checkouts` as a stateful table, not a per-run blob | Enables natural "returned" detection via `returned_at`, which is also the mechanism for future overdue-alert logic — no separate event system needed. |
| Token-based auth, not sessions | Electron/mobile clients planned; stateless tokens avoid an auth rewrite later. |
| Queue (BullMQ/Redis) between triggers and worker | Both cron and on-demand hit the same queue — avoids duplicate scrape logic and gives retries/concurrency control for free. |
| Credentials encrypted at rest, decrypted only in worker memory | This system is explicitly planned to hold other people's library credentials eventually — worth taking seriously from v1. |
| Demo mode: one shared, read-only household, never enqueued | A public, credential-less "Try it out" button must never be able to reach the shared BullMQ queue. The `demo` scraper is registered like any other but is only ever called in-process by a reseed script on its own schedule — never dispatched as a job. Read-only-ness is enforced by one global middleware keyed off a `demo` token claim, not per-handler checks. See adr/0002-demo-mode.md. |
| Scraper contract requires `externalId` per checkout | Title-only matching breaks across services with duplicate titles or re-issued due dates; a stable per-item ID (or `title + due_date` fallback) is the upsert key so "returned" detection works uniformly regardless of which scraper produced the row. |

---

## 9. Open items for the next session

- ~~Finalize which encryption approach~~ Decided: AES-256-GCM via Node's built-in `crypto`, key from `CREDENTIAL_ENCRYPTION_KEY` — see `worker/src/crypto.js`.
- Decide concurrency limits per worker instance for Puppeteer (memory-bound, ~512MB–1GB per concurrent scrape).
- Design the "add a new library" onboarding flow for non-technical users (credential intake UI, which scraper gets assigned).
- Notification system for upcoming due dates (email/push) — data model already supports it via `checkouts.due_date`, delivery mechanism not yet designed.
- Multi-tenant permission model beyond household — e.g. should a household admin be able to invite scraper-only contributors who never see other members' data.
