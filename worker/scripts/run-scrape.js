// Runs scrapes with no queue, for the GitHub Actions workflow (.github/workflows/scrape.yml).
//   ACCOUNT_ID [+ RUN_ID]  one on-demand scrape, answering the run row the API created
//   neither                scheduled: every account in the households listed in
//                          SCHEDULED_HOUSEHOLD_IDS (comma-separated), one at a time
// Locally: node --env-file=.env scripts/run-scrape.js
const prisma = require('@library-tracker/db');
const { runScrape } = require('../src/runScrape');

// Same exclusions as enqueueDaily.js: demo accounts are reseeded separately, and deleted
// accounts aren't scraped. An empty list selects nothing, so an unset variable is a no-op.
async function findScheduledAccounts(householdIdsCsv) {
  const householdIds = householdIdsCsv.split(',').map((id) => id.trim()).filter(Boolean);
  if (householdIds.length === 0) return [];
  return prisma.account.findMany({
    where: { householdId: { in: householdIds }, household: { isDemo: false }, deletedAt: null },
    select: { id: true, displayName: true },
    orderBy: { displayName: 'asc' },
  });
}

// One failure must not stop the rest, but the job still ends red so it gets noticed.
async function runScheduled(householdIdsCsv) {
  const accounts = await findScheduledAccounts(householdIdsCsv);
  if (accounts.length === 0) {
    console.log('[run-scrape] SCHEDULED_HOUSEHOLD_IDS matched no accounts; nothing to do');
    return 0;
  }

  let failed = 0;
  for (const account of accounts) {
    try {
      await runScrape({ accountId: account.id });
      console.log(`[run-scrape] ${account.displayName}: ok`);
    } catch (error) {
      failed += 1;
      console.error(`[run-scrape] ${account.displayName}: failed: ${error.message}`);
    }
  }
  console.log(`[run-scrape] ${accounts.length - failed}/${accounts.length} succeeded`);
  return failed;
}

async function main() {
  const { ACCOUNT_ID, RUN_ID, SCHEDULED_HOUSEHOLD_IDS = '' } = process.env;
  if (ACCOUNT_ID) {
    await runScrape({ accountId: ACCOUNT_ID, runId: RUN_ID || undefined });
    return 0;
  }
  return runScheduled(SCHEDULED_HOUSEHOLD_IDS);
}

if (require.main === module) {
  main()
    .then((failed) => { process.exitCode = failed > 0 ? 1 : 0; })
    .catch((error) => {
      console.error('[run-scrape] failed:', error.message);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

module.exports = { findScheduledAccounts };
