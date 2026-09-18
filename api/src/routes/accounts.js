const express = require('express');
const prisma = require('@library-tracker/db');
const { requireAccountAccess } = require('../auth/middleware');
const { enqueueRefresh } = require('../queue');

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
// worker (worker/src/index.js) fills in scraperVersion once it picks the job up.
router.post('/:id/refresh', requireAccountAccess, async (req, res) => {
  const run = await prisma.run.create({
    data: { accountId: req.account.id, status: 'running', scraperVersion: 'pending' },
  });

  await enqueueRefresh({ accountId: req.account.id, runId: run.id });

  res.status(202).json({ runId: run.id, status: run.status });
});

module.exports = router;
