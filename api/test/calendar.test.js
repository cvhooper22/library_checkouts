process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/db';
process.env.JWT_SECRET ??= 'test-secret';
process.env.CREDENTIAL_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const prisma = require('@library-tracker/db');
const { createApp } = require('../src/app');
const { signToken, signCalendarState } = require('../src/auth/tokens');
const { eventIdFor } = require('../src/calendarEventId');
const google = require('../src/googleCalendar');
const queue = require('../src/queue');
// The worker is the only side that decrypts, and it owns the event id the API mirrors.
const { decryptCredentials } = require('../../worker/src/crypto');
const { eventIdFor: workerEventIdFor } = require('../../worker/src/calendarEvent');

const HOUSEHOLD_ID = '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90';
const OTHER_HOUSEHOLD_ID = '9b1c2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e';
const ME = 'user-1';
const SPOUSE = 'user-2';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'; // 43 base64url chars
const CALENDAR_ID = 'library-due-dates@group.calendar.google.com';

// Same approach as auth.google.test.js: Prisma's delegates reject t.mock.method, so stub
// by assignment and restore afterwards.
function stub(t, object, methodName, implementation) {
  const original = object[methodName];
  const calls = [];
  object[methodName] = (...args) => {
    calls.push(args);
    return implementation(...args);
  };
  t.after(() => {
    object[methodName] = original;
  });
  return calls;
}

function setEnv(t, values) {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

const STORED_LINK = {
  id: 'link-1',
  householdId: HOUSEHOLD_ID,
  connectedUserId: ME,
  refreshTokenEncrypted: 'encrypted-refresh-token',
  calendarId: CALENDAR_ID,
  reminderTime: 480,
  timeZone: 'America/Los_Angeles',
  showTitles: true,
  enabled: true,
  lastSyncedAt: null,
  lastError: null,
};

// The flag on, both users members of HOUSEHOLD_ID (only), the household not the demo one,
// `link` as its calendar link (or none), and the sync trigger recorded instead of queued.
function household(t, { link = null, isDemo = false, connectedEmail = 'me@example.com' } = {}) {
  setEnv(t, { CALENDAR_ENABLED: 'true' });
  stub(t, prisma.householdMember, 'findUnique', async ({ where }) => {
    const { householdId, userId } = where.householdId_userId;
    return householdId === HOUSEHOLD_ID && [ME, SPOUSE].includes(userId) ? { role: 'owner' } : null;
  });
  stub(t, prisma.household, 'findUnique', async () => ({ isDemo, calendarLink: link }));
  stub(t, prisma.calendarLink, 'findUnique', async ({ select }) => {
    if (!link) return null;
    if (!select) return link;
    const { refreshTokenEncrypted, id, householdId, calendarId, ...status } = link;
    return { ...status, connectedUser: { email: connectedEmail } };
  });
  return { syncs: stub(t, queue, 'enqueueCalendarSync', async () => {}) };
}

async function call(t, method, path, { token = signToken(ME), body } = {}) {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body && { 'Content-Type': 'application/json' }) },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const BASE = `/households/${HOUSEHOLD_ID}/calendar`;

// ---- Tokens ----------------------------------------------------------------------

test('a calendar state token is never accepted as a sign-in token', async (t) => {
  stub(t, prisma.user, 'findUnique', async () => ({ id: ME, email: 'me@example.com', householdMembers: [] }));
  const state = signCalendarState({ userId: ME, householdId: HOUSEHOLD_ID });

  assert.equal((await call(t, 'GET', '/me', { token: state })).status, 401);
  // Nor is any token without a subject, whatever else it claims.
  const noSubject = jwt.sign({ uid: ME }, process.env.JWT_SECRET);
  assert.equal((await call(t, 'GET', '/me', { token: noSubject })).status, 401);
  // A normal session still works.
  assert.equal((await call(t, 'GET', '/me')).status, 200);
});

test('the API\'s event id matches the worker\'s', () => {
  assert.equal(eventIdFor(HOUSEHOLD_ID), workerEventIdFor(HOUSEHOLD_ID));
  assert.equal(eventIdFor(HOUSEHOLD_ID.toUpperCase()), workerEventIdFor(HOUSEHOLD_ID.toUpperCase()));
});

// ---- Access ----------------------------------------------------------------------

test('the routes are hidden while the calendar flag is off', async (t) => {
  household(t);
  setEnv(t, { CALENDAR_ENABLED: 'false' });
  assert.equal((await call(t, 'GET', BASE)).status, 404);
});

