// Single enforcement point for "demo mode is read-only" — see
// adr/0002-demo-mode.md decision 6. Applied globally, after authenticate(),
// ahead of every route. A new mutating route is safe by default just by
// sitting behind this; nothing per-handler needs to remember an isDemo check.
function demoReadOnly(req, res, next) {
  if (req.auth?.demo && req.method !== 'GET') {
    return res.status(403).json({ error: 'The demo account is read-only.' });
  }
  next();
}

module.exports = { demoReadOnly };
