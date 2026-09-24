// Local-only admin page for running scrapes by hand (no Redis or BullMQ), adding libraries,
// and syncing Google Calendar reminders.
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
const { syncAllCalendars } = require('../src/calendarSync');
const { REGISTRY } = require('../src/scrapers');

const HOST = '127.0.0.1';
const PORT = Number(process.env.ADMIN_PORT || 4100);
const RECENT_RUNS = 25;
// A `running` run newer than this that isn't a pending request means a scrape is
// probably in flight somewhere else (e.g. a real worker); don't start a second one.
const BUSY_WINDOW_MS = 10 * 60 * 1000;

// Scrapers a real library can use: the demo scraper only feeds the demo household, and the
// test-* fixtures only exist outside production (see src/scrapers/index.js).
const LIBRARY_SCRAPER_TYPES = Object.keys(REGISTRY).filter((id) => id !== 'demo' && !id.startsWith('test-')).sort();
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_BODY_BYTES = 16 * 1024;

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

// ---- Calendar reminders -----------------------------------------------------------
// The same sync the daily calendar-sync.yml run does: every linked household, then the
// queued disconnects. A scrape from this page already re-syncs its own household; this is
// for syncing without scraping, and the only way here to carry out a disconnect.

const googleConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

let calendarSyncing = false;
let lastCalendarSync = null; // { links, failed, at } | { error, at }

async function syncCalendars() {
  if (!googleConfigured()) {
    throw new BadRequest('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set (see .env.admin.example)');
  }
  if (calendarSyncing) throw new BadRequest('a calendar sync is already running', 409);
  calendarSyncing = true;
  try {
    lastCalendarSync = { ...(await syncAllCalendars()), at: new Date() };
  } catch (error) {
    lastCalendarSync = { error: error.message, at: new Date() };
    throw error;
  } finally {
    calendarSyncing = false;
  }
  return lastCalendarSync;
}

// ---- Libraries ------------------------------------------------------------------

class BadRequest extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

async function readJson(req) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) {
    throw new BadRequest('expected a JSON body');
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new BadRequest('body too large', 413);
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  } catch {
    // fall through
  }
  throw new BadRequest('body must be a JSON object');
}

const optionalText = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

// Same shape the API's account creation reads (api/src/routes/households.js): the picked
// library's scraperTypeDefault and baseUrl become the account's scraper and config.
function parseLibrary(body) {
  const name = optionalText(body.name);
  if (!name) throw new BadRequest('name is required');

  const slug = optionalText(body.slug);
  if (!slug || !SLUG.test(slug)) throw new BadRequest('slug is required: lowercase letters, numbers and single hyphens');

  if (!LIBRARY_SCRAPER_TYPES.includes(body.scraperType)) {
    throw new BadRequest(`scraperType must be one of: ${LIBRARY_SCRAPER_TYPES.join(', ')}`);
  }

  let baseUrl;
  try {
    baseUrl = new URL(optionalText(body.baseUrl) ?? '');
  } catch {
    throw new BadRequest('baseUrl must be a full URL, e.g. https://butte.bywatersolutions.com');
  }
  if (baseUrl.protocol !== 'https:' && baseUrl.protocol !== 'http:') throw new BadRequest('baseUrl must be http(s)');

  return {
    name,
    slug,
    // Scrapers append paths to it themselves; a trailing slash would double up.
    baseUrl: baseUrl.href.replace(/\/$/, ''),
    scraperTypeDefault: body.scraperType,
    city: optionalText(body.city),
    state: optionalText(body.state),
    postalCode: optionalText(body.postalCode),
  };
}

async function createLibrary(body) {
  const data = parseLibrary(body);
  try {
    return await prisma.library.create({ data, select: { id: true, slug: true, name: true } });
  } catch (error) {
    if (error.code === 'P2002') throw new BadRequest(`a library with the slug "${data.slug}" already exists`, 409);
    throw error;
  }
}

// The demo library (adr/0002-demo-mode.md) is never user-selectable, so it can't be switched on.
async function setLibraryActive(id, isActive) {
  if (typeof isActive !== 'boolean') throw new BadRequest('isActive must be true or false');
  const library = await prisma.library.findUnique({ where: { id }, select: { scraperTypeDefault: true } });
  if (!library) throw new BadRequest('library not found', 404);
  if (isActive && library.scraperTypeDefault === 'demo') throw new BadRequest('the demo library cannot be activated');
  // Accounts already on the library keep working; it just leaves the "add an account" picker.
  await prisma.library.update({ where: { id }, data: { isActive } });
}

