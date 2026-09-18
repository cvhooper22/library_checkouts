# 3. Frontend: SvelteKit built as a static SPA

Date: 2026-09-18

## Status

Accepted. Fills in the `frontend/` entry left as "not yet implemented" in `adr/0001-repository-layout.md`.

## Context

`frontend/` is a fourth independent package (ADR 0001). The Render deployment guide hosts it as a Static Site (`npm install && npm run build`, publish a directory), configured by a build-time `VITE_API_URL`. The design handoff (`design-handoff/handoff/svelte/`) is written against SvelteKit conventions (`src/routes/+layout.svelte`, `$lib/styles/...`).

## Decision

- **SvelteKit + Svelte 5 (runes), plain JavaScript with JSDoc types** checked by `svelte-check` — same language as `api/` and `worker/`, no TypeScript build step to own.
- **`adapter-static` with `fallback: 'index.html'` and `ssr = false`** in the root layout. Auth is a client-held token against a separate API, so there is nothing to render server-side and no Node runtime to deploy. Output is `frontend/build/`.
- **API location via `VITE_API_URL`** (`src/lib/config.js`), matching the deploy guide; defaults to `http://localhost:3000`.
- **Design tokens live in `frontend/src/lib/styles/`** (`tokens.css`, `tokens.js`), copied from the handoff. The handoff copy is the source for design intent; the `frontend/` copy carries only JSDoc typing additions.

## Consequences

- The static host must rewrite unknown paths to `/index.html` (Render: rewrite `/*` → `/index.html`) or deep links will 404.
- Anything needing server-side rendering or server-only secrets would require swapping the adapter; nothing planned needs it.
- Demo mode needs no frontend special-casing beyond pointing `VITE_API_URL` at the demo API (see `roadmap/demo-environment.md`).
