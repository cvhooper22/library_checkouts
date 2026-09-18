const express = require('express');
const prisma = require('@library-tracker/db');
const { isHouseholdMember } = require('../authz');
const { encryptCredentials } = require('../crypto');

const router = express.Router();

// Current (non-returned) checkouts across every account in a household — the
// query pattern from architecture.md §4.
router.get('/:id/checkouts', async (req, res) => {
  const householdId = req.params.id;
  if (!(await isHouseholdMember(householdId, req.auth.userId))) {
    return res.status(403).json({ error: 'Not a member of this household' });
  }

  const checkouts = await prisma.checkout.findMany({
    where: { account: { householdId }, returnedAt: null },
    orderBy: { dueDate: 'asc' },
  });
  res.json({ checkouts });
});

// Add a new library account to a household. Credentials are encrypted before
// storage and never echoed back — see architecture.md §6.
router.post('/:id/accounts', async (req, res) => {
  const householdId = req.params.id;
  if (!(await isHouseholdMember(householdId, req.auth.userId))) {
    return res.status(403).json({ error: 'Not a member of this household' });
  }

  const { displayName, libraryId, scraperType, scraperConfig, credentials } = req.body || {};
  if (!displayName || !libraryId || !scraperType || !credentials) {
    return res
      .status(400)
      .json({ error: 'displayName, libraryId, scraperType, and credentials are required' });
  }

  const account = await prisma.account.create({
    data: {
      householdId,
      displayName,
      libraryId,
      scraperType,
      scraperConfig: scraperConfig ?? {},
      credentialsEncrypted: encryptCredentials(credentials),
    },
  });

  res.status(201).json({
    id: account.id,
    displayName: account.displayName,
    libraryId: account.libraryId,
    scraperType: account.scraperType,
  });
});

module.exports = router;
