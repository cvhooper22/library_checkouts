# Dev server port drift

When port 5173 is taken, `vite dev` quietly moves to the next free port (5174, …).
Two things are pinned to 5173 and break without saying why:

- **Google Calendar connect.** `GOOGLE_CALENDAR_REDIRECT_URI` (`api/.env`) and the OAuth
  client's authorized redirect URIs both say `http://localhost:5173/calendar/callback`.
  From 5174, Google sends the user back to a port nothing is serving, or rejects the
  request with `redirect_uri_mismatch`.
- **Every API call.** `CORS_ORIGIN=http://localhost:5173` on the API no longer matches, so
  the browser blocks the responses.

Nothing guards against this today. `frontend/vite.config.js` sets no port options, and
`.claude/launch.json` passes `--port 5173` but not `--strictPort`.

## Options

1. **`server.strictPort: true` in `frontend/vite.config.js`.** Vite exits with "Port 5173
   is already in use" instead of moving. It's one line and fixes the drift at the source,
   for the callback and CORS alike. The message is Vite's own and doesn't mention the
   callback.
2. **Set the port from the callback URL.** Read a frontend env var such as
   `VITE_CALENDAR_CALLBACK_URL`, take its port, and set `server.port` to it with
   `strictPort`. The callback URL is then the only place the port is defined. It's a new
   env var that has to match the API's `GOOGLE_CALENDAR_REDIRECT_URI`. Reading `api/.env`
   from the frontend config instead would couple the packages.
3. **A small Vite plugin with a custom message.** Use a `configureServer` hook that waits
   for the server to start, compares the actual port with the callback URL's port, and on
   a mismatch prints what breaks and how to fix it (free 5173, or update
   `GOOGLE_CALENDAR_REDIRECT_URI` and `CORS_ORIGIN`), then exits. It gives the clearest
   message, but it's about 15 lines guarding what option 1 does in one.
4. **Check in the browser before going to Google.** The consent URL from
   `POST /households/:id/calendar/connect/start` already carries `redirect_uri`.
   `startConnect` (`frontend/src/lib/calendar.js`) could check that it matches
   `window.location.origin` and show an error on the Set up page instead of sending the
   user to Google. This also catches production misconfiguration (a wrong
   `GOOGLE_CALENDAR_REDIRECT_URI` on Render, a new custom domain) that no startup check
   can see. The catch: you only find out when you click Connect.

**Recommended: 1 plus 4.** `strictPort` stops the port drift that breaks both the
callback and CORS. The browser check covers deployed environments. Add 3 on top of 1 if
Vite's message proves too vague in practice.
