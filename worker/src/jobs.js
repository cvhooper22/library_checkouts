const { runScrape } = require('./runScrape');
const { syncHouseholdCalendar, processRevocations } = require('./calendarSync');

// BullMQ job name -> handler. The API (api/src/queue.js) and enqueueDaily.js pick the
// name; with SCRAPE_BACKEND=github the same work runs in GitHub Actions instead, through
// the scripts in worker/scripts.
const HANDLERS = {
  // One account scrape; runScrape also syncs that household's calendar when it's done.
  scrape: (data) => runScrape(data),

  // After a calendar connect, settings change or disconnect. The revocation queue runs
  // even if the household's sync fails, so a disconnect is never held up by it.
  'calendar-sync': async ({ householdId }) => {
    try {
      return await syncHouseholdCalendar(householdId);
    } finally {
      await processRevocations();
    }
  },
};

function processJob(job) {
  const handler = HANDLERS[job.name];
  if (!handler) {
    throw new Error(`No handler for job "${job.name}"`);
  }
  return handler(job.data);
}

module.exports = { processJob };
