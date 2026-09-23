// Keeps each linked household's Google Calendar holding exactly the reminder event
// calendarEvent.js describes, and carries out queued disconnects. Everything that
// triggers a sync (the scrape hook, the daily script, the BullMQ job) calls in here.
//
// Scope: we only ever touch the calendar id stored on the household's own link, and
// only our one event on it, by id — never listing calendars or events — so anything
// else the user keeps in their Google account is out of reach.
const prisma = require('@library-tracker/db');
const { auth: googleAuth, calendar: googleCalendar } = require('@googleapis/calendar');
const { decryptCredentials } = require('./crypto');
const { buildReminderEvent, eventIdFor } = require('./calendarEvent');

// Shown on the settings card. Testing-mode grants expire after 7 days, so this is the
// expected way a connection ends, not only a revoke from the user's Google account.
const EXPIRED_MESSAGE = 'Google access expired or was revoked. Reconnect to keep reminders coming.';

function createGoogleClient(refreshToken) {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set to sync calendars');
  }
  const oauth = new googleAuth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  oauth.setCredentials({ refresh_token: refreshToken });
  return { oauth, calendar: googleCalendar({ version: 'v3', auth: oauth }) };
}

// invalid_grant: refreshing the token failed (expired or revoked). invalid_token: the
// revoke endpoint's answer for a token that's already dead.
function grantIsGone(error) {
  return ['invalid_grant', 'invalid_token'].includes(error.response?.data?.error);
}

async function ignoreMissing(request) {
  try {
    await request;
  } catch (error) {
    if (error.status !== 404 && error.status !== 410) throw error;
  }
}

// Replaces the whole event, so fields the new version leaves empty are cleared.
// `status: confirmed` brings back an event the user deleted by hand (Google keeps it
// as cancelled under the same id); a 404 means it never existed on this calendar.
async function writeEvent(calendar, calendarId, eventId, event) {
  if (!event) return ignoreMissing(calendar.events.delete({ calendarId, eventId }));

  const requestBody = { ...event, status: 'confirmed' };
  try {
    await calendar.events.update({ calendarId, eventId, requestBody });
  } catch (error) {
    if (error.status !== 404) throw error;
    await calendar.events.insert({ calendarId, requestBody });
  }
}

// Drops the link and queues its revocation in one step, so the household can connect
// again at once. The revocation keeps the event id it had so it can clean that up.
function queueRevocation(link, { deleteCalendar = false } = {}) {
  return prisma.$transaction([
    prisma.calendarLink.delete({ where: { id: link.id } }),
    prisma.calendarRevocation.create({
      data: {
        householdId: link.householdId,
        refreshTokenEncrypted: link.refreshTokenEncrypted,
        calendarId: link.calendarId,
        eventId: eventIdFor(link.householdId),
        deleteCalendar,
      },
    }),
  ]);
}

async function syncHouseholdCalendar(householdId, { now = new Date(), createClient = createGoogleClient } = {}) {
  const link = await prisma.calendarLink.findUnique({
    where: { householdId },
    include: { household: { select: { isDemo: true } } },
  });
  // The demo household is read-only and never linked (adr/0002-demo-mode.md); checked
  // here too so a stray row can't get it synced.
  if (!link || !link.enabled || link.household.isDemo) return { skipped: true };

  // The grant is one member's. Once they've left, keep their calendar from getting this
  // household's books: drop the link and revoke, leaving room for someone else.
  const stillMember = await prisma.householdMember.findUnique({
    where: { householdId_userId: { householdId, userId: link.connectedUserId } },
  });
  if (!stillMember) {
    await queueRevocation(link);
    console.log(`[calendar-sync] household ${householdId}: connected user left; link queued for revocation`);
    return { revoked: true };
  }

  const checkouts = await prisma.checkout.findMany({
    where: { returnedAt: null, account: { householdId } },
    select: {
      title: true,
      dueDate: true,
      returnedAt: true,
      account: { select: { displayName: true, deletedAt: true } },
    },
  });
  const event = buildReminderEvent({ householdId, checkouts, link, now });

  // updateMany throughout: the link can be disconnected mid-sync, which shouldn't throw.
  try {
    const { refreshToken } = decryptCredentials(link.refreshTokenEncrypted);
    const { calendar } = createClient(refreshToken);
    await writeEvent(calendar, link.calendarId, eventIdFor(householdId), event);
  } catch (error) {
    const gone = grantIsGone(error);
    await prisma.calendarLink.updateMany({
      where: { id: link.id },
      data: gone ? { enabled: false, lastError: EXPIRED_MESSAGE } : { lastError: error.message },
    });
    throw error;
  }

  await prisma.calendarLink.updateMany({
    where: { id: link.id },
    data: { lastSyncedAt: new Date(), lastError: null },
  });
  return { event: event ? 'written' : 'deleted' };
}

// One queued disconnect: remove our event, the calendar too if they asked, then revoke.
// A grant that's already gone can't reach their calendar anymore; there's nothing left
// for us to do, so that counts as done (the event stays, and it's theirs to delete).
async function revoke(revocation, createClient) {
  const { refreshToken } = decryptCredentials(revocation.refreshTokenEncrypted);
  const { oauth, calendar } = createClient(refreshToken);
  try {
    await ignoreMissing(calendar.events.delete({ calendarId: revocation.calendarId, eventId: revocation.eventId }));
    if (revocation.deleteCalendar) {
      await ignoreMissing(calendar.calendars.delete({ calendarId: revocation.calendarId }));
    }
    await oauth.revokeToken(refreshToken);
  } catch (error) {
    if (!grantIsGone(error)) throw error;
  }
}

async function processRevocations({ createClient = createGoogleClient } = {}) {
  const pending = await prisma.calendarRevocation.findMany({ orderBy: { requestedAt: 'asc' } });
  let failed = 0;
  for (const revocation of pending) {
    try {
      await revoke(revocation, createClient);
      await prisma.calendarRevocation.delete({ where: { id: revocation.id } });
    } catch (error) {
      // Left queued for the next run.
      failed += 1;
      console.error(`[calendar-sync] revocation ${revocation.id} failed: ${error.message}`);
      await prisma.calendarRevocation.update({ where: { id: revocation.id }, data: { lastError: error.message } });
    }
  }
  return { processed: pending.length, failed };
}

// Every enabled link, then the revocation queue — in that order so a revocation the
// link pass queues (a connected user who left) is carried out in the same run. One
// failure never stops the rest; the counts let a script end red so it gets noticed.
async function syncAllCalendars({ now = new Date(), createClient = createGoogleClient } = {}) {
  const links = await prisma.calendarLink.findMany({
    where: { enabled: true, household: { isDemo: false } },
    select: { householdId: true },
  });
  let failed = 0;
  for (const { householdId } of links) {
    try {
      await syncHouseholdCalendar(householdId, { now, createClient });
    } catch (error) {
      failed += 1;
      console.error(`[calendar-sync] household ${householdId} failed: ${error.message}`);
    }
  }

  const revocations = await processRevocations({ createClient });
  return { links: links.length, failed: failed + revocations.failed };
}

module.exports = {
  EXPIRED_MESSAGE,
  syncHouseholdCalendar,
  processRevocations,
  syncAllCalendars,
};
