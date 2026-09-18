const IORedis = require('ioredis');
const { Queue } = require('bullmq');

// Must match worker/src/queue.js exactly — same queue name, same connection
// handling, and job payloads the worker in worker/src/index.js knows how to read.
const QUEUE_NAME = 'scrape-jobs';

function createConnection() {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error('REDIS_URL is not set');
  }
  return new IORedis(url, { maxRetriesPerRequest: null });
}

let queue;
function getQueue() {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, { connection: createConnection() });
  }
  return queue;
}

// runId points at a `runs` row the caller already created, so the API can hand
// the frontend a real run_id immediately (architecture.md §6) instead of waiting
// for the worker to create one, as the cron path (enqueueDaily.js) still does.
async function enqueueRefresh({ accountId, runId }) {
  await getQueue().add('scrape', { accountId, runId });
}

module.exports = { QUEUE_NAME, enqueueRefresh };
