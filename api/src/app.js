const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const householdRoutes = require('./routes/households');
const accountRoutes = require('./routes/accounts');
const { errorHandler } = require('./lib/errors');

function createApp() {
  const app = express();

  app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
  app.use(express.json());

  app.get('/health', (req, res) => res.json({ ok: true }));

  app.use('/auth', authRoutes);
  app.use('/households', householdRoutes);
  app.use('/accounts', accountRoutes);

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
