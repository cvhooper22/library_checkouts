const jwt = require('jsonwebtoken');

// Verifies the bearer token and attaches { userId, demo } to req.auth. `demo`
// comes straight from the token's own `demo` claim set at issuance (see
// routes/auth.js) — nothing here treats any user or household as demo based on
// a DB lookup, so this stays a pure, cheap check on every request.
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.auth = { userId: payload.sub, demo: payload.demo === true };
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { authenticate };
