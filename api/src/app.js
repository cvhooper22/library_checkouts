const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const householdRoutes = require('./routes/households');
const calendarRoutes = require('./routes/calendar');
const libraryRoutes = require('./routes/libraries');
const accountRoutes = require('./routes/accounts');
const meRoutes = require('./routes/me');
const featureRoutes = require('./routes/features');
const { authenticate, demoReadOnly } = require('./auth/middleware');
const { errorHandler } = require('./lib/errors');

function createApp() {
  const app = express();

  // Behind a reverse proxy (Render), req.ip is the proxy unless Express is told
  // how many hops to trust — which would make every IP-keyed rate limit
  // (/auth/demo, /auth/register) one shared bucket for all clients. Left unset
  // for local dev, where trusting X-Forwarded-For would let a client spoof its IP.
  // A hop count ("1") or anything Express's `trust proxy` setting accepts.
  if (process.env.TRUST_PROXY) {
    const value = process.env.TRUST_PROXY;
    app.set('trust proxy', /^\d+$/.test(value) ? Number(value) : value);
  }

  app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
  app.use(express.json());

  app.get('/health', (req, res) => res.json({ ok: true }));

  // Unauthenticated — this is how a token is obtained in the first place.
  app.use('/auth', authRoutes);

  // Everything below requires a valid bearer token, and demo tokens are
  // read-only (adr/0002-demo-mode.md decision 6). Routes don't re-apply
  // authenticate themselves.
  app.use(authenticate, demoReadOnly);

  app.use('/me', meRoutes);
  app.use('/features', featureRoutes);
  app.use('/libraries', libraryRoutes);
  app.use('/households/:id/calendar', calendarRoutes);
  app.use('/households', householdRoutes);
  app.use('/accounts', accountRoutes);

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
