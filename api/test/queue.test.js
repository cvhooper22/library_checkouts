const test = require('node:test');
const assert = require('node:assert/strict');
const { enqueueRefresh, enqueueCalendarSync } = require('../src/queue');

// SCRAPE_BACKEND=github: each trigger starts its own workflow with its own inputs. The
// BullMQ side needs a live Redis, so it isn't covered here.
function githubBackend(t) {
  const env = {
    SCRAPE_BACKEND: 'github',
    GITHUB_REPO: 'owner/repo',
    GITHUB_DISPATCH_TOKEN: 'dispatch-token',
    GITHUB_REF: 'main',
  };
  const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return new Response(null, { status: 204 });
  });
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  return requests;
}

test('enqueueRefresh starts scrape.yml for the account and run', async (t) => {
  const requests = githubBackend(t);

  await enqueueRefresh({ accountId: 'account-1', runId: 'run-1' });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.github.com/repos/owner/repo/actions/workflows/scrape.yml/dispatches');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer dispatch-token');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    ref: 'main',
    inputs: { accountId: 'account-1', runId: 'run-1' },
  });
});

test('enqueueCalendarSync starts calendar-sync.yml for the household', async (t) => {
  const requests = githubBackend(t);

  await enqueueCalendarSync({ householdId: 'household-1' });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.github.com/repos/owner/repo/actions/workflows/calendar-sync.yml/dispatches');
  assert.deepEqual(JSON.parse(requests[0].options.body), { ref: 'main', inputs: { householdId: 'household-1' } });
});

test('a failed dispatch is an error, not a silent no-op', async (t) => {
  githubBackend(t);
  t.mock.method(globalThis, 'fetch', async () => new Response('Not Found', { status: 404 }));

  await assert.rejects(enqueueCalendarSync({ householdId: 'household-1' }), /GitHub workflow dispatch failed: 404 Not Found/);
});
