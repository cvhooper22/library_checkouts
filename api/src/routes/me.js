const express = require('express');
const prisma = require('@library-tracker/db');
const { HttpError } = require('../lib/errors');

const router = express.Router();

// Who the bearer token belongs to, plus the households they can act in. /login
// and /google only return a token, so this is how a client builds its session
// afterward. Works for demo tokens too — they resolve to the demo owner.
router.get('/', async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: {
      id: true,
      email: true,
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
    user: { id: user.id, email: user.email },
    households: user.householdMembers.map(({ role, household }) => ({
      id: household.id,
      name: household.name,
      role,
    })),
  });
});

module.exports = router;
