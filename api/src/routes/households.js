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
    where: { returnedAt: null, account: { householdId: req.params.id, deletedAt: null } },
    orderBy: { dueDate: 'asc' },
    include: { account: { select: { id: true, displayName: true } } },
  });
  res.json({ checkouts });
});

// The library cards on file for the household. Explicit `select` so credentials
// (and scraper internals) can never leak into the response.
router.get('/:id/accounts', requireHouseholdMember, async (req, res) => {
  const accounts = await prisma.account.findMany({
    where: { householdId: req.params.id, deletedAt: null },
    orderBy: { displayName: 'asc' },
    select: {
      id: true,
      displayName: true,
      lastRunAt: true,
      lastStatus: true,
      library: { select: { id: true, slug: true, name: true } },
    },
  });
  res.json({ accounts });
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Adds a library account to the household. Credentials are encrypted here and
// never stored or returned in plaintext (architecture.md §6). The scraper and its
// per-library config come from the chosen `libraries` row, not the client — the
// client only picks a library (GET /libraries) and supplies the login.
router.post('/:id/accounts', requireHouseholdMember, async (req, res) => {
  const { displayName, libraryId, credentials, scheduleCron } = req.body || {};
  if (!displayName || !libraryId || !credentials?.username || !credentials?.pin) {
    throw new HttpError(400, 'displayName, libraryId, and credentials (username, pin) are required');
  }
  // Checked up front: Postgres rejects a malformed uuid with an error that would surface as a 500.
  if (!UUID.test(libraryId)) {
    throw new HttpError(400, 'libraryId must be a library id from GET /libraries');
  }

  const library = await prisma.library.findUnique({ where: { id: libraryId } });
  if (!library) {
    throw new HttpError(404, 'Library not found');
  }
  if (!library.isActive) {
    throw new HttpError(400, 'That library is not available');
  }

  const account = await prisma.account.create({
    data: {
      householdId: req.params.id,
      displayName,
      libraryId: library.id,
      scraperType: library.scraperTypeDefault,
      scraperConfig: { baseUrl: library.baseUrl },
      credentialsEncrypted: encryptCredentials({ username: credentials.username, pin: credentials.pin }),
      ...(scheduleCron ? { scheduleCron } : {}),
    },
  });

  const { credentialsEncrypted, ...safeAccount } = account;
  res.status(201).json({ account: safeAccount });
});

module.exports = router;
