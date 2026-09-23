const { Worker } = require('bullmq');
const { QUEUE_NAME, createConnection } = require('./queue');
const { processJob } = require('./jobs');

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY || 1);

// One BullMQ job = one account scrape or one household's calendar sync, routed by job
// name in jobs.js. The work itself lives in runScrape.js and calendarSync.js so it can
// also run without the queue (see admin/server.js and worker/scripts).
const worker = new Worker(QUEUE_NAME, processJob, {
  connection: createConnection(),
  concurrency: CONCURRENCY,
});

// Scrape jobs carry an accountId, calendar-sync jobs a householdId.
const describe = (job) => `job ${job?.id} (${job?.name} ${job?.data?.accountId ?? job?.data?.householdId})`;

worker.on('completed', (job) => {
  console.log(`[worker] ${describe(job)} completed`);
});

worker.on('failed', (job, error) => {
  console.error(`[worker] ${describe(job)} failed:`, error.message);
});

console.log(`[worker] listening on queue "${QUEUE_NAME}" with concurrency ${CONCURRENCY}`);
