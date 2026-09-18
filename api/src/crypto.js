const crypto = require('crypto');

// Mirrors worker/src/crypto.js's encrypt half. Duplicated rather than shared
// because api/ and worker/ are independent packages with no dependency between
// them (adr/0001-repository-layout.md) — both must use the same
// CREDENTIAL_ENCRYPTION_KEY so the worker can decrypt what the API writes.
// Decryption only ever happens in the worker (architecture.md §6), so this
// file intentionally has no decrypt half.
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getKey() {
  const keyB64 = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!keyB64) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY is not set');
  }
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY must decode to 32 bytes (generate with: openssl rand -base64 32)');
  }
  return key;
}

function encryptCredentials(credentialsObject) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(credentialsObject), 'utf8')),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

module.exports = { encryptCredentials };
