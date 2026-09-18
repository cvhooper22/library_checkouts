const jwt = require('jsonwebtoken');

const DEFAULT_EXPIRES_IN = '7d';

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set');
  }
  return secret;
}

// `demo: true` marks a token minted by POST /auth/demo — it's what
// demoReadOnly keys off of (adr/0002-demo-mode.md). Set only at issuance;
// nothing re-derives demo-ness from the DB on later requests.
function signToken(userId, { demo = false, expiresIn } = {}) {
  const claims = demo ? { sub: userId, demo: true } : { sub: userId };
  return jwt.sign(claims, getSecret(), {
    expiresIn: expiresIn || process.env.JWT_EXPIRES_IN || DEFAULT_EXPIRES_IN,
  });
}

function verifyToken(token) {
  const { sub, demo } = jwt.verify(token, getSecret());
  return { userId: sub, demo: demo === true };
}

module.exports = { signToken, verifyToken };
