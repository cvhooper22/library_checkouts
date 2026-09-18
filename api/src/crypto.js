const crypto = require('crypto');

// Mirrors worker/src/crypto.js — must stay byte-for-byte compatible since the
// worker is what decrypts these blobs at scrape time. Only encryption is needed
// here; decryption only ever happens in the worker process (architecture.md §6).
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

// Encrypts a credentials object into the base64 blob stored in accounts.credentials_encrypted.
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
