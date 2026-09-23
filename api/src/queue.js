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
function getQueue() {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, { connection: createConnection() });
  }
  return queue;
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
  await getQueue().add('scrape', { accountId, runId });
}

// Re-syncs one household's calendar reminder (and carries out queued disconnects) after
// a connect, a settings change or a disconnect, on whichever backend scrapes use. The
// daily sync of every household doesn't come through here: it's calendar-sync.yml's
// schedule, or a Render Cron Job running `npm run sync-calendars` on BullMQ.
async function enqueueCalendarSync({ householdId }) {
  if (process.env.SCRAPE_BACKEND === 'github') {
    return dispatchToGithub('calendar-sync.yml', { householdId });
  }
  await getQueue().add('calendar-sync', { householdId });
}

module.exports = { QUEUE_NAME, enqueueRefresh, enqueueCalendarSync };
