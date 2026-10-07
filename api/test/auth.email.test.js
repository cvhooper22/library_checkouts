process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/db';
process.env.JWT_SECRET ??= 'test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const prisma = require('@library-tracker/db');
const { createApp } = require('../src/app');

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

async function post(t, path, body) {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test('POST /auth/register stores the email trimmed and lowercased', async (t) => {
  const lookups = stub(t, prisma.user, 'findUnique', async () => null);
  const creates = stub(t, prisma.user, 'create', async ({ data }) => ({ id: 'user-1', ...data }));
  stub(t, prisma.household, 'create', async () => ({ id: 'household-1', name: 'Home' }));

  const { status, body } = await post(t, '/auth/register', {
    email: '  Reader@Example.COM ',
    password: 'hunter22',
    householdName: 'Home',
  });

  assert.equal(status, 201);
  assert.deepEqual(lookups[0][0], { where: { email: 'reader@example.com' } });
  assert.equal(creates[0][0].data.email, 'reader@example.com');
  assert.equal(body.user.email, 'reader@example.com');
});

test('POST /auth/login matches an email typed with different case', async (t) => {
  const passwordHash = await bcrypt.hash('hunter22', 4);
  const lookups = stub(t, prisma.user, 'findUnique', async () => ({ id: 'user-1', passwordHash }));

  const { status } = await post(t, '/auth/login', { email: 'READER@example.com ', password: 'hunter22' });

  assert.equal(status, 200);
  assert.deepEqual(lookups[0][0], { where: { email: 'reader@example.com' } });
});
