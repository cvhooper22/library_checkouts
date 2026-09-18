# 1. Repository layout: independent packages, no root workspace

Date: 2026-09-18

## Status

Accepted

## Context

This repo is being built across multiple, independent Claude sessions (different chats, sometimes running in parallel). One session scaffolded `db/`, `worker/`, `api/`, and `frontend/` as four separate npm packages — no root `package.json`, no npm/yarn workspace tying them together. `worker/` depends on `db/` via a `file:../db` reference.

A later, unrelated session (asked only to write a scraper) had no visibility into that structure, assumed a conventional single-package repo, and created a root-level `package.json` + `scrapers/` directory. That code was never reachable by the real worker (`worker/src/index.js` requires `./scrapers`, i.e. `worker/src/scrapers/`) — it was a dead end that had to be deleted once discovered.

## Decision

Keep the repo as independent packages, not a workspace, and record the actual layout here so a new session can check it before writing code instead of guessing:

```
library_checkouts/
├── architecture.md            # design doc — schema, queue, contracts
├── adr/                       # decisions like this one
├── render-deployment-guide.html
│
├── db/                        # @library-tracker/db — schema owner, shared by api/ + worker/
│   ├── prisma/
│   │   ├── schema.prisma      # source of truth for the tables in architecture.md §4
│   │   └── migrations/
│   ├── index.js                # exports a singleton PrismaClient
│   └── package.json
│
├── worker/                    # @library-tracker/worker — BullMQ worker (architecture.md §5)
│   ├── Dockerfile               # build context is the REPO ROOT, not worker/ (needs sibling db/)
│   ├── package.json             # depends on ../db via "file:../db"
│   ├── scripts/
│   │   └── scrape-local.js    # run one scraper directly, no Postgres/Redis needed:
│   │                           #   SCRAPER_TYPE=koha SCRAPER_BASE_URL=... SCRAPER_USERNAME=... SCRAPER_PIN=... npm run scrape-local
│   └── src/
│       ├── index.js            # the Worker — one BullMQ job = one account scrape
│       ├── queue.js            # BullMQ/Redis connection + queue name
│       ├── enqueueDaily.js     # cron entrypoint — enqueues one job per account
│       ├── crypto.js           # AES-256-GCM encrypt/decrypt for credentials_encrypted
│       ├── debugArtifacts.js   # on-failure capture hook (storage backend still open, architecture.md §9)
│       └── scrapers/
│           ├── index.js        # REGISTRY: scraper_type -> module, + getScraper() (architecture.md §2)
│           ├── validate.js     # ajv schema enforcing the scrape() contract before any DB write
│           ├── koha.js         # any Koha OPAC (ByWater-hosted or otherwise) — config.baseUrl varies
│           ├── bibliocommons.js
│           └── demo.js         # synthetic data only — never dispatched via the queue, see adr/0002-demo-mode.md
│
├── api/                        # @library-tracker/api — Express, token auth (architecture.md §6)
│   └── src/
│       ├── index.js            # process entrypoint — listens on PORT
│       ├── app.js              # createApp(): mounts /auth (public), then authenticate + demoReadOnly, then routes
│       ├── crypto.js           # encrypt-only; duplicated from worker/src/crypto.js (independent packages, see this ADR)
│       ├── queue.js            # BullMQ producer for POST /accounts/:id/refresh
│       ├── auth/
│       │   ├── tokens.js       # JWT sign/verify; carries the `demo` claim
│       │   └── middleware.js   # authenticate, demoReadOnly (the single chokepoint enforcing demo-token read-only-ness), household/account membership checks
│       ├── lib/
│       │   └── errors.js       # HttpError + the shared error handler
│       └── routes/
│           ├── auth.js         # POST /auth/register, /auth/login, /auth/google, /auth/demo
│           ├── households.js
│           └── accounts.js
│
└── frontend/                   # not yet implemented
    └── src/
```

Rules that follow from this:

- No root-level `package.json`, dependency, or script. Code that isn't inside one of the four package directories has no way to run.
- A new scraper is `worker/src/scrapers/<id>.js` implementing the contract in architecture.md §2, plus one line added to `REGISTRY` in `worker/src/scrapers/index.js`. Not a new package, not a new top-level directory.
- `db/prisma/schema.prisma` is the only place the schema is defined — `api/` and `worker/` both consume the generated client, neither duplicates model definitions.
- `worker/scripts/scrape-local.js` is the sanctioned way to smoke-test a scraper in isolation before wiring it to a real account.

## Consequences

A session that only needs to touch one package (e.g. "add a scraper") should read this file first to find where that package actually lives, rather than inferring a layout from architecture.md's conceptual description alone. If the layout changes (e.g. a workspace tool gets introduced), update this ADR rather than leaving it to drift, and add a new ADR for the change rather than editing this one's Decision after the fact.
