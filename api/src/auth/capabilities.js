// Who may do what — adr/0004-capability-based-authorization.md.
//
// Every write route maps to a capability below, and every role maps each capability to a
// policy: `allow` (run the real handler), `simulate` (run the stand-in in
// simulations/index.js, which has no side effects) or `deny` (403). A role's `default`
// covers anything not listed, including a route nobody has mapped yet, so a new write
// route is unreachable for the demo role until it's added here. Reads (GET) aren't
// capabilities and stay open to any member.

const ALLOW = 'allow';
const SIMULATE = 'simulate';
const DENY = 'deny';

// Captured as req.params.id, which the guards a simulation reuses read: they run before Express
// has matched a route, so nothing else would set it.
const ID = '(?<id>[^/]+)';

// [method, path, capability]. Paths are matched whole, against the full request path.
const WRITE_ROUTES = [
  ['POST', `/accounts/${ID}/refresh`, 'account.refresh'],
  ['DELETE', `/accounts/${ID}`, 'account.delete'],
  ['POST', `/households/${ID}/accounts`, 'account.create'],
  ['PATCH', `/households/${ID}`, 'household.rename'],
  ['POST', `/households/${ID}/calendar/connect/start`, 'calendar.connect'],
  ['POST', `/households/${ID}/calendar/connect/finish`, 'calendar.connect'],
  ['PATCH', `/households/${ID}/calendar`, 'calendar.update'],
  ['DELETE', `/households/${ID}/calendar`, 'calendar.disconnect'],
  ['POST', '/me/google', 'identity.link-google'],
  ['DELETE', '/me/google', 'identity.link-google'],
].map(([method, path, capability]) => ({ method, pattern: new RegExp(`^${path}/?$`), capability }));

const CAPABILITIES = [...new Set(WRITE_ROUTES.map((route) => route.capability))];

const ROLES = {
  member: { default: ALLOW, overrides: {} },
  // How a visitor reached the shared demo household, not a standing within a household,
  // so it is not a household_members.role. Derived from the token's `demo` claim.
  demo: {
    default: DENY,
    overrides: {
      'account.refresh': SIMULATE,
      'account.create': SIMULATE,
      'account.delete': SIMULATE,
      'household.rename': SIMULATE,
      'calendar.update': SIMULATE,
      'calendar.disconnect': SIMULATE,
      // 'calendar.connect' and 'identity.link-google' stay denied: see the ADR.
    },
  },
};

function roleFor({ demo }) {
  return demo ? 'demo' : 'member';
}

// The capability a request exercises and its path parameters, or a null capability for a
// write that isn't mapped.
function capabilityFor(method, path) {
  for (const route of WRITE_ROUTES) {
    const match = route.method === method && route.pattern.exec(path);
    if (match) return { capability: route.capability, params: { ...match.groups } };
  }
  return { capability: null, params: {} };
}

function policyFor(role, capability) {
  const { default: fallback, overrides } = ROLES[role];
  return (capability && overrides[capability]) || fallback;
}

// What GET /me reports so the client can render from policies rather than from a role.
function policiesFor(role) {
  return Object.fromEntries(CAPABILITIES.map((capability) => [capability, policyFor(role, capability)]));
}

module.exports = { ALLOW, SIMULATE, DENY, CAPABILITIES, roleFor, capabilityFor, policyFor, policiesFor };
