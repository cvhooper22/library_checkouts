const IORedis = require('ioredis');
const { Queue } = require('bullmq');

// Must match worker/src/queue.js exactly — same queue name, same connection
// handling, and job names and payloads worker/src/jobs.js knows how to handle.
const QUEUE_NAME = 'scrape-jobs';

function createConnection() {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error('REDIS_URL is not set');
  }
  return new IORedis(url, { maxRetriesPerRequest: null });
}

let queue;
let connection;
function getQueue() {
  if (!queue) {
    connection = createConnection();
    queue = new Queue(QUEUE_NAME, { connection });
  }
  return queue;
}

// Drops the queue and its Redis connection; the next enqueue opens fresh ones. BullMQ
// doesn't own a connection it was handed, so it won't close it for us (same as
// worker/src/enqueueDaily.js). Disconnecting first also fails any add still waiting on a
// Redis that's down, so closing never hangs on one.
async function closeQueue() {
  if (!queue) return;
  const [closing, open] = [queue, connection];
  queue = connection = undefined;
  open.disconnect();
  await closing.close().catch(() => {});
}

// maxRetriesPerRequest: null (which BullMQ requires) makes a command wait for Redis
// indefinitely, so with Redis down an add would hang the API request that made it. Give
// up after a few seconds instead, so callers take their failure path: a refresh marks its
// run failed, a calendar change still succeeds and leaves it to the daily sync. The add
// itself isn't cancelled, so if Redis comes back the job can still land late; both kinds
// of job are safe to run then.
const ENQUEUE_TIMEOUT_MS = 5_000;

async function addJob(name, data) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Redis did not accept the ${name} job within ${ENQUEUE_TIMEOUT_MS / 1000}s`)),
      ENQUEUE_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([getQueue().add(name, data), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// SCRAPE_BACKEND=github: no queue or worker. Start a workflow in .github/workflows that runs
// the same code on a GitHub runner: scrape.yml (worker/scripts/run-scrape.js) or
// calendar-sync.yml (worker/scripts/sync-calendars.js).
async function dispatchToGithub(workflow, inputs) {
  const { GITHUB_REPO, GITHUB_DISPATCH_TOKEN, GITHUB_REF = 'main' } = process.env;
  if (!GITHUB_REPO || !GITHUB_DISPATCH_TOKEN) {
    throw new Error('GITHUB_REPO and GITHUB_DISPATCH_TOKEN must be set when SCRAPE_BACKEND=github');
  }

  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${workflow}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GITHUB_DISPATCH_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: GITHUB_REF, inputs }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) {
    throw new Error(`GitHub workflow dispatch failed: ${response.status} ${await response.text()}`);
  }
}

// runId points at a `runs` row the caller already created, so the API can hand
// the frontend a real run_id immediately (architecture.md §6) instead of waiting
// for the worker to create one, as the cron path (enqueueDaily.js) still does.
async function enqueueRefresh({ accountId, runId }) {
  if (process.env.SCRAPE_BACKEND === 'github') {
    return dispatchToGithub('scrape.yml', { accountId, runId });
  }
  await addJob('scrape', { accountId, runId });
}

// Re-syncs one household's calendar reminder (and carries out queued disconnects) after
// a connect, a settings change or a disconnect, on whichever backend scrapes use. The
// daily sync of every household doesn't come through here: it's calendar-sync.yml's
// schedule, or a Render Cron Job running `npm run sync-calendars` on BullMQ.
async function enqueueCalendarSync({ householdId }) {
  if (process.env.SCRAPE_BACKEND === 'github') {
    return dispatchToGithub('calendar-sync.yml', { householdId });
  }
  await addJob('calendar-sync', { householdId });
}

module.exports = { QUEUE_NAME, ENQUEUE_TIMEOUT_MS, enqueueRefresh, enqueueCalendarSync, closeQueue };
