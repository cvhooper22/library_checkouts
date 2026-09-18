const prisma = require('@library-tracker/db');
const { verifyToken } = require('./tokens');
const { HttpError } = require('../lib/errors');

// Token-based auth per architecture.md §6 — not cookie/session, so a future
// Electron/mobile client can hit these same endpoints. Express 5 forwards thrown
// errors from sync and async handlers alike to the error middleware, so routes
// below don't need their own try/catch.
function authenticate(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new HttpError(401, 'Missing or malformed Authorization header');
  }
  try {
    req.userId = verifyToken(token);
  } catch {
    throw new HttpError(401, 'Invalid or expired token');
  }
  next();
}

// Confirms req.userId belongs to the household in req.params.id.
async function requireHouseholdMember(req, res, next) {
  const membership = await prisma.householdMember.findUnique({
    where: { householdId_userId: { householdId: req.params.id, userId: req.userId } },
  });
  if (!membership) {
    throw new HttpError(403, 'Not a member of this household');
  }
  next();
}

// Loads the account in req.params.id, confirms req.userId belongs to its
// household, and stashes it on req.account so routes don't re-fetch it.
async function requireAccountAccess(req, res, next) {
  const account = await prisma.account.findUnique({ where: { id: req.params.id } });
  if (!account) {
    throw new HttpError(404, 'Account not found');
  }
  const membership = await prisma.householdMember.findUnique({
    where: { householdId_userId: { householdId: account.householdId, userId: req.userId } },
  });
  if (!membership) {
    throw new HttpError(403, "Not a member of this account's household");
  }
  req.account = account;
  next();
}

module.exports = { authenticate, requireHouseholdMember, requireAccountAccess };
