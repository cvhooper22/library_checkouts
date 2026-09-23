process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/db';
process.env.CREDENTIAL_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');

const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('@library-tracker/db');
const { encryptCredentials } = require('../src/crypto');
const { runScrape } = require('../src/runScrape');

const HOUSEHOLD_ID = '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90';

// Same approach as calendarSync.test.js: stub Prisma delegates by assignment.
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

// One account on a dev fixture scraper (no browser, no delay), with every write stubbed.
// The calendar sync's first query is calendarLink.findUnique, so `findLink` decides what
// the sync sees.
function scrapeSetup(t, { scraperType, findLink }) {
  stub(t, prisma.account, 'findUniqueOrThrow', async () => ({
    id: 'account-1',
    householdId: HOUSEHOLD_ID,
    deletedAt: null,
    scraperType,
    scraperConfig: { delayMs: 0 },
    credentialsEncrypted: encryptCredentials({}),
  }));
  stub(t, prisma.run, 'create', async () => ({ id: 'run-1' }));
  const runUpdates = stub(t, prisma.run, 'update', async () => ({}));
  stub(t, prisma.account, 'update', async () => ({}));
  stub(t, prisma.checkout, 'updateMany', async () => ({ count: 0 }));
  stub(t, console, 'error', () => {});
  return { runUpdates, linkLookups: stub(t, prisma.calendarLink, 'findUnique', findLink) };
}

test('a successful scrape syncs its household\'s calendar', async (t) => {
  const { linkLookups } = scrapeSetup(t, { scraperType: 'test-empty', findLink: async () => null });

  assert.deepEqual(await runScrape({ accountId: 'account-1' }), { runId: 'run-1' });
  assert.equal(linkLookups.length, 1);
  assert.deepEqual(linkLookups[0][0].where, { householdId: HOUSEHOLD_ID });
});

test('a calendar sync failure never fails the scrape', async (t) => {
  const { runUpdates } = scrapeSetup(t, {
    scraperType: 'test-empty',
    findLink: async () => {
      throw new Error('calendar is down');
    },
  });

  assert.deepEqual(await runScrape({ accountId: 'account-1' }), { runId: 'run-1' });
  assert.deepEqual(runUpdates.map(([args]) => args.data.status), ['success']);
});

test('a failed scrape does not sync the calendar', async (t) => {
  const { linkLookups } = scrapeSetup(t, { scraperType: 'test-failure', findLink: async () => null });

  await assert.rejects(runScrape({ accountId: 'account-1' }), /Simulated scraper failure/);
  assert.equal(linkLookups.length, 0);
});
