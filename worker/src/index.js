const { Worker } = require('bullmq');
const prisma = require('@library-tracker/db');
const { QUEUE_NAME, createConnection } = require('./queue');
const { getScraper } = require('./scrapers');
const { validateScrapeResult } = require('./scrapers/validate');
const { decryptCredentials } = require('./crypto');
const { captureDebugArtifacts } = require('./debugArtifacts');

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY || 1);
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

// One BullMQ job = one account scrape. Steps follow architecture.md §5.
async function processJob(job) {
  const { accountId } = job.data;

  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  const scraper = getScraper(account.scraperType);

  const run = await prisma.run.create({
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

    throw error; // rethrow so BullMQ's retry policy applies
  }
}

const worker = new Worker(QUEUE_NAME, processJob, {
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
