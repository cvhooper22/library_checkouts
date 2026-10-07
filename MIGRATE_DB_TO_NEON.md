# Moving the prod database from Render Postgres to Neon

**Why:** Render's free Postgres expires 30 days after creation, then has a 14-day grace period
before it is hard-deleted. Neon's free tier doesn't expire, is plain Postgres, and needs no
schema or Prisma changes, only a different `DATABASE_URL`.

**Not committed on purpose.** This file is untracked. Delete it when the move is done.

## What changes and what doesn't

| Piece | Changes? |
|---|---|
| Prisma schema / migrations / app code | No |
| Render Redis (Key Value) | No |
| Render web service, worker, cron jobs | Only the `DATABASE_URL` env var |
| GitHub Actions secret `DATABASE_URL` | Yes, used by `migrate.yml`, `scrape.yml`, `calendar-sync.yml` |
| Frontend | No |

Every place that holds a Postgres URL, so none gets missed:

1. Render **API** web service → env `DATABASE_URL`
2. Render **Background Worker** → env `DATABASE_URL`
3. Render **Cron Job** (daily enqueue) → env `DATABASE_URL`
4. Render **demo reseed cron** (if it exists) → env `DATABASE_URL`
5. GitHub repo secret `DATABASE_URL` (Settings → Secrets and variables → Actions)
6. Your local `.env` files, if you point at prod from your machine

## Deadline

Check the Render dashboard for the exact expiry date. Finish before it. After that the 14-day
grace period still allows a dump, but don't rely on it.

## Prerequisites

- `pg_dump` and `psql` installed locally, **version matching or newer than the Render server**.
  Check the server version in the Render DB page. On macOS: `brew install libpq` and add it to
  PATH, or `brew install postgresql@16`.
- A Neon account (sign up with GitHub, no card needed).

## Steps

### 1. Create the Neon project

1. neon.tech → New Project.
2. **Postgres version:** match Render's (or newer).
3. **Region:** as close as possible to your Render API region (e.g. Render Oregon → Neon
   `us-west-2`). Every query crosses this link, so latency matters.
4. Note the default database (`neondb`) and role. Use them as-is, or create a dedicated
   `library` database and role.
5. Open **Connect**. Copy the **direct** connection string, i.e. the host **without**
   `-pooler`. Turn off "Connection pooling" in the dialog to see it.
   It looks like `postgresql://USER:PASS@ep-xxxx.us-west-2.aws.neon.tech/neondb?sslmode=require`.