test('non-members get nothing', async (t) => {
  household(t, { link: STORED_LINK });
  assert.equal((await call(t, 'GET', `/households/${OTHER_HOUSEHOLD_ID}/calendar`)).status, 403);
  assert.equal((await call(t, 'GET', BASE, { token: signToken('stranger') })).status, 403);
});

// ---- Status ----------------------------------------------------------------------

test('GET shows the status to every member, never the token or calendar id', async (t) => {
  household(t, { link: STORED_LINK });

  const mine = await call(t, 'GET', BASE);
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body.calendar, {
    reminderTime: 480,
    timeZone: 'America/Los_Angeles',
    showTitles: true,
    enabled: true,
    lastSyncedAt: null,
    lastError: null,
    connectedBy: 'me@example.com',
    isYou: true,
  });

  const theirs = await call(t, 'GET', BASE, { token: signToken(SPOUSE) });
  assert.equal(theirs.body.calendar.isYou, false);
  assert.equal(theirs.body.calendar.connectedBy, 'me@example.com');
});

test('GET with nothing connected', async (t) => {
  household(t);
  assert.deepEqual((await call(t, 'GET', BASE)).body, { calendar: null });
});

// ---- Connect: start ----------------------------------------------------------------

test('start returns a Google URL for the narrow scope, with PKCE and a state for this user and household', async (t) => {
  household(t);
  setEnv(t, {
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    GOOGLE_CALENDAR_REDIRECT_URI: 'http://localhost:5173/calendar/callback',
  });

  const { status, body } = await call(t, 'POST', `${BASE}/connect/start`, { body: { codeChallenge: CHALLENGE } });

  assert.equal(status, 200);
  const url = new URL(body.url);
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/calendar.app.created');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('include_granted_scopes'), 'false');
  assert.equal(url.searchParams.get('code_challenge'), CHALLENGE);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:5173/calendar/callback');
  assert.equal(url.searchParams.get('state'), body.state);

  const claims = jwt.verify(body.state, process.env.JWT_SECRET);
  assert.equal(claims.purpose, 'calendar-connect');
  assert.equal(claims.uid, ME);
  assert.equal(claims.hid, HOUSEHOLD_ID);
  assert.equal(claims.sub, undefined);
  assert.equal(claims.exp - claims.iat, 600);
});

test('start refuses a bad challenge, another member\'s link, and the demo household', async (t) => {
  household(t, { link: STORED_LINK });
  assert.equal((await call(t, 'POST', `${BASE}/connect/start`, { body: { codeChallenge: 'short' } })).status, 400);

  const spouse = await call(t, 'POST', `${BASE}/connect/start`, { token: signToken(SPOUSE), body: { codeChallenge: CHALLENGE } });
  assert.equal(spouse.status, 409);

  stub(t, prisma.household, 'findUnique', async () => ({ isDemo: true, calendarLink: null }));
  assert.equal((await call(t, 'POST', `${BASE}/connect/start`, { body: { codeChallenge: CHALLENGE } })).status, 403);
});

// ---- Connect: finish ---------------------------------------------------------------

const GRANT = {
  oauth: { fake: 'oauth client' },
  refreshToken: 'new-refresh-token',
  scopes: ['https://www.googleapis.com/auth/calendar.app.created'],
};

function finishBody(overrides = {}) {
  return {
    code: 'auth-code',
    verifier: 'pkce-verifier',
    timeZone: 'America/Chicago',
    state: signCalendarState({ userId: ME, householdId: HOUSEHOLD_ID }),
    ...overrides,
  };
}

