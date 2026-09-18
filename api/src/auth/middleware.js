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
    ({ userId: req.userId, demo: req.demo } = verifyToken(token));
  } catch {
    throw new HttpError(401, 'Invalid or expired token');
  }
  next();
}

// Single enforcement point for "demo mode is read-only" — see
// adr/0002-demo-mode.md decision 6. Mounted once in app.js, right after
// authenticate and ahead of every protected route, so a new mutating route is
// safe by default; nothing per-handler needs to remember an isDemo check.
function demoReadOnly(req, res, next) {
  if (req.demo && req.method !== 'GET') {
    throw new HttpError(403, 'The demo account is read-only.');
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
// household, and stashes it on req.account so routes don't re-fetch it. A
// soft-deleted account is treated as missing.
async function requireAccountAccess(req, res, next) {
  const account = await prisma.account.findUnique({ where: { id: req.params.id } });
  if (!account || account.deletedAt) {
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

module.exports = { authenticate, demoReadOnly, requireHouseholdMember, requireAccountAccess };