// accounts.library_id is ON DELETE RESTRICT, and that counts soft-deleted accounts too, so a
// library that has ever had a card can only be deactivated.
async function deleteLibrary(id) {
  const inUse = new BadRequest('that library has accounts (including removed ones); deactivate it instead', 409);
  if (await prisma.account.count({ where: { libraryId: id } })) throw inUse;
  try {
    await prisma.library.delete({ where: { id } });
  } catch (error) {
    if (error.code === 'P2025') throw new BadRequest('library not found', 404);
    if (error.code === 'P2003') throw inUse; // an account was added between the check and the delete
    throw error;
  }
}

// ---- Reads ----------------------------------------------------------------------

async function getState() {
  const [accounts, pending, runs, libraries, calendarLinks, revocations] = await Promise.all([
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
    prisma.library.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        slug: true,
        name: true,
        baseUrl: true,
        scraperTypeDefault: true,
        isActive: true,
        city: true,
        state: true,
        accounts: { select: { deletedAt: true } },
      },
    }),
    // Explicit selects: the encrypted Google tokens must never leave this process either.
    prisma.calendarLink.findMany({
      where: { household: { isDemo: false } },
      orderBy: { household: { name: 'asc' } },
      select: {
        householdId: true,
        reminderTime: true,
        timeZone: true,
        showTitles: true,
        enabled: true,
        lastSyncedAt: true,
        lastError: true,
        household: { select: { name: true } },
        connectedUser: { select: { email: true } },
      },
    }),
    prisma.calendarRevocation.findMany({
      orderBy: { requestedAt: 'asc' },
      select: { id: true, deleteCalendar: true, requestedAt: true, lastError: true, household: { select: { name: true } } },
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
    libraries: libraries.map(({ accounts, ...library }) => ({
      ...library,
      accountCount: accounts.filter((account) => !account.deletedAt).length,
      canDelete: accounts.length === 0,
    })),
    scraperTypes: LIBRARY_SCRAPER_TYPES,
    calendars: {
      googleConfigured: googleConfigured(),
      syncing: calendarSyncing,
      lastSync: lastCalendarSync,
      links: calendarLinks,
      revocations,
    },
  };
}

// ---- HTTP -----------------------------------------------------------------------

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Guards against other websites (or DNS rebinding) driving this localhost server
// from the browser: the Host must be us, and a POST's or DELETE's Origin must be us too.
function isSelfRequest(req) {
  const allowedHosts = [`${HOST}:${PORT}`, `localhost:${PORT}`];
  if (!allowedHosts.includes(req.headers.host)) return false;
  if (req.method !== 'GET' && req.headers.origin) {
    return allowedHosts.some((host) => req.headers.origin === `http://${host}`);
  }
  return true;
}

const ACCOUNT_RUN = /^\/api\/accounts\/([^/]+)\/run$/;
const LIBRARY = /^\/api\/libraries\/([^/]+)(\/active)?$/;

function libraryId(value) {
  if (!UUID.test(value)) throw new BadRequest('invalid library id');
  return value;
}

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
    if (pathname === '/api/libraries') {
      const library = await createLibrary(await readJson(req));
      return send(res, 201, { library });
    }
    const library = pathname.match(LIBRARY);
    if (library?.[2]) {
      await setLibraryActive(libraryId(library[1]), (await readJson(req)).isActive);
      return send(res, 200, { ok: true });
    }
    if (pathname === '/api/run-requested') {
      const pending = await prisma.run.findMany({ where: pendingWhere(), select: { accountId: true }, distinct: ['accountId'] });
      return send(res, 202, await requestMany(pending.map((run) => run.accountId)));
    }
    if (pathname === '/api/calendars/sync') {
      return send(res, 200, await syncCalendars());
    }
    if (pathname === '/api/run-all') {
      const accounts = await prisma.account.findMany({ where: REAL_ACCOUNTS, select: { id: true } });
      return send(res, 202, await requestMany(accounts.map((account) => account.id)));
    }
  }

  if (req.method === 'DELETE') {
    const library = pathname.match(LIBRARY);
    if (library && !library[2]) {
      await deleteLibrary(libraryId(library[1]));
      return send(res, 200, { ok: true });
    }
  }

  send(res, 404, { error: 'not found' });
}

checkEnv();

const server = http.createServer((req, res) => {
  if (!isSelfRequest(req)) return send(res, 403, { error: 'forbidden' });
  route(req, res).catch((error) => {
    if (error instanceof BadRequest) return send(res, error.status, { error: error.message });
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
