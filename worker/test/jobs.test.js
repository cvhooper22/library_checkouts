process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/db';

const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('@library-tracker/db');
const { processJob } = require('../src/jobs');

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

test('scrape jobs go to runScrape', async (t) => {
  // A deleted account makes runScrape return early, before any scraping.
  const lookups = stub(t, prisma.account, 'findUniqueOrThrow', async () => ({ id: 'account-1', deletedAt: new Date() }));
  stub(t, console, 'log', () => {});

  assert.deepEqual(await processJob({ name: 'scrape', data: { accountId: 'account-1' } }), { skipped: true });
  assert.deepEqual(lookups[0][0], { where: { id: 'account-1' } });
});

test('calendar-sync jobs sync that household, then the revocation queue', async (t) => {
  const links = stub(t, prisma.calendarLink, 'findUnique', async () => null);
  const revocations = stub(t, prisma.calendarRevocation, 'findMany', async () => []);

  assert.deepEqual(await processJob({ name: 'calendar-sync', data: { householdId: HOUSEHOLD_ID } }), { skipped: true });
  assert.deepEqual(links[0][0].where, { householdId: HOUSEHOLD_ID });
  assert.equal(revocations.length, 1);
});

test('the revocation queue still runs when the household sync fails', async (t) => {
  stub(t, prisma.calendarLink, 'findUnique', async () => {
    throw new Error('database hiccup');
  });
  const revocations = stub(t, prisma.calendarRevocation, 'findMany', async () => []);

  await assert.rejects(processJob({ name: 'calendar-sync', data: { householdId: HOUSEHOLD_ID } }), /database hiccup/);
  assert.equal(revocations.length, 1);
});

test('an unknown job name fails instead of being treated as a scrape', () => {
  assert.throws(() => processJob({ name: 'mystery', data: {} }), /No handler for job "mystery"/);
});
