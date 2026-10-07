const { HttpError } = require('../lib/errors');
const { ALLOW, SIMULATE, capabilityFor, policyFor } = require('./capabilities');
const simulations = require('../simulations');

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Runs a simulation's guards in order, then its handler. Never falls through to `next()`: that
// would hand the request to the real route, which is exactly what a simulation must not do.
function runSimulation(chain, req, res, next) {
  let index = 0;
  const step = (error) => {
    if (error) return next(error);
    const fn = chain[index++];
    if (!fn) return next(new HttpError(500, 'A simulated handler did not respond'));
    Promise.resolve()
      .then(() => fn(req, res, step))
      .catch(next);
  };
  step();
}

// The one place a caller's role is turned into allow / simulate / deny for a write, mounted
// once ahead of every protected route (replacing the old blanket demo-is-read-only check).
// Needs req.role, which authenticate sets.
function enforceCapabilities(req, res, next) {
  if (READ_METHODS.has(req.method)) return next();

  const { capability, params } = capabilityFor(req.method, req.path);
  const policy = policyFor(req.role, capability);
  if (policy === ALLOW) return next();

  const chain = policy === SIMULATE ? simulations[capability] : null;
  if (!chain) {
    throw new HttpError(403, "That isn't available in the demo.");
  }
  // No route has matched yet, so the guards a simulation reuses get their params from here.
  req.params = params;
  runSimulation(chain, req, res, next);
}

module.exports = { enforceCapabilities };