test('finish: first connect creates the calendar and an encrypted link, then syncs', async (t) => {
  const { syncs } = household(t);
  const exchanges = stub(t, google, 'exchangeCode', async () => GRANT);
  const calendars = stub(t, google, 'createCalendar', async () => CALENDAR_ID);
  const creates = stub(t, prisma.calendarLink, 'create', async ({ data }) => {
    stub(t, prisma.calendarLink, 'findUnique', async () => ({
      reminderTime: 480, timeZone: data.timeZone, showTitles: true, enabled: true, lastSyncedAt: null,
      lastError: null, connectedUserId: ME, connectedUser: { email: 'me@example.com' },
    }));
    return data;
  });

  const { status, body } = await call(t, 'POST', `${BASE}/connect/finish`, { body: finishBody() });

  assert.equal(status, 201);
  assert.deepEqual(exchanges[0][0], { code: 'auth-code', verifier: 'pkce-verifier' });
  assert.deepEqual(calendars[0], [GRANT.oauth, 'America/Chicago']);
  const { data } = creates[0][0];
  assert.equal(data.householdId, HOUSEHOLD_ID);
  assert.equal(data.connectedUserId, ME);
  assert.equal(data.calendarId, CALENDAR_ID);
  assert.equal(data.timeZone, 'America/Chicago');
  assert.doesNotMatch(data.refreshTokenEncrypted, /new-refresh-token/);
  assert.deepEqual(decryptCredentials(data.refreshTokenEncrypted), { refreshToken: 'new-refresh-token' });
  assert.deepEqual(syncs, [[{ householdId: HOUSEHOLD_ID }]]);
  assert.equal(body.calendar.isYou, true);
  assert.doesNotMatch(JSON.stringify(body), /refresh|encrypted/i);
});

test('finish: a reconnect keeps the calendar it can still reach, and only updates this user\'s link', async (t) => {
  const { syncs } = household(t, { link: STORED_LINK });
  stub(t, google, 'exchangeCode', async () => GRANT);
  const reached = stub(t, google, 'canReachCalendar', async () => true);
  const created = stub(t, google, 'createCalendar', async () => 'new-calendar');
  const updates = stub(t, prisma.calendarLink, 'updateMany', async () => ({ count: 1 }));

  const { status } = await call(t, 'POST', `${BASE}/connect/finish`, { body: finishBody() });

  assert.equal(status, 200);
  assert.deepEqual(reached[0], [GRANT.oauth, CALENDAR_ID]);
  assert.equal(created.length, 0);
  assert.deepEqual(updates[0][0].where, { householdId: HOUSEHOLD_ID, connectedUserId: ME });
  assert.equal(updates[0][0].data.calendarId, CALENDAR_ID);
  assert.equal(updates[0][0].data.enabled, true);
  assert.equal(updates[0][0].data.lastError, null);
  assert.equal(syncs.length, 1);
});

test('finish: a reconnect that can\'t reach the old calendar makes a new one in the saved time zone', async (t) => {
  household(t, { link: STORED_LINK });
  stub(t, google, 'exchangeCode', async () => GRANT);
  stub(t, google, 'canReachCalendar', async () => false);
  const created = stub(t, google, 'createCalendar', async () => 'new-calendar');
  const updates = stub(t, prisma.calendarLink, 'updateMany', async () => ({ count: 1 }));

  await call(t, 'POST', `${BASE}/connect/finish`, { body: finishBody() });

  assert.deepEqual(created[0], [GRANT.oauth, 'America/Los_Angeles']);
  assert.equal(updates[0][0].data.calendarId, 'new-calendar');
});

test('finish rejects a bad, expired or someone else\'s state before calling Google', async (t) => {
  household(t);
  const exchanges = stub(t, google, 'exchangeCode', async () => GRANT);
  const expired = jwt.sign(
    { purpose: 'calendar-connect', uid: ME, hid: HOUSEHOLD_ID, nonce: 'n' },
    process.env.JWT_SECRET,
    { expiresIn: -10 },
  );

  const cases = [
    [finishBody({ state: 'not-a-token' }), 400],
    [finishBody({ state: expired }), 400],
    [finishBody({ state: signToken(ME) }), 400], // a session token is not a state
    [finishBody({ state: signCalendarState({ userId: SPOUSE, householdId: HOUSEHOLD_ID }) }), 403],
    [finishBody({ state: signCalendarState({ userId: ME, householdId: OTHER_HOUSEHOLD_ID }) }), 403],
    [finishBody({ timeZone: 'Mars/Olympus_Mons' }), 400],
    [finishBody({ code: '' }), 400],
  ];
  for (const [body, expected] of cases) {
    assert.equal((await call(t, 'POST', `${BASE}/connect/finish`, { body })).status, expected, JSON.stringify(body));
  }
  assert.equal(exchanges.length, 0);
});

