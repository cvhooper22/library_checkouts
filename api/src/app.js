const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const householdRoutes = require('./routes/households');
const accountRoutes = require('./routes/accounts');
const { authenticate, demoReadOnly } = require('./auth/middleware');
const { errorHandler } = require('./lib/errors');

function createApp() {
  const app = express();

  app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
  app.use(express.json());

  app.get('/health', (req, res) => res.json({ ok: true }));

  // Unauthenticated — this is how a token is obtained in the first place.
  app.use('/auth', authRoutes);

  // Everything below requires a valid bearer token, and demo tokens are
  // read-only (adr/0002-demo-mode.md decision 6). Routes don't re-apply
  // authenticate themselves.
  app.use(authenticate, demoReadOnly);

  app.use('/households', householdRoutes);
  app.use('/accounts', accountRoutes);

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
