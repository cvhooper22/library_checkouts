const { OAuth2Client } = require('google-auth-library');
const { HttpError } = require('../lib/errors');

const googleClient = new OAuth2Client();

// Checks a Google Identity Services ID token and returns its payload. Shared by
// sign-in (POST /auth/google) and linking from a signed-in account (POST /me/google).
async function verifyGoogleIdToken(idToken) {
  if (!idToken) {
    throw new HttpError(400, 'idToken is required');
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    throw new HttpError(401, 'Invalid Google token');
  }

  // Google itself attests this, so it's safe to tell the caller directly —
  // they already hold a signed token proving they control this Google
  // session, unlike an anonymous /login attempt where vagueness matters.
  if (!payload.email_verified) {
    throw new HttpError(
      401,
      "Your Google account's email isn't verified. Verify it with Google, then try again.",
    );
  }

  return payload;
}

module.exports = { verifyGoogleIdToken };