test('finish refuses a grant without the calendar scope or a refresh token, and stores nothing', async (t) => {
  household(t);
  const creates = stub(t, prisma.calendarLink, 'create', async () => ({}));
  const calendars = stub(t, google, 'createCalendar', async () => CALENDAR_ID);

  stub(t, google, 'exchangeCode', async () => ({ ...GRANT, scopes: ['openid'] }));
  assert.equal((await call(t, 'POST', `${BASE}/connect/finish`, { body: finishBody() })).status, 400);

  stub(t, google, 'exchangeCode', async () => ({ ...GRANT, refreshToken: null }));
  assert.equal((await call(t, 'POST', `${BASE}/connect/finish`, { body: finishBody() })).status, 400);

  stub(t, google, 'exchangeCode', async () => {
    throw new Error('invalid_grant');
  });
  assert.equal((await call(t, 'POST', `${BASE}/connect/finish`, { body: finishBody() })).status, 400);

  assert.equal(creates.length, 0);
  assert.equal(calendars.length, 0);
});

test('finish: another member connected while this one was at Google', async (t) => {
  household(t);
  stub(t, google, 'exchangeCode', async () => GRANT);
  stub(t, google, 'createCalendar', async () => CALENDAR_ID);
  stub(t, prisma.calendarLink, 'create', async () => {
    throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
  });

  assert.equal((await call(t, 'POST', `${BASE}/connect/finish`, { body: finishBody() })).status, 409);
});

// ---- Settings ----------------------------------------------------------------------

test('PATCH changes settings on half hours only, then syncs', async (t) => {
  const { syncs } = household(t, { link: STORED_LINK });
  const updates = stub(t, prisma.calendarLink, 'update', async () => ({}));

  const ok = await call(t, 'PATCH', BASE, { body: { reminderTime: 450, timeZone: 'America/Denver', showTitles: false } });
  assert.equal(ok.status, 200);
  assert.deepEqual(updates[0][0], {
    where: { id: 'link-1' },
    data: { reminderTime: 450, timeZone: 'America/Denver', showTitles: false },
  });
  assert.equal(syncs.length, 1);

  for (const body of [
    { reminderTime: 465 }, // not a half hour
    { reminderTime: 1440 },
    { reminderTime: -30 },
    { reminderTime: '480' },
    { timeZone: 'Nowhere/Special' },
    { showTitles: 'no' },
    {},
  ]) {
    assert.equal((await call(t, 'PATCH', BASE, { body })).status, 400, JSON.stringify(body));
  }
  assert.equal(updates.length, 1);
});

test('only the member who connected can change or disconnect', async (t) => {
  household(t, { link: STORED_LINK });
  const updates = stub(t, prisma.calendarLink, 'update', async () => ({}));
  const transactions = stub(t, prisma, '$transaction', async () => []);
  const spouse = signToken(SPOUSE);

  assert.equal((await call(t, 'PATCH', BASE, { token: spouse, body: { showTitles: false } })).status, 403);
  assert.equal((await call(t, 'DELETE', BASE, { token: spouse })).status, 403);
  assert.equal(updates.length, 0);
  assert.equal(transactions.length, 0);
});

// ---- Disconnect --------------------------------------------------------------------

test('DELETE drops the link and queues its revocation for the worker, then syncs', async (t) => {
  const { syncs } = household(t, { link: STORED_LINK });
  const deletes = stub(t, prisma.calendarLink, 'delete', (args) => ({ op: 'delete', args }));
  const creates = stub(t, prisma.calendarRevocation, 'create', (args) => ({ op: 'create', args }));
  const transactions = stub(t, prisma, '$transaction', async (ops) => ops);

  assert.equal((await call(t, 'DELETE', `${BASE}?deleteCalendar=true`)).status, 204);
  assert.equal(transactions.length, 1);
  assert.deepEqual(deletes[0][0], { where: { id: 'link-1' } });
  assert.deepEqual(creates[0][0].data, {
    householdId: HOUSEHOLD_ID,
    refreshTokenEncrypted: 'encrypted-refresh-token',
    calendarId: CALENDAR_ID,
    eventId: workerEventIdFor(HOUSEHOLD_ID),
    deleteCalendar: true,
  });
  assert.deepEqual(syncs, [[{ householdId: HOUSEHOLD_ID }]]);

  // Without the flag the calendar stays.
  await call(t, 'DELETE', BASE);
  assert.equal(creates[1][0].data.deleteCalendar, false);
});

test('a sync that can\'t be started never fails the request', async (t) => {
  household(t, { link: STORED_LINK });
  stub(t, prisma.calendarLink, 'update', async () => ({}));
  stub(t, queue, 'enqueueCalendarSync', async () => {
    throw new Error('GitHub is down');
  });
  stub(t, console, 'error', () => {});

  assert.equal((await call(t, 'PATCH', BASE, { body: { showTitles: false } })).status, 200);
});
