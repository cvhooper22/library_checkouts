const { Worker } = require('bullmq');
const { QUEUE_NAME, createConnection } = require('./queue');
const { runScrape } = require('./runScrape');

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY || 1);

// One BullMQ job = one account scrape. The scrape itself lives in runScrape.js so
// it can also be run without the queue (see admin/server.js).
const worker = new Worker(QUEUE_NAME, (job) => runScrape(job.data), {
  connection: createConnection(),
  concurrency: CONCURRENCY,
});

worker.on('completed', (job) => {
  console.log(`[worker] job ${job.id} (account ${job.data.accountId}) completed`);
});

worker.on('failed', (job, error) => {
  console.error(`[worker] job ${job?.id} (account ${job?.data?.accountId}) failed:`, error.message);
});

console.log(`[worker] listening on queue "${QUEUE_NAME}" with concurrency ${CONCURRENCY}`);
