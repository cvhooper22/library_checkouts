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

`ADMIN_PORT` is optional (default `4100`).

### Run it

```bash
cd worker
npm run admin
```

Open <http://127.0.0.1:4100>
