process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/db';
process.env.JWT_SECRET ??= 'test-secret';
process.env.GOOGLE_CLIENT_ID ??= 'test-client-id';

const test = require('node:test');
const assert = require('node:assert/strict');
const { OAuth2Client } = require('google-auth-library');
const prisma = require('@library-tracker/db');
const { createApp } = require('../src/app');
const { signToken } = require('../src/auth/tokens');

const ME = 'user-1';
const GOOGLE_PAYLOAD = {
  sub: 'google-sub-123',
  email: 'someone.else@gmail.com', // not the account's email: linking from /me doesn't need a match
  email_verified: true,
};
const PASSWORD_USER = { id: ME, email: 'reader@example.com', passwordHash: 'hash', googleId: null };

// Same approach as auth.google.test.js: Prisma's delegates reject t.mock.method, so stub
// by assignment and restore afterwards.
function stub(t, object, methodName, implementation) {
  const original = object[methodName];
  const calls = [];
  object[methodName] = (...args) => {
    calls.push(args);
    return implementation(...args);
  };
  t.after(() => {
    object[methodName] = original;
  });
  return calls;
}

async function call(t, method, path, { token = signToken(ME), body } = {}) {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body && { 'Content-Type': 'application/json' }) },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function stubGoogle(t, payload = GOOGLE_PAYLOAD) {
  stub(t, OAuth2Client.prototype, 'verifyIdToken', async () => ({ getPayload: () => payload }));
}

// Answers findUnique by id with `me`, and by googleId with `googleOwner`.
function stubUsers(t, me, googleOwner = null) {
  return stub(t, prisma.user, 'findUnique', async ({ where }) => (where.id ? me : googleOwner));
}

test('GET /me reports sign-in methods without leaking the hash or Google id', async (t) => {
  stub(t, prisma.user, 'findUnique', async () => ({ ...PASSWORD_USER, householdMembers: [] }));

  const { status, body } = await call(t, 'GET', '/me');

  assert.equal(status, 200);
  assert.deepEqual(body.user, { id: ME, email: PASSWORD_USER.email, hasPassword: true, googleLinked: false });
});

test('POST /me/google links a Google account with a different email', async (t) => {
  stubGoogle(t);
  stubUsers(t, PASSWORD_USER);
  const updates = stub(t, prisma.user, 'update', async ({ data }) => ({ ...PASSWORD_USER, ...data }));

  const { status, body } = await call(t, 'POST', '/me/google', { body: { idToken: 'fake' } });

  assert.equal(status, 200);
  assert.deepEqual(body, { hasPassword: true, googleLinked: true });
  assert.deepEqual(updates[0][0], { where: { id: ME }, data: { googleId: GOOGLE_PAYLOAD.sub } });
});

test('POST /me/google is a no-op when that Google account is already linked', async (t) => {
  stubGoogle(t);
  stubUsers(t, { ...PASSWORD_USER, googleId: GOOGLE_PAYLOAD.sub });
  const updates = stub(t, prisma.user, 'update', async () => {
    throw new Error('should not update');
  });

  const { status, body } = await call(t, 'POST', '/me/google', { body: { idToken: 'fake' } });

  assert.equal(status, 200);
  assert.deepEqual(body, { hasPassword: true, googleLinked: true });
  assert.equal(updates.length, 0);
});

test('POST /me/google refuses a Google account that belongs to another user', async (t) => {
  stubGoogle(t);
  stubUsers(t, PASSWORD_USER, { id: 'user-2', googleId: GOOGLE_PAYLOAD.sub });

  const { status, body } = await call(t, 'POST', '/me/google', { body: { idToken: 'fake' } });

  assert.equal(status, 409);
  assert.match(body.error, /different account/);
});

test('POST /me/google refuses to replace a different linked Google account', async (t) => {
  stubGoogle(t);
  stubUsers(t, { ...PASSWORD_USER, googleId: 'other-sub' });

  const { status, body } = await call(t, 'POST', '/me/google', { body: { idToken: 'fake' } });

  assert.equal(status, 409);
  assert.match(body.error, /Unlink it first/);
});

test('POST /me/google turns a lost race on the unique googleId into a 409', async (t) => {
  stubGoogle(t);
  stubUsers(t, PASSWORD_USER);
  stub(t, prisma.user, 'update', async () => {
    throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
  });

  const { status } = await call(t, 'POST', '/me/google', { body: { idToken: 'fake' } });

  assert.equal(status, 409);
});

test('POST /me/google rejects an unverified Google email', async (t) => {
  stubGoogle(t, { ...GOOGLE_PAYLOAD, email_verified: false });

  const { status } = await call(t, 'POST', '/me/google', { body: { idToken: 'fake' } });

  assert.equal(status, 401);
});

test('POST /me/google is blocked for demo tokens', async (t) => {
  const { status } = await call(t, 'POST', '/me/google', {
    token: signToken(ME, { demo: true }),
    body: { idToken: 'fake' },
  });

  assert.equal(status, 403);
});

test('DELETE /me/google unlinks when the account has a password', async (t) => {
  stubUsers(t, { ...PASSWORD_USER, googleId: GOOGLE_PAYLOAD.sub });
  const updates = stub(t, prisma.user, 'update', async ({ data }) => ({ ...PASSWORD_USER, ...data }));

  const { status, body } = await call(t, 'DELETE', '/me/google');

  assert.equal(status, 200);
  assert.deepEqual(body, { hasPassword: true, googleLinked: false });
  assert.deepEqual(updates[0][0].data, { googleId: null });
});

test('DELETE /me/google refuses when Google is the only way to sign in', async (t) => {
  stubUsers(t, { ...PASSWORD_USER, passwordHash: null, googleId: GOOGLE_PAYLOAD.sub });
  const updates = stub(t, prisma.user, 'update', async () => {
    throw new Error('should not update');
  });

  const { status, body } = await call(t, 'DELETE', '/me/google');

  assert.equal(status, 409);
  assert.match(body.error, /only way to sign in/);
  assert.equal(updates.length, 0);
});
