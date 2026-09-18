const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { OAuth2Client } = require('google-auth-library');
const prisma = require('@library-tracker/db');
const { signToken } = require('../auth/tokens');
const { HttpError } = require('../lib/errors');

const router = express.Router();
const googleClient = new OAuth2Client();

const BCRYPT_ROUNDS = 12;

// Anonymous account creation, and each attempt costs a bcrypt hash (~250ms of CPU
// at 12 rounds), so it's both an abuse target and a cheap way to burn server time.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

// Not in architecture.md's endpoint table, but /auth/login has nothing to check
// a password against until some path creates a user — this is that path. Creates
// the user and a household they own (architecture.md's household onboarding flow
// for non-owner contributors is still an open item, see §9).
router.post('/register', registerLimiter, async (req, res) => {
  const { email, password, householdName } = req.body || {};
  if (!email || !password || !householdName) {
    throw new HttpError(400, 'email, password, and householdName are required');
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new HttpError(409, 'An account with that email already exists');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await prisma.user.create({ data: { email, passwordHash } });
  const household = await prisma.household.create({
    data: {
      name: householdName,
      ownerUserId: user.id,
      members: { create: { userId: user.id, role: 'owner' } },
    },
  });

  const token = signToken(user.id);
  res.status(201).json({
    token,
    user: { id: user.id, email: user.email },
    household: { id: household.id, name: household.name },
  });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    throw new HttpError(400, 'email and password are required');
  }

  // passwordHash is null for accounts created via Google sign-in, which have no
  // password to check.
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new HttpError(401, 'Invalid email or password');
  }

  res.json({ token: signToken(user.id) });
});

// First-time Google sign-in is also sign-up, so — like /register — the new user
// gets a household they own; without one they'd have nowhere to add accounts.
// There's no form to ask for a name, so derive one from the Google profile.
function createGoogleUser({ sub, email, given_name: givenName }) {
  const name = `${givenName || email.split('@')[0]}'s Household`;
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email, googleId: sub } });
    await tx.household.create({
      data: {
        name,
        ownerUserId: user.id,
        members: { create: { userId: user.id, role: 'owner' } },
      },
    });
    return user;
  });
}

router.post('/google', async (req, res) => {
  const { idToken } = req.body || {};
  if (!idToken) {
    throw new HttpError(400, 'idToken is required');
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    throw new HttpError(401, 'Invalid Google token');
  }

  // Google itself attests this, so it's safe to tell the caller directly —
  // they already hold a signed token proving they control this Google
  // session, unlike an anonymous /login attempt where vagueness matters.
  if (!payload.email_verified) {
    throw new HttpError(
      401,
      "Your Google account's email isn't verified. Verify it with Google, then try again.",
    );
  }

  // `sub` is Google's stable per-account identifier; email is only used to
  // link a Google sign-in to an existing password account, since Google has
  // already verified the caller owns that address.
  let user = await prisma.user.findUnique({ where: { googleId: payload.sub } });
  if (!user) {
    const byEmail = await prisma.user.findUnique({ where: { email: payload.email } });
    user = byEmail
      ? await prisma.user.update({ where: { id: byEmail.id }, data: { googleId: payload.sub } })
      : await createGoogleUser(payload);
  }

  res.json({ token: signToken(user.id) });
});

// Rate-limited independently of /login: this route hands out a valid token to
// anyone, no credentials required, so it's the more attractive target for abuse.
// See adr/0002-demo-mode.md decision 5.
const demoLoginLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

// Public, credential-less entry point for "Try it out" — mints a token for the
// one shared, seeded demo household's owner. DEMO_MODE_ENABLED is a kill switch
// that needs no deploy to flip. The token's `demo: true` claim is what
// demoReadOnly (auth/middleware.js) keys off of for every subsequent request.
router.post('/demo', demoLoginLimiter, async (req, res) => {
  if (process.env.DEMO_MODE_ENABLED === 'false') {
    throw new HttpError(404, 'Demo mode is not enabled');
  }

  const household = await prisma.household.findFirst({ where: { isDemo: true } });
  if (!household) {
    throw new HttpError(503, 'Demo household has not been seeded yet');
  }

  const token = signToken(household.ownerUserId, { demo: true, expiresIn: '1h' });
  res.json({ token, householdId: household.id });
});

module.exports = router;
