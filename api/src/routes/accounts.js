const express = require('express');
const prisma = require('@library-tracker/db');
const { isHouseholdMember } = require('../authz');
const { getQueue } = require('../queue');

const router = express.Router();

async function loadAuthorizedAccount(req, res) {
  const account = await prisma.account.findUnique({ where: { id: req.params.id } });
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return null;
  }
  if (!(await isHouseholdMember(account.householdId, req.auth.userId))) {
    res.status(403).json({ error: 'Not a member of this household' });
    return null;
  }
  return account;
}

// Run history for one account — debugging/status, per architecture.md §6.
router.get('/:id/runs', async (req, res) => {
  const account = await loadAuthorizedAccount(req, res);
  if (!account) return;

  const runs = await prisma.run.findMany({
    where: { accountId: account.id },
    orderBy: { startedAt: 'desc' },
  });
  res.json({ runs });
});

// Poll endpoint for the frontend's "refreshing..." UI.
router.get('/:id/status', async (req, res) => {
  const account = await loadAuthorizedAccount(req, res);
  if (!account) return;

  res.json({ lastRunAt: account.lastRunAt, lastStatus: account.lastStatus });
});

// Enqueues an on-demand scrape job. This is the endpoint demoReadOnly exists to
// block — a demo-scoped token never reaches the queue (adr/0002-demo-mode.md).
//
// Note: architecture.md §6 describes this as returning a `run_id`, but the
// `runs` row is only created by the worker once it dequeues the job (see
// worker/src/index.js processJob), not at enqueue time — so there's no run id
// yet to hand back. Returning the BullMQ job id here instead; the frontend
// should poll /accounts/:id/status rather than treat this as a run id.
router.post('/:id/refresh', async (req, res) => {
  const account = await loadAuthorizedAccount(req, res);
  if (!account) return;

  const job = await getQueue().add('scrape', { accountId: account.id });
  res.status(202).json({ jobId: job.id });
});

module.exports = router;
