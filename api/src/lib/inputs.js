const prisma = require('@library-tracker/db');
const { HttpError } = require('./errors');

// Request parsing shared by a route and its demo simulation, so the two can't disagree about
// what a valid request is (adr/0004-capability-based-authorization.md).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseHouseholdName(body) {
  const name = body?.name?.trim();
  if (!name) {
    throw new HttpError(400, 'name is required');
  }
  return name;
}

// The body of POST /households/:id/accounts.
function parseNewAccount(body) {
  const { displayName, libraryId, credentials, scheduleCron } = body || {};
  if (!displayName || !libraryId || !credentials?.username || !credentials?.pin) {
    throw new HttpError(400, 'displayName, libraryId, and credentials (username, pin) are required');
  }
  // Checked up front: Postgres rejects a malformed uuid with an error that would surface as a 500.
  if (!UUID.test(libraryId)) {
    throw new HttpError(400, 'libraryId must be a library id from GET /libraries');
  }
  return { displayName, libraryId, credentials, scheduleCron };
}

async function findAvailableLibrary(libraryId) {
  const library = await prisma.library.findUnique({ where: { id: libraryId } });
  if (!library) {
    throw new HttpError(404, 'Library not found');
  }
  if (!library.isActive) {
    throw new HttpError(400, 'That library is not available');
  }
  return library;
}

module.exports = { UUID, parseHouseholdName, parseNewAccount, findAvailableLibrary };
