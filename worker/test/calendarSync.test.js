process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/db';
process.env.CREDENTIAL_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');

const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('@library-tracker/db');
const { encryptCredentials } = require('../src/crypto');
const { eventIdFor } = require('../src/calendarEvent');
const { EXPIRED_MESSAGE, syncHouseholdCalendar, processRevocations } = require('../src/calendarSync');

const HOUSEHOLD_ID = '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90';
const EVENT_ID = eventIdFor(HOUSEHOLD_ID);
const NOW = new Date('2026-10-05T14:00:00Z'); // 07:00 in Los Angeles

// Same approach as api/test/auth.google.test.js: Prisma's delegates reject
// t.mock.method, so stub by assignment and restore afterwards.
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

function httpError(status, oauthError) {
  const error = new Error(oauthError || `HTTP ${status}`);
  error.status = status;
  if (oauthError) error.response = { status, data: { error: oauthError } };
  return error;
}

// Records every Google call; `fail` maps a call name to the error it should throw.
function fakeGoogle(fail = {}) {
  const calls = [];
  const tokens = [];
  const call = (name) => async (params) => {
    calls.push([name, params]);
    if (fail[name]) throw fail[name];
  };
  return {
    calls,
    tokens,
    createClient(refreshToken) {
      tokens.push(refreshToken);
      return {
        oauth: { revokeToken: call('revokeToken') },
        calendar: {
          events: { update: call('events.update'), insert: call('events.insert'), delete: call('events.delete') },
          calendars: { delete: call('calendars.delete') },
        },
      };
    },
  };
}

const LINK = {
  id: 'link-1',
  householdId: HOUSEHOLD_ID,
  connectedUserId: 'user-1',
  refreshTokenEncrypted: encryptCredentials({ refreshToken: 'refresh-token' }),
  calendarId: 'library-due-dates@group.calendar.google.com',
  reminderTime: 480,
  timeZone: 'America/Los_Angeles',
  showTitles: true,
  enabled: true,
  household: { isDemo: false },
};

const DUNE = { title: 'Dune', dueDate: new Date('2026-10-09T00:00:00Z'), returnedAt: null, account: { displayName: 'Ian', deletedAt: null } };

// A linked household whose connected user is still a member, with these checkouts.
function linkedHousehold(t, { link = LINK, checkouts = [DUNE], member = true } = {}) {
  stub(t, prisma.calendarLink, 'findUnique', async () => link);
  stub(t, prisma.householdMember, 'findUnique', async () => (member ? { role: 'owner' } : null));
  return {
    checkoutQueries: stub(t, prisma.checkout, 'findMany', async () => checkouts),
    linkUpdates: stub(t, prisma.calendarLink, 'updateMany', async () => ({ count: 1 })),
  };
}

test('no link, a disabled link, or the demo household: nothing is synced', async (t) => {
  const google = fakeGoogle();
  for (const link of [null, { ...LINK, enabled: false }, { ...LINK, household: { isDemo: true } }]) {
    const findLink = stub(t, prisma.calendarLink, 'findUnique', async () => link);
    assert.deepEqual(await syncHouseholdCalendar(HOUSEHOLD_ID, { now: NOW, createClient: google.createClient }), { skipped: true });
    assert.equal(findLink.length, 1);
  }
  assert.deepEqual(google.calls, []);
});

test('writes the reminder event on the linked calendar only, by its fixed id', async (t) => {
  const google = fakeGoogle();
  const { checkoutQueries, linkUpdates } = linkedHousehold(t);

  const result = await syncHouseholdCalendar(HOUSEHOLD_ID, { now: NOW, createClient: google.createClient });

  assert.deepEqual(result, { event: 'written' });
  assert.deepEqual(google.tokens, ['refresh-token']);
  // Only this household's checkouts that are still out are loaded.
  assert.deepEqual(checkoutQueries[0][0].where, { returnedAt: null, account: { householdId: HOUSEHOLD_ID } });

  assert.equal(google.calls.length, 1);
  const [name, params] = google.calls[0];
  assert.equal(name, 'events.update');
  assert.equal(params.calendarId, LINK.calendarId);
  assert.equal(params.eventId, EVENT_ID);
  assert.equal(params.requestBody.id, EVENT_ID);
  assert.equal(params.requestBody.status, 'confirmed');
  assert.equal(params.requestBody.start.dateTime, '2026-10-09T08:00:00');

  assert.equal(linkUpdates.length, 1);
  assert.deepEqual(linkUpdates[0][0].where, { id: LINK.id });
  assert.equal(linkUpdates[0][0].data.lastError, null);
  assert.ok(linkUpdates[0][0].data.lastSyncedAt instanceof Date);
});

test('an event that does not exist yet is inserted', async (t) => {
  const google = fakeGoogle({ 'events.update': httpError(404) });
  linkedHousehold(t);

  await syncHouseholdCalendar(HOUSEHOLD_ID, { now: NOW, createClient: google.createClient });

  assert.deepEqual(google.calls.map(([name]) => name), ['events.update', 'events.insert']);
  const [, insert] = google.calls[1];
  assert.equal(insert.calendarId, LINK.calendarId);
  assert.equal(insert.requestBody.id, EVENT_ID);
});

