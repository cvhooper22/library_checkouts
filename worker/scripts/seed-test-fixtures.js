// Recreates the local test libraries and cards described in test-fixtures.json, so the
// refresh flow can be exercised against the real queue and worker without a live library.
// Safe to re-run: everything is keyed on the fixed ids in that file.
//
//   npm run seed-test-fixtures            create/update; a card that already has runs is left alone
//   npm run seed-test-fixtures -- --reset also wipe those cards' runs and checkouts back to initial
//
// Needs the base dev seed first (`npm run seed` in db/), which creates the Dev Household these
// cards attach to. Never runs in production.
require('dotenv').config();
const prisma = require('@library-tracker/db');
const { encryptCredentials } = require('../src/crypto');
const fixtures = require('./test-fixtures.json');

const RESET = process.argv.includes('--reset');

function isoDate(daysFromNow) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d;
}

async function upsertLibrary(library) {
  const data = { ...library, isActive: true };
  await prisma.library.upsert({ where: { id: library.id }, update: data, create: data });
}

async function upsertAccount(householdId, fixture) {
  const { initialCheckouts, credentials, enabled, ...fields } = fixture;
  const data = {
    ...fields,
    householdId,
    credentialsEncrypted: encryptCredentials(credentials),
    deletedAt: null, // a fixture card removed from the UI comes back
  };
  await prisma.account.upsert({ where: { id: fixture.id }, update: data, create: data });
}

// Gives a card the data it'd have from an earlier successful pull, so it has a tab and
// something to be replaced (or, for the failing card, kept) by the next re-stamp.
async function seedInitialRun(fixture) {
  if (RESET) {
    await prisma.checkout.deleteMany({ where: { accountId: fixture.id } });
    await prisma.run.deleteMany({ where: { accountId: fixture.id } });
  } else if ((await prisma.run.count({ where: { accountId: fixture.id } })) > 0) {
    return false;
  }

  const now = new Date();
  const run = await prisma.run.create({
    data: {
      accountId: fixture.id,
      startedAt: now,
      finishedAt: now,
      status: 'success',
      scraperVersion: 'fixture',
    },
  });
  for (const [i, item] of fixture.initialCheckouts.entries()) {
    await prisma.checkout.create({
      data: {
        accountId: fixture.id,
        runId: run.id,
        externalId: `fixture-${i}`,
        title: item.title,
        dueDate: isoDate(item.daysFromNow),
        overdue: item.daysFromNow < 0,
      },
    });
  }
  await prisma.account.update({ where: { id: fixture.id }, data: { lastRunAt: now, lastStatus: 'success' } });
  return true;
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('refusing to seed test fixtures with NODE_ENV=production');
  }

  const household = await prisma.household.findUnique({ where: { id: fixtures.householdId } });
  if (!household) {
    throw new Error(`household ${fixtures.householdId} not found — run \`npm run seed\` in db/ first`);
  }

  for (const library of fixtures.libraries) await upsertLibrary(library);

  for (const account of fixtures.accounts) {
    if (account.enabled === false) {
      // Off: hide the card if an earlier run created it, and don't create it otherwise.
      const { count } = await prisma.account.updateMany({ where: { id: account.id }, data: { deletedAt: new Date() } });
      console.log(`[seed-test-fixtures] ${account.displayName} (${account.scraperType}): disabled${count ? ', removed from the household' : ''}`);
      continue;
    }
    await upsertAccount(household.id, account);
    const seeded = await seedInitialRun(account);
    console.log(`[seed-test-fixtures] ${account.displayName} (${account.scraperType}): ${seeded ? 'seeded initial checkouts' : 'already has runs, left alone'}`);
  }

  const active = fixtures.accounts.filter((a) => a.enabled !== false).length;
  console.log(`[seed-test-fixtures] ${fixtures.libraries.length} librar(ies), ${active} card(s) in "${household.name}"`);
}

main()
  .catch((error) => {
    console.error('[seed-test-fixtures] failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
