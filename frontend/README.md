# @library-tracker/frontend

SvelteKit (Svelte 5, JS + JSDoc types) built as a static SPA with `adapter-static`.
Talks to `api/` at `VITE_API_URL` (see `.env.example`).

```sh
npm install
npm run dev      # http://localhost:5173 — api/ must allow this origin (CORS_ORIGIN defaults to *)
npm run check    # svelte-check
npm run build    # static output in build/
```

Routes (`src/routes/`):

- `/` — the household's checkouts (`GET /households/:id/checkouts`). The "Cards" tab at the right end of the tab strip goes to `/cards`.
- `/cards` — the register of library cards: lists them (`GET /households/:id/accounts`) files a new one (`POST /households/:id/accounts` with the library, card number, PIN and one borrower name) and removes one (`DELETE /accounts/:id`, a soft delete). The × on a row opens a confirmation under it; nothing is sent until you confirm. The API picks the scraper from the chosen library, so the client sends none. New sign-ups land here to finish setup; the demo household sees it read-only. Credentials are stored encrypted and never returned, so the register shows "on file" dots rather than the card number.
- `/signin` — **Create account** (`POST /auth/register`, which returns the token and the new household) and **Sign in** with email (`POST /auth/login`, then `GET /me` to find the household — the oldest one if there are several). **Try the demo** (`POST /auth/demo`) opens the shared read-only demo household, which needs seeding: `npm run reseed-demo` in `worker/`. **Continue with Google** is rendered but disabled; `/auth/google` needs a Google client-side flow to produce an `idToken`.

Other notes:

- `src/lib/styles/` — design tokens from the design handoff (`tokens.css` imported in the root layout, `tokens.js` for computed values).
- `src/lib/config.js` — API base URL. `src/lib/api.js` — fetch wrapper (adds the bearer token, throws `ApiError`).
- `src/lib/session.js` — the signed-in session (token + household id), held in memory and `localStorage`. Routes guard themselves in their `load` functions: no session → `/signin`; a 401 from the API clears it.
- Static hosting must rewrite unknown paths to `/index.html` (Render: `/*` → `/index.html`).
