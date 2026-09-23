const express = require('express');
const prisma = require('@library-tracker/db');
const { requireHouseholdMember } = require('../auth/middleware');
const { signCalendarState, verifyCalendarState } = require('../auth/tokens');
const { requireFeature } = require('../features');
const { encryptCredentials } = require('../crypto');
const { eventIdFor } = require('../calendarEventId');
const queue = require('../queue');
const google = require('../googleCalendar');
const { HttpError } = require('../lib/errors');

// A household's Google Calendar reminder: connect (OAuth, one member's grant), settings,
// disconnect. Mounted at /households/:id/calendar. Any member can see the status; only
// the member who connected can change, reconnect or disconnect it, since it's their
// Google account. The API never calls Google with a stored token — every calendar write
// after connecting happens in the worker (worker/src/calendarSync.js).
const router = express.Router({ mergeParams: true });
router.use(requireFeature('calendar'), requireHouseholdMember);

const MINUTES_PER_DAY = 24 * 60;
const REMINDER_STEP = 30;
// A base64url SHA-256, which is what S256 PKCE sends.
const CODE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

// Explicit select: the refresh token never leaves the database through the API.
const STATUS_SELECT = {
  reminderTime: true,
  timeZone: true,
  showTitles: true,
  enabled: true,
  lastSyncedAt: true,
  lastError: true,
  connectedUserId: true,
  connectedUser: { select: { email: true } },
};

function findStatus(householdId) {
  return prisma.calendarLink.findUnique({ where: { householdId }, select: STATUS_SELECT });
}

function present(link, userId) {
  if (!link) return null;
  const { connectedUserId, connectedUser, ...status } = link;
  return { ...status, connectedBy: connectedUser.email, isYou: connectedUserId === userId };
}

