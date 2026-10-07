process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/db';
process.env.JWT_SECRET ??= 'test-secret';
process.env.CREDENTIAL_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');

const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('@library-tracker/db');
const { createApp } = require('../src/app');
const { signToken } = require('../src/auth/tokens');
const { CAPABILITIES, policiesFor } = require('../src/auth/capabilities');
const queue = require('../src/queue');
const google = require('../src/googleCalendar');
const crypto = require('../src/crypto');

// adr/0004-capability-based-authorization.md: what the demo role can and can't do.

const HOUSEHOLD_ID = '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90';
const ACCOUNT_ID = '5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const LIBRARY_ID = '7c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f';
const RUN_ID = '8d2e3f4a-5b6c-4d7e-9f80-1b2c3d4e5f6a';
const DEMO_OWNER = 'demo-owner';
const MEMBER = 'member-1';
const CALENDAR_ID = 'library-due-dates@group.calendar.google.com';

const LIBRARY = { id: LIBRARY_ID, isActive: true, scraperTypeDefault: 'bibliocommons', baseUrl: 'https://library.example' };
const ACCOUNT = { id: ACCOUNT_ID, householdId: HOUSEHOLD_ID, deletedAt: null };
const LINK = {
  id: 'link-1',
  householdId: HOUSEHOLD_ID,
  connectedUserId: DEMO_OWNER,
  refreshTokenEncrypted: 'encrypted',
  calendarId: CALENDAR_ID,
  reminderTime: 480,
  timeZone: 'America/Los_Angeles',
  showTitles: true,
  enabled: true,
  lastSyncedAt: null,
  lastError: null,
};

// Same approach as the other API tests: Prisma's delegates reject t.mock.method, so stub by
// assignment and restore afterwards.
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

// The reads every route here needs, for a household both users belong to. Returns `sideEffects`:
// every call to anything that writes, enqueues or talks to Google, which a demo run must leave empty.
function world(t) {
  setEnv(t, { CALENDAR_ENABLED: 'true', REFRESH_ENABLED: 'true' });
  // Answers only for the real household and a real user: a guard that looked up the wrong id
  // (say, an undefined one) must come back as "not a member".
  stub(t, prisma.householdMember, 'findUnique', async ({ where }) => {
    const { householdId, userId } = where.householdId_userId;
    return householdId === HOUSEHOLD_ID && [DEMO_OWNER, MEMBER].includes(userId) ? { role: 'owner' } : null;
  });
  stub(t, prisma.account, 'findUnique', async ({ where }) => (where.id === ACCOUNT_ID ? ACCOUNT : null));
  stub(t, prisma.library, 'findUnique', async () => LIBRARY);
  stub(t, prisma.run, 'findFirst', async () => ({ id: RUN_ID, status: 'success' }));
  stub(t, prisma.calendarLink, 'findUnique', async ({ where, select }) => {
    if (where.householdId !== HOUSEHOLD_ID) return null;
    if (!select) return LINK;
    const { refreshTokenEncrypted, id, householdId, calendarId, ...status } = LINK;
    return { ...status, connectedUser: { email: 'demo@example.com' } };
  });

  const sideEffects = [];
  const trap = (object, name, label, result = {}) =>
    stub(t, object, name, async (...args) => {
      sideEffects.push(label);
      return result;
    });
  trap(prisma.account, 'create', 'account.create');
  trap(prisma.account, 'update', 'account.update');
  trap(prisma.run, 'create', 'run.create');
  trap(prisma.run, 'update', 'run.update');
  trap(prisma.household, 'update', 'household.update');
  trap(prisma.calendarLink, 'update', 'calendarLink.update');
  trap(prisma.calendarLink, 'create', 'calendarLink.create');
  trap(prisma.calendarLink, 'updateMany', 'calendarLink.updateMany');
  trap(prisma.calendarLink, 'delete', 'calendarLink.delete');
  trap(prisma.calendarRevocation, 'create', 'calendarRevocation.create');
  trap(prisma, '$transaction', '$transaction');
  // routes/accounts.js destructures enqueueRefresh at load, so this trap can't catch it; a refresh
  // that got through would still be caught by the run.create trap, or fail on the missing Redis.
  trap(queue, 'enqueueRefresh', 'queue.enqueueRefresh');
  trap(queue, 'enqueueCalendarSync', 'queue.enqueueCalendarSync');
  trap(google, 'authUrl', 'google.authUrl');
  trap(google, 'exchangeCode', 'google.exchangeCode');
  trap(google, 'createCalendar', 'google.createCalendar');
  trap(crypto, 'encryptCredentials', 'encryptCredentials');
  return { sideEffects };
}

