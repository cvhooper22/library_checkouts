// Emails are stored and looked up in one form, so `Foo@Example.com ` and
// `foo@example.com` are the same account. The users_email_normalized check
// constraint rejects anything written without going through this.
function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : email;
}

module.exports = { normalizeEmail };