test('nothing checked out: the event is deleted, and an already-gone event is fine', async (t) => {
  const google = fakeGoogle({ 'events.delete': httpError(410) });
  const { linkUpdates } = linkedHousehold(t, { checkouts: [] });

  const result = await syncHouseholdCalendar(HOUSEHOLD_ID, { now: NOW, createClient: google.createClient });

  assert.deepEqual(result, { event: 'deleted' });
  assert.deepEqual(google.calls, [['events.delete', { calendarId: LINK.calendarId, eventId: EVENT_ID }]]);
  assert.equal(linkUpdates[0][0].data.lastError, null);
});

test('an expired or revoked grant disables the link with the reconnect message', async (t) => {
  const google = fakeGoogle({ 'events.update': httpError(400, 'invalid_grant') });
  const { linkUpdates } = linkedHousehold(t);

  await assert.rejects(syncHouseholdCalendar(HOUSEHOLD_ID, { now: NOW, createClient: google.createClient }), /invalid_grant/);

  assert.deepEqual(linkUpdates, [[{ where: { id: LINK.id }, data: { enabled: false, lastError: EXPIRED_MESSAGE } }]]);
});

test('any other Google error is recorded and the link stays enabled', async (t) => {
  const google = fakeGoogle({ 'events.update': httpError(500) });
  const { linkUpdates } = linkedHousehold(t);

  await assert.rejects(syncHouseholdCalendar(HOUSEHOLD_ID, { now: NOW, createClient: google.createClient }));

  assert.deepEqual(linkUpdates, [[{ where: { id: LINK.id }, data: { lastError: 'HTTP 500' } }]]);
});

test('connected user left the household: link dropped and queued for revocation, no Google calls', async (t) => {
  const google = fakeGoogle();
  const { checkoutQueries } = linkedHousehold(t, { member: false });
  const deletes = stub(t, prisma.calendarLink, 'delete', (args) => ({ op: 'delete', args }));
  const creates = stub(t, prisma.calendarRevocation, 'create', (args) => ({ op: 'create', args }));
  const transactions = stub(t, prisma, '$transaction', async (ops) => ops);

  const result = await syncHouseholdCalendar(HOUSEHOLD_ID, { now: NOW, createClient: google.createClient });

  assert.deepEqual(result, { revoked: true });
  assert.equal(transactions.length, 1);
  assert.deepEqual(deletes[0][0], { where: { id: LINK.id } });
  assert.deepEqual(creates[0][0].data, {
    householdId: HOUSEHOLD_ID,
    refreshTokenEncrypted: LINK.refreshTokenEncrypted,
    calendarId: LINK.calendarId,
    eventId: EVENT_ID,
    deleteCalendar: false,
  });
  assert.equal(checkoutQueries.length, 0);
  assert.deepEqual(google.calls, []);
});

const REVOCATION = {
  id: 'rev-1',
  householdId: HOUSEHOLD_ID,
  refreshTokenEncrypted: encryptCredentials({ refreshToken: 'old-token' }),
  calendarId: LINK.calendarId,
  eventId: EVENT_ID,
  deleteCalendar: false,
};

function queued(t, revocations) {
  stub(t, prisma.calendarRevocation, 'findMany', async () => revocations);
  return {
    deleted: stub(t, prisma.calendarRevocation, 'delete', async () => ({})),
    updated: stub(t, prisma.calendarRevocation, 'update', async () => ({})),
  };
}

test('revocation: deletes our event, keeps the calendar unless asked, revokes, then clears the row', async (t) => {
  const google = fakeGoogle();
  const { deleted } = queued(t, [REVOCATION, { ...REVOCATION, id: 'rev-2', deleteCalendar: true }]);

  assert.deepEqual(await processRevocations({ createClient: google.createClient }), { processed: 2, failed: 0 });

  assert.deepEqual(google.calls.map(([name]) => name), [
    'events.delete', 'revokeToken',
    'events.delete', 'calendars.delete', 'revokeToken',
  ]);
  assert.deepEqual(google.calls[0][1], { calendarId: LINK.calendarId, eventId: EVENT_ID });
  assert.deepEqual(google.calls[3][1], { calendarId: LINK.calendarId });
  assert.equal(google.calls[1][1], 'old-token');
  assert.deepEqual(deleted.map(([args]) => args.where.id), ['rev-1', 'rev-2']);
});

test('revocation with a grant that is already gone counts as done', async (t) => {
  const google = fakeGoogle({ 'events.delete': httpError(400, 'invalid_grant') });
  const { deleted, updated } = queued(t, [REVOCATION]);

  assert.deepEqual(await processRevocations({ createClient: google.createClient }), { processed: 1, failed: 0 });
  assert.equal(deleted.length, 1);
  assert.equal(updated.length, 0);
});

test('a failed revocation stays queued with its error', async (t) => {
  const google = fakeGoogle({ revokeToken: httpError(503) });
  const { deleted, updated } = queued(t, [REVOCATION]);

  assert.deepEqual(await processRevocations({ createClient: google.createClient }), { processed: 1, failed: 1 });
  assert.equal(deleted.length, 0);
  assert.deepEqual(updated[0][0], { where: { id: 'rev-1' }, data: { lastError: 'HTTP 503' } });
});
