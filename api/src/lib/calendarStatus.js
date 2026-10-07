const prisma = require('@library-tracker/db');
const { HttpError } = require('./errors');

// What the calendar routes and their demo simulations share: reading a household's calendar
// status, validating a settings change, and the check that only the connecting member may
// change it. Kept apart from routes/calendar.js so a simulation can't drift from the real
// handler's rules (adr/0004-capability-based-authorization.md).

const MINUTES_PER_DAY = 24 * 60;
const REMINDER_STEP = 30;

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

// The settings a PATCH may change, validated. Throws a 400 for anything invalid or empty.
function parseSettingsChanges(body) {
  const { reminderTime, timeZone, showTitles } = body || {};
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
  return data;
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

module.exports = { findStatus, present, isTimeZone, parseSettingsChanges, requireConnectedUser };
