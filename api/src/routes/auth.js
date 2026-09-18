const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('@library-tracker/db');
const { signToken } = require('../auth/tokens');
const { HttpError } = require('../lib/errors');

const router = express.Router();

const BCRYPT_ROUNDS = 12;

// Not in architecture.md's endpoint table, but /auth/login has nothing to check
// a password against until some path creates a user — this is that path. Creates
// the user and a household they own (architecture.md's household onboarding flow
// for non-owner contributors is still an open item, see §9).
router.post('/register', async (req, res) => {
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

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new HttpError(401, 'Invalid email or password');
  }

  res.json({ token: signToken(user.id) });
});

module.exports = router;
