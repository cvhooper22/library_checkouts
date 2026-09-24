const { HttpError } = require('./lib/errors');

// Feature flags, one env var each. Read on every call rather than cached at startup,
// so the only thing a flip needs is the service restarting — no rebuild.
//
// Opt-in on purpose: a flag is on only when its variable is exactly "true", so a
// missing or mistyped value leaves the feature off. (DEMO_MODE_ENABLED is the
// opposite — only "false" disables it.) To move flags into the database later, keep
// these three exports and change what isEnabled reads: roadmap/feature-flags-db.md.
const FLAGS = {
  refresh: 'REFRESH_ENABLED', // POST /accounts/:id/refresh, and the frontend's Re-stamp button
  calendar: 'CALENDAR_ENABLED', // /households/:id/calendar, and the Set up page's calendar card
};

function isEnabled(flag) {
  return process.env[FLAGS[flag]] === 'true';
}

function allFlags() {
  return Object.fromEntries(Object.keys(FLAGS).map((flag) => [flag, isEnabled(flag)]));
}

// Route guard. 404 rather than 403, like a disabled demo mode: as far as the
// client is concerned the endpoint doesn't exist right now.
function requireFeature(flag) {
  return (req, res, next) =>
    next(isEnabled(flag) ? undefined : new HttpError(404, `Feature "${flag}" is not enabled`));
}

module.exports = { isEnabled, allFlags, requireFeature };
