require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { authenticate } = require('./middleware/authenticate');
const { demoReadOnly } = require('./middleware/demoReadOnly');
const authRoutes = require('./routes/auth');
const householdsRoutes = require('./routes/households');
const accountsRoutes = require('./routes/accounts');

const app = express();
app.use(cors());
app.use(express.json());

// Unauthenticated — this is how a token is obtained in the first place.
app.use('/auth', authRoutes);

// Everything below requires a valid bearer token. demoReadOnly is the single
// global chokepoint enforcing "demo tokens are read-only" — see
// adr/0002-demo-mode.md decision 6.
app.use(authenticate);
app.use(demoReadOnly);

app.use('/households', householdsRoutes);
app.use('/accounts', accountsRoutes);

app.use((error, req, res, next) => {
  console.error('[api]', error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`[api] listening on :${PORT}`));