function isTimeZone(value) {
  if (typeof value !== 'string' || !value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// After a change the household's event should reflect it soon. Never fails the request:
// if the trigger can't start, the daily sync (calendar-sync.yml) catches up.
async function syncSoon(householdId) {
  try {
    await queue.enqueueCalendarSync({ householdId });
  } catch (error) {
    console.error(`[api] could not start a calendar sync for household ${householdId}:`, error.message);
  }
}

// Connecting is open to any member while nothing is linked, and to the connected member
// for a reconnect. The demo household never links (adr/0002-demo-mode.md): demoReadOnly
// already blocks demo tokens, and this keeps the rule even if that changes.
async function assertCanConnect(householdId, userId) {
  const household = await prisma.household.findUnique({
    where: { id: householdId },
    select: { isDemo: true, calendarLink: { select: { connectedUserId: true, calendarId: true, timeZone: true } } },
  });
  if (household.isDemo) {
    throw new HttpError(403, 'The demo household cannot connect a calendar.');
  }
  const link = household.calendarLink;
  if (link && link.connectedUserId !== userId) {
    throw new HttpError(409, 'Another member already connected a calendar for this household.');
  }
  return link;
}

async function requireConnectedUser(req, res, next) {
  const link = await prisma.calendarLink.findUnique({ where: { householdId: req.params.id } });
  if (!link) {
    throw new HttpError(404, 'No calendar is connected');
  }
  if (link.connectedUserId !== req.userId) {
    throw new HttpError(403, 'Only the member who connected this calendar can change it.');
  }
  req.calendarLink = link;
  next();
}

router.get('/', async (req, res) => {
  res.json({ calendar: present(await findStatus(req.params.id), req.userId) });
});

// Step 1 of connecting: the Google consent URL. The browser made the PKCE verifier and
// keeps it (with `state`) in sessionStorage; it sends only the challenge here.
router.post('/connect/start', async (req, res) => {
  const { codeChallenge } = req.body || {};
  if (typeof codeChallenge !== 'string' || !CODE_CHALLENGE.test(codeChallenge)) {
    throw new HttpError(400, 'codeChallenge must be an S256 PKCE challenge');
  }
  await assertCanConnect(req.params.id, req.userId);

  const state = signCalendarState({ userId: req.userId, householdId: req.params.id });
  res.json({ url: google.authUrl({ state, codeChallenge }), state });
});

// Step 2: the browser landed on /calendar/callback, checked `state` against the one it
// stored, and hands over the code. The state must also be this user's, for this household,
// and unexpired — so a callback link from someone else's attempt can't attach their Google
// calendar to this household or yours to theirs.
router.post('/connect/finish', async (req, res) => {
  const { code, state, verifier, timeZone } = req.body || {};
  if (typeof code !== 'string' || !code || typeof verifier !== 'string' || !verifier) {
    throw new HttpError(400, 'code and verifier are required');
  }
  if (!isTimeZone(timeZone)) {
    throw new HttpError(400, 'timeZone must be an IANA time zone, e.g. America/Los_Angeles');
  }

  let claims;
  try {
    claims = verifyCalendarState(state);
  } catch {
    throw new HttpError(400, 'This connection attempt expired or is invalid. Start again.');
  }
  if (claims.userId !== req.userId || claims.householdId !== req.params.id) {
    throw new HttpError(403, 'This connection attempt was started by someone else. Start again.');
  }
  const link = await assertCanConnect(req.params.id, req.userId);

  let grant;
  try {
    grant = await google.exchangeCode({ code, verifier });
  } catch {
    throw new HttpError(400, 'Google did not accept this connection. Start again.');
  }
  if (!grant.scopes.includes(google.SCOPE)) {
    throw new HttpError(400, 'Calendar access was not granted. Start again and leave the calendar box ticked.');
  }
  if (!grant.refreshToken) {
    throw new HttpError(400, 'Google did not return long-term access. Start again.');
  }

  // A reconnect keeps the household's calendar and settings when the new grant can still
  // reach that calendar. The old token is only replaced, not revoked: for the same Google
  // account a revoke would kill the grant we were just given.
  const calendarId = link && (await google.canReachCalendar(grant.oauth, link.calendarId))
    ? link.calendarId
    : await google.createCalendar(grant.oauth, link?.timeZone ?? timeZone);
  const connection = {
    calendarId,
    refreshTokenEncrypted: encryptCredentials({ refreshToken: grant.refreshToken }),
    enabled: true,
    lastError: null,
  };

  if (link) {
    // Scoped to this user, so a link another member made in the meantime is never overwritten.
    const { count } = await prisma.calendarLink.updateMany({
      where: { householdId: req.params.id, connectedUserId: req.userId },
      data: connection,
    });
    if (count === 0) {
      throw new HttpError(409, 'Another member already connected a calendar for this household.');
    }
  } else {
    try {
      await prisma.calendarLink.create({
        data: { ...connection, householdId: req.params.id, connectedUserId: req.userId, timeZone },
      });
    } catch (error) {
      if (error.code === 'P2002') {
        throw new HttpError(409, 'Another member already connected a calendar for this household.');
      }
      throw error;
    }
  }

  await syncSoon(req.params.id);
  res.status(link ? 200 : 201).json({ calendar: present(await findStatus(req.params.id), req.userId) });
});

router.patch('/', requireConnectedUser, async (req, res) => {
  const { reminderTime, timeZone, showTitles } = req.body || {};
  const data = {};
  if (reminderTime !== undefined) {
    const valid = Number.isInteger(reminderTime) && reminderTime >= 0 && reminderTime < MINUTES_PER_DAY
      && reminderTime % REMINDER_STEP === 0;
    if (!valid) {
      throw new HttpError(400, 'reminderTime must be minutes after midnight, on a half hour (0, 30, … 1410)');
    }
    data.reminderTime = reminderTime;
  }
  if (timeZone !== undefined) {
    if (!isTimeZone(timeZone)) {
      throw new HttpError(400, 'timeZone must be an IANA time zone, e.g. America/Los_Angeles');
    }
    data.timeZone = timeZone;
  }
  if (showTitles !== undefined) {
    if (typeof showTitles !== 'boolean') {
      throw new HttpError(400, 'showTitles must be true or false');
    }
    data.showTitles = showTitles;
  }
  if (Object.keys(data).length === 0) {
    throw new HttpError(400, 'Nothing to change: send reminderTime, timeZone or showTitles');
  }

  await prisma.calendarLink.update({ where: { id: req.calendarLink.id }, data });
  await syncSoon(req.params.id);
  res.json({ calendar: present(await findStatus(req.params.id), req.userId) });
});

// Disconnect. Revoking needs the decrypted token, and only the worker decrypts, so the
// link goes now (freeing the household to connect again) and a revocation is queued for
// the worker: delete our event, the calendar too if asked, then revoke the grant.
router.delete('/', requireConnectedUser, async (req, res) => {
  const link = req.calendarLink;
  await prisma.$transaction([
    prisma.calendarLink.delete({ where: { id: link.id } }),
    prisma.calendarRevocation.create({
      data: {
        householdId: link.householdId,
        refreshTokenEncrypted: link.refreshTokenEncrypted,
        calendarId: link.calendarId,
        eventId: eventIdFor(link.householdId),
        deleteCalendar: req.query.deleteCalendar === 'true',
      },
    }),
  ]);
  await syncSoon(req.params.id);
  res.status(204).end();
});

module.exports = router;
