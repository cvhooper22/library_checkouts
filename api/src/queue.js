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

// SCRAPE_BACKEND=github: no queue or worker. Start .github/workflows/scrape.yml, which
// runs worker/scripts/run-scrape.js for this one account on a GitHub runner.
async function dispatchToGithub({ accountId, runId }) {
  const { GITHUB_REPO, GITHUB_DISPATCH_TOKEN, GITHUB_REF = 'main' } = process.env;
  if (!GITHUB_REPO || !GITHUB_DISPATCH_TOKEN) {
    throw new Error('GITHUB_REPO and GITHUB_DISPATCH_TOKEN must be set when SCRAPE_BACKEND=github');
  }

  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/scrape.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GITHUB_DISPATCH_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: GITHUB_REF, inputs: { accountId, runId } }),
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
    return dispatchToGithub({ accountId, runId });
  }
  await getQueue().add('scrape', { accountId, runId });
}

module.exports = { QUEUE_NAME, enqueueRefresh };
