// Syncs Google Calendar reminders with no scrape, for the daily GitHub Actions run
// (.github/workflows/calendar-sync.yml) and by hand. On BullMQ the same script runs as a
// Render Cron Job, so switching backends doesn't change what a sync does.
//   HOUSEHOLD_ID  one household (after a connect, settings change or disconnect), then
//                 the revocation queue, so a disconnect is carried out right away
//   unset         every linked household, then the revocation queue (the daily run)
// Locally: node --env-file=.env scripts/sync-calendars.js
const prisma = require('@library-tracker/db');
const { syncHouseholdCalendar, processRevocations, syncAllCalendars } = require('../src/calendarSync');

async function syncOne(householdId) {
  let failed = 0;
  try {
    console.log(`[sync-calendars] household ${householdId}:`, await syncHouseholdCalendar(householdId));
  } catch (error) {
    failed += 1;
    console.error(`[sync-calendars] household ${householdId} failed: ${error.message}`);
  }
  const revocations = await processRevocations();
  console.log(`[sync-calendars] revocations: ${revocations.processed - revocations.failed}/${revocations.processed} done`);
  return failed + revocations.failed;
}

async function main() {
  const { HOUSEHOLD_ID } = process.env;
  if (HOUSEHOLD_ID) return syncOne(HOUSEHOLD_ID);

  const { links, failed } = await syncAllCalendars();
  console.log(`[sync-calendars] ${links} linked household(s), ${failed} failure(s)`);
  return failed;
}

// One failure doesn't stop the rest, but the job still ends red so it gets noticed.
main()
  .then((failed) => { process.exitCode = failed > 0 ? 1 : 0; })
  .catch((error) => {
    console.error('[sync-calendars] failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
