const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const DEFAULT_EXPIRES_IN = '7d';

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set');
  }
  return secret;
}

// `demo: true` marks a token minted by POST /auth/demo — it's what
// demoReadOnly keys off of (adr/0002-demo-mode.md). Set only at issuance;
// nothing re-derives demo-ness from the DB on later requests.
function signToken(userId, { demo = false, expiresIn } = {}) {
  const claims = demo ? { sub: userId, demo: true } : { sub: userId };
  return jwt.sign(claims, getSecret(), {
    expiresIn: expiresIn || process.env.JWT_EXPIRES_IN || DEFAULT_EXPIRES_IN,
  });
}

// Only session tokens sign someone in. Other tokens signed with the same secret (the
// calendar connect `state` below) carry a `purpose` and no `sub`, and are refused here so
// one can never be replayed as a bearer token.
function verifyToken(token) {
  const { sub, demo, purpose } = jwt.verify(token, getSecret());
  if (purpose !== undefined || typeof sub !== 'string') {
    throw new Error('Not a session token');
  }
  return { userId: sub, demo: demo === true };
}

const CALENDAR_STATE = 'calendar-connect';

// The OAuth `state` for connecting a Google Calendar: which user started it, for which
// household, good for 10 minutes. The random nonce makes each one unique, so the browser
// can tell its own callback from anyone else's (routes/calendar.js).
function signCalendarState({ userId, householdId }) {
  const nonce = crypto.randomBytes(16).toString('base64url');
  return jwt.sign({ purpose: CALENDAR_STATE, uid: userId, hid: householdId, nonce }, getSecret(), {
    expiresIn: '10m',
  });
}

function verifyCalendarState(token) {
  const { purpose, uid, hid } = jwt.verify(token, getSecret());
  if (purpose !== CALENDAR_STATE) {
    throw new Error('Not a calendar connect state');
  }
  return { userId: uid, householdId: hid };
}

module.exports = { signToken, verifyToken, signCalendarState, verifyCalendarState };
