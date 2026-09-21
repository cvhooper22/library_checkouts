const prisma = require('@library-tracker/db');
const { getScraper } = require('./scrapers');
const { validateScrapeResult } = require('./scrapers/validate');
const { decryptCredentials } = require('./crypto');
const { captureDebugArtifacts } = require('./debugArtifacts');

const SCRAPER_VERSION = process.env.SCRAPER_VERSION || 'dev';

// Upserts checkouts on (account_id, external_id) and marks anything no longer
// present as returned. This is the "returned" detection mechanism from
// architecture.md §4 — no separate event system needed.
async function applyScrapeResult({ account, run, checkouts }) {
  const seenExternalIds = [];

  for (const item of checkouts) {
    seenExternalIds.push(item.externalId);

    await prisma.checkout.upsert({
      where: {
        accountId_externalId: {
          accountId: account.id,
          externalId: item.externalId,
        },
      },
      create: {
        accountId: account.id,
        runId: run.id,
        externalId: item.externalId,
        title: item.title,
        dueDate: new Date(item.dueDate),
        overdue: item.overdue,
        imgSrc: item.imgSrc ?? null,
      },
      update: {
        runId: run.id,
        title: item.title,
        dueDate: new Date(item.dueDate),
        overdue: item.overdue,
        imgSrc: item.imgSrc ?? null,
        lastSeenAt: new Date(),
        returnedAt: null,
      },
    });
  }

  await prisma.checkout.updateMany({
    where: {
      accountId: account.id,
      returnedAt: null,
      externalId: { notIn: seenExternalIds },
    },
    data: { returnedAt: new Date() },
  });
}

// One account scrape, independent of what triggered it: the BullMQ worker
// (index.js) calls this per job, and the local admin page (admin/server.js) calls
// it directly. Steps follow architecture.md §5.
async function runScrape({ accountId, runId }) {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  // The card was removed after this scrape was requested; don't log in to a library for it.
  if (account.deletedAt) {
    console.log(`[worker] skipping account ${accountId}: it was deleted`);
    return { skipped: true };
  }
  const scraper = getScraper(account.scraperType);

  // The on-demand /accounts/:id/refresh endpoint (api/src/routes/accounts.js)
  // creates the `runs` row itself so it can hand the caller a real run_id right
  // away, then passes runId through. The daily cron path (enqueueDaily.js) only
  // ever sends { accountId }, so it still gets a run row created here.
  const run = runId
    ? await prisma.run.update({
        where: { id: runId },
        data: { status: 'running', scraperVersion: SCRAPER_VERSION },
      })
    : await prisma.run.create({
        data: { accountId: account.id, status: 'running', scraperVersion: SCRAPER_VERSION },
      });

  try {
    const credentials = decryptCredentials(account.credentialsEncrypted);
    const result = await scraper.scrape({ credentials, config: account.scraperConfig });
    validateScrapeResult(result);

    // A non-empty `errors` doesn't always mean zero checkouts came back, but
    // it does mean the scrape wasn't trustworthy — never let a partial/blocked
    // run mark real checkouts as returned. Fail loudly (architecture.md §7)
    // instead of writing it as a successful, empty run.
    if (result.errors.length > 0) {
      throw new Error(`scraper reported errors: ${result.errors.join('; ')}`);
    }

    await applyScrapeResult({ account, run, checkouts: result.checkouts });

    await prisma.run.update({
      where: { id: run.id },
      data: { status: 'success', finishedAt: new Date(), rawOutput: result },
    });
    await prisma.account.update({
      where: { id: account.id },
      data: { lastRunAt: new Date(), lastStatus: 'success' },
    });
  } catch (error) {
    await captureDebugArtifacts({ runId: run.id, error });

    await prisma.run.update({
      where: { id: run.id },
      data: { status: 'failed', finishedAt: new Date(), error: error.message },
    });
    await prisma.account.update({
      where: { id: account.id },
      data: { lastRunAt: new Date(), lastStatus: 'failed' },
    });

    throw error; // rethrow so BullMQ's retry policy applies (the admin page just reports it)
  }

  return { runId: run.id };
}

module.exports = { runScrape };
