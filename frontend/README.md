# @library-tracker/frontend

SvelteKit (Svelte 5, JS + JSDoc types) built as a static SPA with `adapter-static`.
Talks to `api/` at `VITE_API_URL` (see `.env.example`).

```sh
npm install
npm run dev      # http://localhost:5173 — api/ must allow this origin (CORS_ORIGIN defaults to *)
npm run check    # svelte-check
npm run build    # static output in build/
```

- `src/lib/styles/` — design tokens from the design handoff (`tokens.css` imported in the root layout, `tokens.js` for computed values).
- `src/lib/config.js` — API base URL. `src/lib/api.js` — fetch wrapper (adds the bearer token, throws `ApiError`).
- `src/lib/session.js` — the signed-in session (token + household id), held in memory and `localStorage`. Routes guard themselves in their `load` functions: no session → `/signin`; a 401 from the API clears it.
- Signing in currently works only via **Try the demo** (`POST /auth/demo`), which needs the demo household seeded: `npm run reseed-demo` in `worker/`. Google and email sign-in are rendered but disabled — `/auth/login` and `/auth/google` return only a token, so there's no way yet to learn the household id.
- Static hosting must rewrite unknown paths to `/index.html` (Render: `/*` → `/index.html`).
