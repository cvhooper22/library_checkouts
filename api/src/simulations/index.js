const crypto = require('crypto');
const prisma = require('@library-tracker/db');
const { requireHouseholdMember, requireAccountAccess } = require('../auth/middleware');
const { requireFeature } = require('../features');
const { HttpError } = require('../lib/errors');
const { parseHouseholdName, parseNewAccount, findAvailableLibrary } = require('../lib/inputs');
const { findStatus, present, parseSettingsChanges, requireConnectedUser } = require('../lib/calendarStatus');

// Stand-ins for the demo role's `simulate` capabilities (adr/0004-capability-based-authorization.md).
// Each is a chain of the real route's own guards followed by a handler that answers the way
// the real one would without any side effect: no writes, no queue, no Google, no credentials
// stored. They share validation with the real handlers (lib/inputs.js, lib/calendarStatus.js),
// so a bad request fails the same way here. The guards they reuse only read.
// A new simulation needs a test in test/simulations.test.js saying exactly that.

// The account's latest seeded run is already settled, so the client's poll for it finishes at
// once. Nothing is created and nothing is enqueued.
const refresh = [
  requireFeature('refresh'),
  requireAccountAccess,
  async (req, res) => {
    const run = await prisma.run.findFirst({
      where: { accountId: req.account.id },
      orderBy: { startedAt: 'desc' },
      select: { id: true, status: true },
    });
    if (!run) {
      throw new HttpError(409, 'The demo has nothing to refresh yet');
    }
    res.status(202).json({ runId: run.id, status: run.status });
  },
];

const deleteAccount = [requireAccountAccess, (req, res) => res.status(204).end()];

// The same shape as the real response (the account row minus its credentials), with a made-up
// id. The submitted login is validated and then dropped, never encrypted or stored.
const createAccount = [
  requireHouseholdMember,
  async (req, res) => {
    const { displayName, scheduleCron } = parseNewAccount(req.body);
    const library = await findAvailableLibrary(req.body.libraryId);
    res.status(201).json({
      account: {
        id: crypto.randomUUID(),
        householdId: req.params.id,
        displayName,
        libraryId: library.id,
        scraperType: library.scraperTypeDefault,
        scraperConfig: { baseUrl: library.baseUrl },
        scheduleCron: scheduleCron ?? '0 6 * * *',
        lastRunAt: null,
        lastStatus: null,
        deletedAt: null,
      },
    });
  },
];

const renameHousehold = [
  requireHouseholdMember,
  (req, res) => {
    const name = parseHouseholdName(req.body);
    res.json({ household: { id: req.params.id, name } });
  },
];

// Answers with the stored settings overlaid with the validated change, so the response is what
// the real PATCH would return. Nothing is saved and no sync is queued.
const updateCalendar = [
  requireFeature('calendar'),
  requireHouseholdMember,
  requireConnectedUser,
  async (req, res) => {
    const changes = parseSettingsChanges(req.body);
    const stored = await findStatus(req.params.id);
    res.json({ calendar: present({ ...stored, ...changes }, req.userId) });
  },
];

const disconnectCalendar = [
  requireFeature('calendar'),
  requireHouseholdMember,
  requireConnectedUser,
  (req, res) => res.status(204).end(),
];

module.exports = {
  'account.refresh': refresh,
  'account.delete': deleteAccount,
  'account.create': createAccount,
  'household.rename': renameHousehold,
  'calendar.update': updateCalendar,
  'calendar.disconnect': disconnectCalendar,
};