> **Use the direct URL everywhere.** Prisma's `migrate deploy` takes advisory locks, which
> break through Neon's pooled (PgBouncer) endpoint. The schema has no `directUrl` configured,
> so the simple fix is to use the direct URL for all services. Traffic is low; that's fine.
> (The alternative is the pooled URL plus `?pgbouncer=true` for the app and a `directUrl` in
> `db/prisma/schema.prisma` for migrations. It's more config than this app needs.)

### 2. Stop writes (short freeze)

The scraper and cron jobs write to the DB. To get a consistent dump:

- Suspend the Render **cron job(s)** and **worker**, or just do this between scheduled runs.
- Disable the GitHub workflows `scrape` and `calendar-sync` (Actions tab → workflow → ⋯ →
  Disable), or make sure none is mid-run.
- The API can stay up; nothing meaningful writes through it except logins and settings. For a
  strictly consistent snapshot, suspend it too. The downtime is a few minutes.

### 3. Dump from Render

Use the **External Database URL** from the Render DB page (append `?sslmode=require` if it
isn't there).

```bash
export RENDER_DB_URL='postgresql://...render.com/...?sslmode=require'

pg_dump --no-owner --no-acl --format=custom --file=library_backup.dump "$RENDER_DB_URL"
```

Keep `library_backup.dump` somewhere safe and **out of git**. It contains user emails, password
hashes and Google OAuth data. Also keep a plain-SQL copy as a fallback:

```bash
pg_dump --no-owner --no-acl "$RENDER_DB_URL" > library_backup.sql
```

Sanity-check that the dump isn't empty:

```bash
pg_restore --list library_backup.dump | head -40
```

Note the row counts to compare later:

```bash
psql "$RENDER_DB_URL" -c "select 'User', count(*) from \"User\" union all select 'Household', count(*) from \"Household\";"
```

(Table names come from `db/prisma/schema.prisma`; adjust to the `@@map` names if they differ.
Compare a handful of key tables, not all of them.)

### 4. Restore into Neon

```bash
export NEON_DB_URL='postgresql://...neon.tech/neondb?sslmode=require'   # the DIRECT url

pg_restore --no-owner --no-acl --clean --if-exists --dbname="$NEON_DB_URL" library_backup.dump
```

- Warnings about `DROP ... does not exist` are expected on a fresh DB because of `--clean --if-exists`.
- Any other error means stop and read it before continuing. If the custom-format restore gives
  trouble, fall back to `psql "$NEON_DB_URL" < library_backup.sql`.
- Extensions: if the dump references one Neon doesn't allow, it will error. Check that the
  schema doesn't need anything unusual (`grep -i extension db/prisma/migrations -r`).

### 5. Verify the restore

```bash
# same counts as noted in step 3
psql "$NEON_DB_URL" -c "select 'User', count(*) from \"User\" union all select 'Household', count(*) from \"Household\";"

# migrations table carried over, so Prisma sees the DB as up to date
psql "$NEON_DB_URL" -c "select migration_name, finished_at from _prisma_migrations order by finished_at desc limit 5;"
```

Then confirm Prisma agrees. It should report no pending migrations:

```bash
cd db
DATABASE_URL="$NEON_DB_URL" npx prisma migrate status
```

### 6. Point everything at Neon

Do these in this order:

1. **GitHub secret** `DATABASE_URL` → the Neon direct URL.
2. Run the **migrate** workflow from the Actions tab (workflow_dispatch). It should succeed
   and apply nothing. This proves CI can reach Neon.
3. **Render API** → Environment → edit `DATABASE_URL` → save (triggers a redeploy).
4. **Render worker** → same.
5. **Render cron job(s)** → same. Un-suspend them.
6. Re-enable the GitHub `scrape` and `calendar-sync` workflows.

Make sure the URL includes `?sslmode=require`. Neon rejects non-TLS connections.

### 7. Smoke test

- API health/login works. Expect the first request after idle to be slow, since both Render's
  free tier and Neon's compute wake from sleep.
- Load the cards page; existing checkouts and calendar links are present.
- Trigger a scrape (Actions → `scrape` → Run workflow) and confirm new rows land.
- Trigger `calendar-sync` the same way.
- Check Render logs for connection errors (`P1001`, `too many connections`, SSL errors).

### 8. Clean up (after about a week of it running fine)

- Delete the Render Postgres instance. Don't do this earlier; it's your rollback.
- Move the dump files somewhere private or delete them.
- Update docs that mention Render Postgres: `render-deployment-guide.html` phase 3, and the
  `migrate.yml` comment ("Render's external URL").
- This unblocks the demo plan in `roadmap/demo-environment.md`, which wants its own Neon project.
  The free plan allows more than one project, so make a separate one rather than sharing.

## Rollback

Until you delete the Render DB (and while it hasn't expired), rollback is just setting
`DATABASE_URL` back to the Render URL in the five places above. Any rows written to Neon after
the cutover won't be on Render, so roll back early or dump Neon and restore back.

## Gotchas

- **Pooled vs direct URL:** see step 1. A pooled URL can cause migration failures or hangs.
- **Neon free-tier limits:** storage and compute-hour caps apply, and compute scales to zero
  after a few idle minutes. Check the current limits on neon.tech/pricing. Expect a short
  cold-start delay on the first query after idle.
- **Connection limits:** Neon's free compute has a low connection cap. If the API, worker and
  Actions jobs overlap you may see `too many connections`. Keep Prisma's pool small by appending
  `&connection_limit=5` to the URL if it happens.
- **Render external access:** the Render DB's external URL must still be reachable for the dump.
  Check the "Access Control" allowlist, which defaults to allowing all.
- **Secrets hygiene:** never paste these URLs into the repo, issues or chat logs. Rotate the
  Neon password if one leaks.

## Checklist

- [ ] Neon project created (region near Render API, matching PG version)
- [ ] Direct (non-pooler) connection string saved
- [ ] Cron/worker/workflows paused
- [ ] Dump taken and row counts noted
- [ ] Restored to Neon, counts match, `prisma migrate status` clean
- [ ] GitHub secret updated, `migrate` workflow green
- [ ] Render API, worker, cron(s) `DATABASE_URL` updated
- [ ] Workflows re-enabled
- [ ] Smoke tests pass (login, cards, scrape, calendar-sync)
- [ ] One week later: Render Postgres deleted, docs updated
