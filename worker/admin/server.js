// Local-only admin page for running scrapes by hand, with no Redis or BullMQ.
// Usage: copy .env.admin.example to .env.admin, fill it in, then `npm run admin`
// and open http://127.0.0.1:4100.
//
// It runs the same runScrape() the BullMQ worker does (src/runScrape.js), so
// switching to the queue later changes nothing about how a scrape behaves. It holds
// CREDENTIAL_ENCRYPTION_KEY, which decrypts library logins — keep it on this machine.
const http = require('http');
const fs = require('fs');
const path = require('path');
const prisma = require('@library-tracker/db');
const { runScrape } = require('../src/runScrape');

const HOST = '127.0.0.1';
const PORT = Number(process.env.ADMIN_PORT || 4100);
const RECENT_RUNS = 25;
// A `running` run newer than this that isn't a pending request means a scrape is
// probably in flight somewhere else (e.g. a real worker); don't start a second one.
const BUSY_WINDOW_MS = 10 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Demo accounts are reseeded by scripts/reseed-demo.js and never scraped for real.
const REAL_ACCOUNTS = { deletedAt: null, household: { isDemo: false } };

function checkEnv() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (see .env.admin.example)');
  const key = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!key) throw new Error('CREDENTIAL_ENCRYPTION_KEY is not set (see .env.admin.example)');
  if (Buffer.from(key, 'base64').length !== 32) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY must decode to 32 bytes (openssl rand -base64 32)');
  }
}

// Host and database name only — never the credentials in the URL.
function describeDb() {
  const url = new URL(process.env.DATABASE_URL);
  return {
    host: url.hostname,
    name: url.pathname.slice(1),
    local: ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname),
  };
}

// ---- Scrape scheduling: strictly one at a time, in memory ----------------------
// One scrape at a time keeps Chromium's memory bounded and never hits one library
// account from two triggers at once (architecture.md §5).

const jobs = new Map(); // accountId -> { state: 'queued' | 'running' }
const outcomes = new Map(); // accountId -> { ok, skipped, error, at } for the last scrape this session
let chain = Promise.resolve();

const pendingWhere = (accountId) => ({
  ...(accountId && { accountId }),
  status: 'running',
  scraperVersion: 'pending', // how POST /accounts/:id/refresh marks a request nobody has picked up
  account: REAL_ACCOUNTS,
});

function enqueue(accountId, runId, extraPendingIds) {
  jobs.set(accountId, { state: 'queued' });
  chain = chain.then(async () => {
    jobs.set(accountId, { state: 'running' });
    let outcome;
    try {
      const result = await runScrape({ accountId, runId });
      outcome = { ok: true, skipped: Boolean(result.skipped) };
    } catch (error) {
      console.error(`[admin] scrape for account ${accountId} failed:`, error.message);
      outcome = { ok: false, error: error.message };
    }
    outcomes.set(accountId, { ...outcome, at: new Date() });

    // Refresh clicked more than once while waiting: one scrape answers all of them.
    if (extraPendingIds.length) {
      await prisma.run.updateMany({
        where: { id: { in: extraPendingIds }, status: 'running', scraperVersion: 'pending' },
        data: {
          status: outcome.ok ? 'success' : 'failed',
          finishedAt: new Date(),
          error: outcome.ok ? null : outcome.error,
          scraperVersion: 'superseded',
        },
      }).catch((error) => console.error('[admin] could not settle duplicate requests:', error.message));
    }
    jobs.delete(accountId);
  });
}

// Returns why nothing was queued, or 'queued'.
async function requestRun(accountId) {
  if (jobs.has(accountId)) return 'already-queued';

  const busy = await prisma.run.findFirst({
    where: {
      accountId,
      status: 'running',
      scraperVersion: { not: 'pending' },
      startedAt: { gt: new Date(Date.now() - BUSY_WINDOW_MS) },
    },
    select: { id: true },
  });
  if (busy) return 'in-progress-elsewhere';

  // Answer the newest refresh request the API recorded, so the user's "refreshing…"
  // poll resolves; any older ones are settled when the scrape finishes.
  const pending = await prisma.run.findMany({
    where: pendingWhere(accountId),
    orderBy: { startedAt: 'desc' },
    select: { id: true },
  });
  enqueue(accountId, pending[0]?.id, pending.slice(1).map((run) => run.id));
  return 'queued';
}