async function call(t, method, path, { token, body } = {}) {
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

const demo = (t, method, path, body) => call(t, method, path, { token: signToken(DEMO_OWNER, { demo: true }), body });
const member = (t, method, path, body) => call(t, method, path, { token: signToken(MEMBER), body });

const CAL = `/households/${HOUSEHOLD_ID}/calendar`;
const NEW_CARD = { libraryId: LIBRARY_ID, displayName: 'Ana', credentials: { username: '1234', pin: '5678' } };

// ---- The policies ----------------------------------------------------------------

test('members are allowed everything; demo can simulate the in-app actions and nothing else', () => {
  assert.ok(Object.values(policiesFor('member')).every((policy) => policy === 'allow'));
  assert.deepEqual(policiesFor('demo'), {
    'account.refresh': 'simulate',
    'account.delete': 'simulate',
    'account.create': 'simulate',
    'household.rename': 'simulate',
    'calendar.connect': 'deny',
    'calendar.update': 'simulate',
    'calendar.disconnect': 'simulate',
    'identity.link-google': 'deny',
  });
  assert.deepEqual(Object.keys(policiesFor('demo')).sort(), [...CAPABILITIES].sort());
});

test('GET /me reports the caller\'s role and capabilities', async (t) => {
  stub(t, prisma.user, 'findUnique', async () => ({ id: DEMO_OWNER, email: 'demo@example.com', householdMembers: [] }));
  const asDemo = await demo(t, 'GET', '/me');
  assert.equal(asDemo.body.role, 'demo');
  assert.equal(asDemo.body.capabilities['calendar.connect'], 'deny');
  assert.equal(asDemo.body.capabilities['account.refresh'], 'simulate');

  const asMember = await member(t, 'GET', '/me');
  assert.equal(asMember.body.role, 'member');
  assert.equal(asMember.body.capabilities['calendar.connect'], 'allow');
});

// ---- Denied ----------------------------------------------------------------------

test('demo is refused calendar connect and Google linking, and nothing is called', async (t) => {
  const { sideEffects } = world(t);
  const attempts = [
    ['POST', `${CAL}/connect/start`, { codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM' }],
    ['POST', `${CAL}/connect/finish`, { code: 'c', state: 's', verifier: 'v', timeZone: 'UTC' }],
    ['POST', '/me/google', { idToken: 'x' }],
    ['DELETE', '/me/google'],
  ];
  for (const [method, path, body] of attempts) {
    const { status } = await demo(t, method, path, body);
    assert.equal(status, 403, `${method} ${path}`);
  }
  assert.deepEqual(sideEffects, []);
});

test('a write nobody has mapped to a capability is denied for demo, even if the route exists', async (t) => {
  world(t);
  // Unmapped paths: for demo this is a 403 from the role's default, not the 404 a member gets.
  assert.equal((await demo(t, 'POST', `/households/${HOUSEHOLD_ID}/things`, {})).status, 403);
  assert.equal((await demo(t, 'PUT', `/accounts/${ACCOUNT_ID}`, {})).status, 403);
  assert.equal((await member(t, 'POST', `/households/${HOUSEHOLD_ID}/things`, {})).status, 404);
});

test('a demo token still reads normally', async (t) => {
  world(t);
  assert.equal((await demo(t, 'GET', CAL)).status, 200);
});

// ---- Simulated: no side effects, the real response shape --------------------------

test('simulated refresh answers with the settled seeded run and enqueues nothing', async (t) => {
  const { sideEffects } = world(t);
  const { status, body } = await demo(t, 'POST', `/accounts/${ACCOUNT_ID}/refresh`);
  assert.equal(status, 202);
  assert.deepEqual(body, { runId: RUN_ID, status: 'success' });
  assert.deepEqual(sideEffects, []);
});

test('simulated refresh still honors the refresh flag and account access', async (t) => {
  world(t);
  setEnv(t, { REFRESH_ENABLED: 'false' });
  assert.equal((await demo(t, 'POST', `/accounts/${ACCOUNT_ID}/refresh`)).status, 404);

  setEnv(t, { REFRESH_ENABLED: 'true' });
  stub(t, prisma.householdMember, 'findUnique', async () => null);
  assert.equal((await demo(t, 'POST', `/accounts/${ACCOUNT_ID}/refresh`)).status, 403);
});

test('simulated add-card validates like the real one, stores nothing and returns a card-shaped account', async (t) => {
  const { sideEffects } = world(t);
  const url = `/households/${HOUSEHOLD_ID}/accounts`;

  assert.equal((await demo(t, 'POST', url, { displayName: 'Ana' })).status, 400);
  assert.equal((await demo(t, 'POST', url, { ...NEW_CARD, libraryId: 'nope' })).status, 400);
  stub(t, prisma.library, 'findUnique', async () => ({ ...LIBRARY, isActive: false }));
  assert.equal((await demo(t, 'POST', url, NEW_CARD)).status, 400);
  stub(t, prisma.library, 'findUnique', async () => LIBRARY);

  const { status, body } = await demo(t, 'POST', url, NEW_CARD);
  assert.equal(status, 201);
  assert.equal(body.account.displayName, 'Ana');
  assert.equal(body.account.householdId, HOUSEHOLD_ID);
  assert.ok(!JSON.stringify(body).includes('5678'), 'the PIN must not come back');
  assert.ok(!('credentialsEncrypted' in body.account));
  assert.deepEqual(sideEffects, []);
});

test('simulated add-card has the same shape as the real response', async (t) => {
  world(t);
  const url = `/households/${HOUSEHOLD_ID}/accounts`;
  const simulated = await demo(t, 'POST', url, NEW_CARD);

  // The real handler, given a full row as Prisma returns it (every column of `accounts`).
  const row = {
    id: ACCOUNT_ID, householdId: HOUSEHOLD_ID, displayName: 'Ana', libraryId: LIBRARY_ID,
    scraperType: 'bibliocommons', scraperConfig: {}, credentialsEncrypted: 'x', scheduleCron: '0 6 * * *',
    lastRunAt: null, lastStatus: null, deletedAt: null,
  };
  stub(t, prisma.account, 'create', async () => row);
  const real = await member(t, 'POST', url, NEW_CARD);

  assert.equal(real.status, simulated.status);
  assert.deepEqual(Object.keys(simulated.body.account).sort(), Object.keys(real.body.account).sort());
});

test('simulated delete and rename change nothing', async (t) => {
  const { sideEffects } = world(t);
  assert.equal((await demo(t, 'DELETE', `/accounts/${ACCOUNT_ID}`)).status, 204);

  const rename = await demo(t, 'PATCH', `/households/${HOUSEHOLD_ID}`, { name: '  Our Home ' });
  assert.deepEqual(rename.body, { household: { id: HOUSEHOLD_ID, name: 'Our Home' } });
  assert.equal((await demo(t, 'PATCH', `/households/${HOUSEHOLD_ID}`, { name: ' ' })).status, 400);
  assert.deepEqual(sideEffects, []);
});

test('simulated rename has the same shape as the real response', async (t) => {
  world(t);
  const url = `/households/${HOUSEHOLD_ID}`;
  const simulated = await demo(t, 'PATCH', url, { name: 'Our Home' });
  stub(t, prisma.household, 'update', async () => ({ id: HOUSEHOLD_ID, name: 'Our Home', ownerUserId: 'x', isDemo: false }));
  const real = await member(t, 'PATCH', url, { name: 'Our Home' });
  assert.deepEqual(simulated.body, real.body);
});

test('simulated calendar settings validate like the real ones, show the change, and save and sync nothing', async (t) => {
  const { sideEffects } = world(t);

  assert.equal((await demo(t, 'PATCH', CAL, { reminderTime: 481 })).status, 400);
  assert.equal((await demo(t, 'PATCH', CAL, { timeZone: 'Mars/Base' })).status, 400);
  assert.equal((await demo(t, 'PATCH', CAL, {})).status, 400);

  const { status, body } = await demo(t, 'PATCH', CAL, { reminderTime: 600, showTitles: false });
  assert.equal(status, 200);
  assert.equal(body.calendar.reminderTime, 600);
  assert.equal(body.calendar.showTitles, false);
  assert.equal(body.calendar.timeZone, 'America/Los_Angeles'); // untouched settings come from storage
  assert.equal(body.calendar.isYou, true);
  assert.ok(!JSON.stringify(body).includes('encrypted'));
  assert.deepEqual(sideEffects, []);
});

test('simulated calendar disconnect queues no revocation and removes nothing', async (t) => {
  const { sideEffects } = world(t);
  assert.equal((await demo(t, 'DELETE', `${CAL}?deleteCalendar=true`)).status, 204);
  assert.deepEqual(sideEffects, []);
});

test('simulated calendar routes are hidden while the calendar flag is off, and need a connected calendar', async (t) => {
  world(t);
  setEnv(t, { CALENDAR_ENABLED: 'false' });
  assert.equal((await demo(t, 'PATCH', CAL, { showTitles: false })).status, 404);

  setEnv(t, { CALENDAR_ENABLED: 'true' });
  stub(t, prisma.calendarLink, 'findUnique', async () => null);
  assert.equal((await demo(t, 'PATCH', CAL, { showTitles: false })).status, 404);
});

// ---- Members are unaffected ------------------------------------------------------

test('a member\'s writes still reach the real handlers', async (t) => {
  const { sideEffects } = world(t);
  const updates = stub(t, prisma.account, 'update', async () => ({}));
  assert.equal((await member(t, 'DELETE', `/accounts/${ACCOUNT_ID}`)).status, 204);
  assert.equal(updates.length, 1);
  assert.ok(updates[0][0].data.deletedAt instanceof Date);
  assert.deepEqual(sideEffects, []); // the account.update trap was replaced by the stub above
});

test('simulations look up the household and account named in the path, not whoever is first', async (t) => {
  world(t);
  const OTHER = '9b1c2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e';
  assert.equal((await demo(t, 'PATCH', `/households/${OTHER}`, { name: 'x' })).status, 403);
  assert.equal((await demo(t, 'DELETE', `/accounts/${OTHER}`)).status, 404);
  assert.equal((await demo(t, 'PATCH', `/households/${OTHER}/calendar`, { showTitles: false })).status, 403);
  assert.equal((await demo(t, 'POST', `/households/${OTHER}/accounts`, NEW_CARD)).status, 403);
});
