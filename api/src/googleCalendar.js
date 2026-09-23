const { OAuth2Client } = require('google-auth-library');

// The Google side of connecting a household calendar (routes/calendar.js). The API only
// ever holds a fresh access token in memory, long enough to create or check the calendar;
// the refresh token is encrypted before it's stored and only the worker decrypts it
// (architecture.md §6), which is where every later calendar write happens.

// The narrowest scope that can make a calendar and write events: only calendars this app
// created, nothing else in the user's account. Google rates it non-sensitive.
const SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
const CALENDAR_NAME = 'Library Due Dates';
const CALENDARS_URL = 'https://www.googleapis.com/calendar/v3/calendars';

function client() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALENDAR_REDIRECT_URI } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_CALENDAR_REDIRECT_URI) {
    throw new Error('GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_CALENDAR_REDIRECT_URI must be set');
  }
  return new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALENDAR_REDIRECT_URI);
}

// offline + consent: always hand back a refresh token, even on a reconnect.
// include_granted_scopes false: never fold the sign-in grant into this one.
// PKCE: the browser made the verifier and keeps it; only the challenge passes through here.
function authUrl({ state, codeChallenge }) {
  return client().generateAuthUrl({
    scope: [SCOPE],
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: false,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
}

// Exchanges the callback's code. `scopes` is what the user actually granted: Google's
// consent screen lets them untick a scope, so the caller checks it.
async function exchangeCode({ code, verifier }) {
  const oauth = client();
  const { tokens } = await oauth.getToken({ code, codeVerifier: verifier });
  oauth.setCredentials(tokens);
  return {
    oauth,
    refreshToken: tokens.refresh_token ?? null,
    scopes: (tokens.scope ?? '').split(' ').filter(Boolean),
  };
}

async function createCalendar(oauth, timeZone) {
  const { data } = await oauth.request({
    url: CALENDARS_URL,
    method: 'POST',
    data: { summary: CALENDAR_NAME, timeZone },
  });
  return data.id;
}

// On a reconnect: can this new grant still reach the calendar the household already
// has? Yes for the same Google account (app-created calendars belong to the app, not to
// one grant); no for a different account or a calendar the user deleted.
async function canReachCalendar(oauth, calendarId) {
  try {
    await oauth.request({ url: `${CALENDARS_URL}/${encodeURIComponent(calendarId)}` });
    return true;
  } catch (error) {
    if (error.status === 403 || error.status === 404) return false;
    throw error;
  }
}

module.exports = { SCOPE, authUrl, exchangeCode, createCalendar, canReachCalendar };
