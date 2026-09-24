# Bookstamp
A web app to show all of a groups library checkouts in one place

## Local admin app

Small admin portal for use on local machines only.

### One-time setup

```bash
cd db && npm install && npm run generate
cd ../worker && npm install
cp .env.admin.example .env.admin            
```

Fill in `worker/.env.admin`:

| Variable | What to put |
| --- | --- |
| `DATABASE_URL` | The Render Postgres **External** Database URL, keeping `?sslmode=require`. |
| `CREDENTIAL_ENCRYPTION_KEY` | Make sure it matches API service |
| `NODE_ENV` | Leave as `production` |
| `SCRAPER_VERSION` | Leave as `admin-local`. Helps with paper trails |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | The OAuth web client the API uses. A scrape run here also re-syncs that household's Google Calendar reminder |

`ADMIN_PORT` is optional (default `4100`).

### Run it

```bash
cd worker
npm run admin
```

Open <http://127.0.0.1:4100>

### Sync calendar reminders by hand

**Sync calendars** on the admin page re-syncs every linked household's Google Calendar
reminder without scraping, then carries out queued disconnects: the same thing the daily
`calendar-sync.yml` run does. It needs `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in
`.env.admin`. The same sync from the command line:

```bash
cd worker
node --env-file=.env.admin scripts/sync-calendars.js
```

Set `HOUSEHOLD_ID=<id>` in front of it to sync one household.
