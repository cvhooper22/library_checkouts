const express = require('express');
const prisma = require('@library-tracker/db');
const { verifyGoogleIdToken } = require('../auth/google');
const { HttpError } = require('../lib/errors');

const router = express.Router();

// Which ways the user can sign in. The password hash and Google id never leave the API.
function signInMethods({ passwordHash, googleId }) {
  return { hasPassword: Boolean(passwordHash), googleLinked: Boolean(googleId) };
}

// Who the bearer token belongs to, plus the households they can act in. /login
// and /google only return a token, so this is how a client builds its session
// afterward. Works for demo tokens too — they resolve to the demo owner.
router.get('/', async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      googleId: true,
      householdMembers: {
        orderBy: { household: { createdAt: 'asc' } },
        select: { role: true, household: { select: { id: true, name: true } } },
      },
    },
  });
  // A validly signed token whose user has since been deleted.
  if (!user) {
    throw new HttpError(401, 'Invalid or expired token');
  }

  res.json({
    user: { id: user.id, email: user.email, ...signInMethods(user) },
    households: user.householdMembers.map(({ role, household }) => ({
      id: household.id,
      name: household.name,
      role,
    })),
  });
});

async function currentUser(req) {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) {
    throw new HttpError(401, 'Invalid or expired token');
  }
  return user;
}

// Links a Google account to the signed-in user so they can sign in with it too.
// Unlike POST /auth/google's automatic link, the Google address doesn't have to
// match the account's: holding this user's token is the proof of ownership.
router.post('/google', async (req, res) => {
  const payload = await verifyGoogleIdToken(req.body?.idToken);
  const user = await currentUser(req);

  if (user.googleId === payload.sub) {
    return res.json(signInMethods(user));
  }
  if (user.googleId) {
    throw new HttpError(409, 'A different Google account is already linked. Unlink it first.');
  }

  const owner = await prisma.user.findUnique({ where: { googleId: payload.sub } });
  if (owner) {
    throw new HttpError(409, 'That Google account already signs in to a different account.');
  }

  let updated;
  try {
    updated = await prisma.user.update({ where: { id: user.id }, data: { googleId: payload.sub } });
  } catch (err) {
    // Another request linked or signed up with this Google account since the check above.
    if (err.code === 'P2002') {
      throw new HttpError(409, 'That Google account already signs in to a different account.');
    }
    throw err;
  }
  res.json(signInMethods(updated));
});

router.delete('/google', async (req, res) => {
  const user = await currentUser(req);
  // Without a password, Google is the only way back in.
  if (!user.passwordHash) {
    throw new HttpError(409, "Google is this account's only way to sign in, so it can't be unlinked.");
  }

  const updated = user.googleId
    ? await prisma.user.update({ where: { id: user.id }, data: { googleId: null } })
    : user;
  res.json(signInMethods(updated));
});

module.exports = router;
