const jwt = require('jsonwebtoken');

const DEFAULT_EXPIRES_IN = '7d';

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set');
  }
  return secret;
}

function signToken(userId) {
  return jwt.sign({ sub: userId }, getSecret(), {
    expiresIn: process.env.JWT_EXPIRES_IN || DEFAULT_EXPIRES_IN,
  });
}

function verifyToken(token) {
  return jwt.verify(token, getSecret()).sub;
}

module.exports = { signToken, verifyToken };
