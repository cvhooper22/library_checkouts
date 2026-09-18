const express = require('express');
const prisma = require('@library-tracker/db');
const { requireHouseholdMember } = require('../auth/middleware');
const { encryptCredentials } = require('../crypto');
const { HttpError } = require('../lib/errors');

const router = express.Router();

// Current (non-returned) checkouts across every account in the household —
// the query pattern from architecture.md §4.
router.get('/:id/checkouts', requireHouseholdMember, async (req, res) => {
  const checkouts = await prisma.checkout.findMany({
    where: { returnedAt: null, account: { householdId: req.params.id } },
    orderBy: { dueDate: 'asc' },
    include: { account: { select: { id: true, displayName: true } } },
  });
  res.json({ checkouts });
});

// Adds a library account to the household. Credentials are encrypted here and
// never stored or returned in plaintext (architecture.md §6).
router.post('/:id/accounts', requireHouseholdMember, async (req, res) => {
  const { displayName, libraryId, scraperType, scraperConfig, credentials, scheduleCron } = req.body || {};
  if (!displayName || !libraryId || !scraperType || !credentials) {
    throw new HttpError(400, 'displayName, libraryId, scraperType, and credentials are required');
  }

  const account = await prisma.account.create({
    data: {
      householdId: req.params.id,
      displayName,
      libraryId,
      scraperType,
      scraperConfig: scraperConfig || {},
      credentialsEncrypted: encryptCredentials(credentials),
      ...(scheduleCron ? { scheduleCron } : {}),
    },
  });

  const { credentialsEncrypted, ...safeAccount } = account;
  res.status(201).json({ account: safeAccount });
});

module.exports = router;