async function requestMany(accountIds) {
  const results = { queued: 0, skipped: 0 };
  for (const accountId of accountIds) {
    (await requestRun(accountId)) === 'queued' ? results.queued++ : results.skipped++;
  }
  return results;
}

// ---- Reads ----------------------------------------------------------------------

async function getState() {
  const [accounts, pending, runs] = await Promise.all([
    prisma.account.findMany({
      where: REAL_ACCOUNTS,
      // Explicit select: credentialsEncrypted must never leave this process.
      select: {
        id: true,
        displayName: true,
        scraperType: true,
        lastRunAt: true,
        lastStatus: true,
        library: { select: { name: true } },
        household: { select: { name: true } },
      },
      orderBy: [{ household: { name: 'asc' } }, { displayName: 'asc' }],
    }),
    prisma.run.findMany({ where: pendingWhere(), select: { accountId: true, startedAt: true } }),
    prisma.run.findMany({
      where: { account: REAL_ACCOUNTS },
      orderBy: { startedAt: 'desc' },
      take: RECENT_RUNS,
      select: {
        id: true,
        status: true,
        scraperVersion: true,
        startedAt: true,
        finishedAt: true,
        error: true,
        account: { select: { displayName: true } },
      },
    }),
  ]);

  const pendingByAccount = new Map();
  for (const run of pending) {
    const entry = pendingByAccount.get(run.accountId) || { count: 0, since: run.startedAt };
    entry.count += 1;
    if (run.startedAt < entry.since) entry.since = run.startedAt;
    pendingByAccount.set(run.accountId, entry);
  }

  return {
    db: describeDb(),
    accounts: accounts.map((account) => ({
      ...account,
      job: jobs.get(account.id)?.state ?? null,
      lastOutcome: outcomes.get(account.id) ?? null,
      requested: pendingByAccount.get(account.id) ?? null,
    })),
    runs,
  };
}

// ---- HTTP -----------------------------------------------------------------------

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Guards against other websites (or DNS rebinding) driving this localhost server
// from the browser: the Host must be us, and a POST's Origin must be us too.
function isSelfRequest(req) {
  const allowedHosts = [`${HOST}:${PORT}`, `localhost:${PORT}`];
  if (!allowedHosts.includes(req.headers.host)) return false;
  if (req.method === 'POST' && req.headers.origin) {
    return allowedHosts.some((host) => req.headers.origin === `http://${host}`);
  }
  return true;
}

const ACCOUNT_RUN = /^\/api\/accounts\/([^/]+)\/run$/;

async function route(req, res) {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
  }
  if (req.method === 'GET' && pathname === '/api/state') {
    return send(res, 200, await getState());
  }

  if (req.method === 'POST') {
    const match = pathname.match(ACCOUNT_RUN);
    if (match) {
      const accountId = match[1];
      if (!UUID.test(accountId)) return send(res, 400, { error: 'invalid account id' });
      const account = await prisma.account.findFirst({ where: { id: accountId, ...REAL_ACCOUNTS }, select: { id: true } });
      if (!account) return send(res, 404, { error: 'account not found' });

      const result = await requestRun(accountId);
      return send(res, result === 'queued' ? 202 : 409, { result });
    }
    if (pathname === '/api/run-requested') {
      const pending = await prisma.run.findMany({ where: pendingWhere(), select: { accountId: true }, distinct: ['accountId'] });
      return send(res, 202, await requestMany(pending.map((run) => run.accountId)));
    }
    if (pathname === '/api/run-all') {
      const accounts = await prisma.account.findMany({ where: REAL_ACCOUNTS, select: { id: true } });
      return send(res, 202, await requestMany(accounts.map((account) => account.id)));
    }
  }

  send(res, 404, { error: 'not found' });
}

checkEnv();

const server = http.createServer((req, res) => {
  if (!isSelfRequest(req)) return send(res, 403, { error: 'forbidden' });
  route(req, res).catch((error) => {
    console.error('[admin] request failed:', error);
    send(res, 500, { error: 'internal error — see the server log' });
  });
});

server.listen(PORT, HOST, () => {
  const db = describeDb();
  console.log(`[admin] http://${HOST}:${PORT} — database ${db.host}/${db.name} (${db.local ? 'local' : 'REMOTE'})`);
});

process.on('SIGINT', () => {
  server.close();
  prisma.$disconnect().finally(() => process.exit(0));
});
