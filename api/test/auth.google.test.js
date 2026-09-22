process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/db';
process.env.JWT_SECRET ??= 'test-secret';
process.env.GOOGLE_CLIENT_ID ??= 'test-client-id';

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const prisma = require('@library-tracker/db');
const { createApp } = require('../src/app');

const GOOGLE_PAYLOAD = {
  sub: 'google-sub-123',
  email: 'reader@example.com',
  email_verified: true,
  given_name: 'Reader',
};

// Prisma's model delegates (prisma.user, prisma.household, ...) are Proxies whose own
// property descriptors report `value: undefined` for every method, so node:test's
// `t.mock.method` (which reads that descriptor) rejects them as "not a method". Plain
// assignment works fine — Prisma has no `set` trap — so this stubs that way instead and
// restores the original via `t.after`, tracking calls the same way `t.mock.method` would.
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

async function postGoogle(server, body) {
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function withServer(t, fn) {
  const server = createApp().listen(0);
  t.after(() => server.close());
  await fn(server);
}

test('POST /auth/google creates a new user and household on first sign-in', async (t) => {
  stub(t, OAuth2Client.prototype, 'verifyIdToken', async () => ({ getPayload: () => GOOGLE_PAYLOAD }));
  stub(t, prisma.user, 'findUnique', async () => null);
  const created = { id: 'user-1', email: GOOGLE_PAYLOAD.email, googleId: GOOGLE_PAYLOAD.sub };
  const userCreateCalls = stub(t, prisma.user, 'create', async () => created);
  const householdCreateCalls = stub(t, prisma.household, 'create', async () => ({
    id: 'household-1',
    name: "Reader's Household",
  }));
  stub(t, prisma, '$transaction', async (fn) => fn(prisma));

  await withServer(t, async (server) => {
    const { status, body } = await postGoogle(server, { idToken: 'fake-id-token' });

    assert.equal(status, 200);
    assert.equal(jwt.verify(body.token, process.env.JWT_SECRET).sub, 'user-1');
    assert.equal(userCreateCalls[0][0].data.googleId, GOOGLE_PAYLOAD.sub);
    assert.equal(householdCreateCalls[0][0].data.ownerUserId, 'user-1');
  });
});

test('POST /auth/google signs in an existing Google-linked user without creating anything', async (t) => {
  stub(t, OAuth2Client.prototype, 'verifyIdToken', async () => ({ getPayload: () => GOOGLE_PAYLOAD }));
  stub(t, prisma.user, 'findUnique', async () => ({
    id: 'user-2',
    email: GOOGLE_PAYLOAD.email,
    googleId: GOOGLE_PAYLOAD.sub,
  }));
  const userCreateCalls = stub(t, prisma.user, 'create', async () => {
    throw new Error('should not create a user that already exists');
  });

  await withServer(t, async (server) => {
    const { status, body } = await postGoogle(server, { idToken: 'fake-id-token' });

    assert.equal(status, 200);
    assert.equal(jwt.verify(body.token, process.env.JWT_SECRET).sub, 'user-2');
    assert.equal(userCreateCalls.length, 0);
  });
});

test('POST /auth/google links an existing password account by email', async (t) => {
  stub(t, OAuth2Client.prototype, 'verifyIdToken', async () => ({ getPayload: () => GOOGLE_PAYLOAD }));
  const findUniqueCalls = stub(t, prisma.user, 'findUnique', async ({ where }) =>
    where.googleId ? null : { id: 'user-3', email: GOOGLE_PAYLOAD.email, passwordHash: 'hash' },
  );
  const userUpdateCalls = stub(t, prisma.user, 'update', async () => ({
    id: 'user-3',
    email: GOOGLE_PAYLOAD.email,
    googleId: GOOGLE_PAYLOAD.sub,
  }));

  await withServer(t, async (server) => {
    const { status, body } = await postGoogle(server, { idToken: 'fake-id-token' });

    assert.equal(status, 200);
    assert.equal(jwt.verify(body.token, process.env.JWT_SECRET).sub, 'user-3');
    assert.equal(findUniqueCalls.length, 2);
    assert.deepEqual(userUpdateCalls[0][0], {
      where: { id: 'user-3' },
      data: { googleId: GOOGLE_PAYLOAD.sub },
    });
  });
});

test('POST /auth/google rejects an unverified email', async (t) => {
  stub(t, OAuth2Client.prototype, 'verifyIdToken', async () => ({
    getPayload: () => ({ ...GOOGLE_PAYLOAD, email_verified: false }),
  }));
  stub(t, prisma.user, 'findUnique', async () => {
    throw new Error('should not query the database before checking email_verified');
  });

  await withServer(t, async (server) => {
    const { status, body } = await postGoogle(server, { idToken: 'fake-id-token' });

    assert.equal(status, 401);
    assert.match(body.error, /verified/i);
  });
});

test('POST /auth/google rejects a token that fails Google verification', async (t) => {
  stub(t, OAuth2Client.prototype, 'verifyIdToken', async () => {
    throw new Error('invalid_token');
  });

  await withServer(t, async (server) => {
    const { status, body } = await postGoogle(server, { idToken: 'not-a-real-token' });

    assert.equal(status, 401);
    assert.match(body.error, /invalid google token/i);
  });
});

test('POST /auth/google requires an idToken', async (t) => {
  await withServer(t, async (server) => {
    const { status, body } = await postGoogle(server, {});

    assert.equal(status, 400);
    assert.match(body.error, /idToken/);
  });
});
