// Regenerates the shared demo household's checkouts/runs from scratch.
//
// This is NOT a BullMQ job and must never become one — see adr/0002-demo-mode.md.
// It's meant to run on its own Render Cron Job schedule, independent of
// enqueueDaily.js, calling the `demo` scraper module directly in-process.
// Safe to run repeatedly: every run fully replaces the demo accounts'
// runs/checkouts rather than diffing against previous state.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const prisma = require('@library-tracker/db');
const { getScraper } = require('../src/scrapers');
const { validateScrapeResult } = require('../src/scrapers/validate');
const { encryptCredentials } = require('../src/crypto');

const DEMO_USER_EMAIL = 'demo@library-tracker.app';
const DEMO_HOUSEHOLD_NAME = 'Demo Household';
const DEMO_LIBRARY_NAME = 'Demo Public Library';
const DEMO_ACCOUNT_NAMES = ['Ana', 'Sam'];
const SCRAPER_VERSION = 'demo';

async function ensureDemoUser() {
  const passwordHash = await bcrypt.hash(require('crypto').randomBytes(24).toString('hex'), 10);
  return prisma.user.upsert({
    where: { email: DEMO_USER_EMAIL },
    update: {},
    create: { email: DEMO_USER_EMAIL, passwordHash },
  });
}

async function ensureDemoHousehold(ownerUserId) {
  const existing = await prisma.household.findFirst({ where: { isDemo: true } });
  if (existing) return existing;
  return prisma.household.create({
    data: { name: DEMO_HOUSEHOLD_NAME, ownerUserId, isDemo: true },
  });
}

async function ensureHouseholdMember(householdId, userId) {
  await prisma.householdMember.upsert({
    where: { householdId_userId: { householdId, userId } },
    update: {},
    create: { householdId, userId, role: 'owner' },
  });
}

async function ensureDemoLibrary() {
  const existing = await prisma.library.findFirst({ where: { scraperTypeDefault: 'demo' } });
  if (existing) return existing;
  return prisma.library.create({
    // isActive: false keeps it out of GET /libraries — the demo scraper isn't a real choice.
    data: { slug: 'demo', name: DEMO_LIBRARY_NAME, baseUrl: 'https://demo.invalid', scraperTypeDefault: 'demo', isActive: false },
  });
}

async function ensureDemoAccounts(householdId, libraryId) {
  const existing = await prisma.account.findMany({ where: { householdId } });
  if (existing.length > 0) return existing;

  const accounts = [];
  for (let i = 0; i < DEMO_ACCOUNT_NAMES.length; i++) {
    // Demo scraper ignores credentials, but the column is NOT NULL — encrypt an
    // empty object so the row is a valid, real credentials_encrypted blob.
    const credentialsEncrypted = encryptCredentials({});
    const account = await prisma.account.create({
      data: {
        householdId,
        displayName: DEMO_ACCOUNT_NAMES[i],
        libraryId,
        scraperType: 'demo',
        scraperConfig: { seed: i },
        credentialsEncrypted,
      },
    });
    accounts.push(account);
  }
  return accounts;
}

async function reseedAccount(account) {
  const scraper = getScraper(account.scraperType);
  const result = await scraper.scrape({ credentials: {}, config: account.scraperConfig });
  validateScrapeResult(result);

  // Full replace: checkouts have an FK to runs (RESTRICT), so clear child rows
  // before parent rows. There's no real prior state worth diffing here.
  await prisma.checkout.deleteMany({ where: { accountId: account.id } });
  await prisma.run.deleteMany({ where: { accountId: account.id } });

  const now = new Date();
  const run = await prisma.run.create({
    data: {
      accountId: account.id,
      startedAt: now,
      finishedAt: now,
      status: 'success',
      scraperVersion: SCRAPER_VERSION,
      rawOutput: result,
    },
  });

  for (const item of result.checkouts) {
    await prisma.checkout.create({
      data: {
        accountId: account.id,
        runId: run.id,
        externalId: item.externalId,
        title: item.title,
        dueDate: new Date(item.dueDate),
        overdue: item.overdue,
        imgSrc: item.imgSrc ?? null,
      },
    });
  }

  await prisma.account.update({
    where: { id: account.id },
    data: { lastRunAt: now, lastStatus: 'success' },
  });

  return result.checkouts.length;
}

async function main() {
  const user = await ensureDemoUser();
  const household = await ensureDemoHousehold(user.id);
  await ensureHouseholdMember(household.id, user.id);
  const library = await ensureDemoLibrary();
  const accounts = await ensureDemoAccounts(household.id, library.id);

  let total = 0;
  for (const account of accounts) {
    total += await reseedAccount(account);
  }

  console.log(`[reseed-demo] household ${household.id}: reseeded ${accounts.length} account(s), ${total} checkout(s)`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('[reseed-demo] failed:', error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
