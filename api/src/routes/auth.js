const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { OAuth2Client } = require('google-auth-library');
const prisma = require('@library-tracker/db');

const router = express.Router();
const googleClient = new OAuth2Client();

function signToken(payload, expiresIn) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
}

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  const valid = user && (await bcrypt.compare(password, user.passwordHash));
  if (!valid) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  res.json({ token: signToken({ sub: user.id }, '7d') });
});

router.post('/google', async (req, res) => {
  const { idToken } = req.body || {};
  if (!idToken) {
    return res.status(400).json({ error: 'idToken is required' });
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid Google token' });
  }

  // Google itself attests this, so it's safe to tell the caller directly —
  // they already hold a signed token proving they control this Google
  // session, unlike an anonymous /login attempt where vagueness matters.
  if (!payload.email_verified) {
    return res.status(401).json({
      error: "Your Google account's email isn't verified. Verify it with Google, then try again.",
    });
  }

  // `sub` is Google's stable per-account identifier; email is only used to
  // link a Google sign-in to an existing password account, since Google has
  // already verified the caller owns that address.
  let user = await prisma.user.findUnique({ where: { googleId: payload.sub } });
  if (!user) {
    user = await prisma.user.upsert({
      where: { email: payload.email },
      update: { googleId: payload.sub },
      create: { email: payload.email, googleId: payload.sub },
    });
  }

  res.json({ token: signToken({ sub: user.id }, '7d') });
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
// middleware/demoReadOnly.js keys off of for every subsequent request.
router.post('/demo', demoLoginLimiter, async (req, res) => {
  if (process.env.DEMO_MODE_ENABLED === 'false') {
    return res.status(404).json({ error: 'Demo mode is not enabled' });
  }

  const household = await prisma.household.findFirst({ where: { isDemo: true } });
  if (!household) {
    return res.status(503).json({ error: 'Demo household has not been seeded yet' });
  }

  const token = signToken({ sub: household.ownerUserId, demo: true }, '1h');
  res.json({ token, householdId: household.id });
});

module.exports = router;
