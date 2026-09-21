const express = require('express');
const prisma = require('@library-tracker/db');
const { requireAccountAccess } = require('../auth/middleware');
const { enqueueRefresh } = require('../queue');
const { requireFeature } = require('../features');
const { HttpError } = require('../lib/errors');

const router = express.Router();

// Soft delete: the row and its history stay, but every reader filters on `deletedAt`
// (see requireAccountAccess, the household routes and worker/src/enqueueDaily.js).
// Repeat calls 404 via requireAccountAccess, so `deletedAt` is only ever set once.
router.delete('/:id', requireAccountAccess, async (req, res) => {
  await prisma.account.update({
    where: { id: req.account.id },
    data: { deletedAt: new Date() },
  });
  res.status(204).end();
});

router.get('/:id/runs', requireAccountAccess, async (req, res) => {
  const runs = await prisma.run.findMany({
    where: { accountId: req.params.id },
    orderBy: { startedAt: 'desc' },
  });
  res.json({ runs });
});

// Poll endpoint for frontend "refreshing…" UI (architecture.md §6).
router.get('/:id/status', requireAccountAccess, async (req, res) => {
  const latestRun = await prisma.run.findFirst({
    where: { accountId: req.params.id },
    orderBy: { startedAt: 'desc' },
  });
  res.json({
    accountId: req.account.id,
    lastRunAt: req.account.lastRunAt,
    lastStatus: req.account.lastStatus,
    latestRun,
  });
});

// Enqueues an on-demand scrape and creates its `runs` row up front so the
// response can carry a real run_id immediately, per architecture.md §6. The
// worker (worker/src/runScrape.js) fills in scraperVersion once it picks the job up.
// Behind the `refresh` flag, checked first so a disabled call never creates a run row.
router.post('/:id/refresh', requireFeature('refresh'), requireAccountAccess, async (req, res) => {
  const run = await prisma.run.create({
    data: { accountId: req.account.id, status: 'running', scraperVersion: 'pending' },
  });

  try {
    await enqueueRefresh({ accountId: req.account.id, runId: run.id });
  } catch (error) {
    // Nothing will ever pick this run up; settle it now rather than leave it "running".
    console.error(`[api] could not start refresh for run ${run.id}:`, error.message);
    await prisma.run.update({
      where: { id: run.id },
      data: { status: 'failed', finishedAt: new Date(), error: 'Could not start the scrape' },
    });
    throw new HttpError(502, 'Could not start the refresh');
  }

  res.status(202).json({ runId: run.id, status: run.status });
});

module.exports = router;
