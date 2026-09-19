const express = require('express');
const { allFlags } = require('../features');

const router = express.Router();

// Which optional features are on, so the frontend can hide what the API would refuse.
// Fetched on every dashboard load rather than stored with the session at sign-in, so
// flipping a flag takes effect without everyone signing out and back in.
router.get('/', (req, res) => {
  res.json({ features: allFlags() });
});

module.exports = router;
