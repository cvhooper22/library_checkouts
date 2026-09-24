// Turns a household's checkouts into the one Google Calendar reminder event the sync
// keeps on its linked calendar. Pure — no database or Google calls — so the rules live
// here and calendarSync.js only loads rows and writes the result.
//
// The rules: one event on the soonest due date among books still out, at the link's
// reminder time. If that date has already passed, the event sits on today instead and
// repeats once, so it reminds today and tomorrow; the daily sync keeps moving it forward.

const EVENT_MINUTES = 15;
const LATE_REMINDER_MINUTES = 15;
const OVERDUE_RULE = 'RRULE:FREQ=DAILY;COUNT=2';

// Google event ids allow a–v and 0–9 only, which covers a dash-less UUID. One event per
// household, so its id comes from the household: every sync writes the same event.
function eventIdFor(householdId) {
  return `due${householdId.replace(/-/g, '').toLowerCase()}`;
}

// `now` in `timeZone`: the date as YYYY-MM-DD (which compares correctly as a string)
// and the minutes since that day's midnight.
function localNow(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type).value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

// checkouts.due_date is a Postgres DATE, which Prisma hands back as UTC midnight.
function dueDateOf(checkout) {
  return checkout.dueDate.toISOString().slice(0, 10);
}

// A local wall-clock time on `date`, `minutes` after its midnight. Google reads it in the
// event's timeZone, so no offset. Rolls into the next day for late reminder times.
function wallClock(date, minutes) {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + Math.floor(minutes / 1440));
  const time = minutes % 1440;
  const hh = String(Math.floor(time / 60)).padStart(2, '0');
  const mm = String(time % 60).padStart(2, '0');
  return `${day.toISOString().slice(0, 10)}T${hh}:${mm}:00`;
}

function describe(checkouts, showTitles) {
  const byAccount = new Map();
  for (const checkout of checkouts) {
    const name = checkout.account.displayName;
    if (!byAccount.has(name)) byAccount.set(name, []);
    byAccount.get(name).push(checkout.title);
  }
  const names = [...byAccount.keys()].sort((a, b) => a.localeCompare(b));
  // Titles off: the calendar may be shared beyond the household, so only say whose.
  if (!showTitles) return names.join(', ');
  return names
    .map((name) => `${name}: ${byAccount.get(name).sort((a, b) => a.localeCompare(b)).join(', ')}`)
    .join('\n');
}

/**
 * The event the household's calendar should hold right now, or null for none.
 *
 * @param {object} args
 * @param {string} args.householdId
 * @param {Array<{ title: string, dueDate: Date, returnedAt: Date | null,
 *   account: { displayName: string, deletedAt: Date | null } }>} args.checkouts
 *   The household's checkouts. Returned ones and those on deleted cards are skipped
 *   here: a deleted card is never scraped again, so its books would never come back.
 * @param {{ reminderTime: number, timeZone: string, showTitles: boolean }} args.link
 * @param {Date} args.now
 */
function buildReminderEvent({ householdId, checkouts, link, now }) {
  const out = checkouts.filter((checkout) => !checkout.returnedAt && !checkout.account.deletedAt);
  if (out.length === 0) return null;

  const { date: today, minutes: nowMinutes } = localNow(now, link.timeZone);
  const soonest = out.map(dueDateOf).reduce((a, b) => (b < a ? b : a));
  const overdue = soonest < today;

  const books = overdue
    ? out.filter((checkout) => dueDateOf(checkout) < today)
    : out.filter((checkout) => dueDateOf(checkout) === soonest);
  const date = overdue ? today : soonest;
  const count = `${books.length} library book${books.length === 1 ? '' : 's'}`;

  // A popup for a time that has already passed never fires, so a reminder due today but
  // written after its time (a 2 PM scrape finding a book due today) goes 15 minutes out.
  const start = date === today && link.reminderTime <= nowMinutes
    ? nowMinutes + LATE_REMINDER_MINUTES
    : link.reminderTime;

  return {
    id: eventIdFor(householdId),
    summary: overdue ? `${count} overdue` : `${count} due`,
    description: describe(books, link.showTitles),
    start: { dateTime: wallClock(date, start), timeZone: link.timeZone },
    end: { dateTime: wallClock(date, start + EVENT_MINUTES), timeZone: link.timeZone },
    // Empty on purpose when not overdue: the sync replaces the whole event, and a
    // missing field could leave yesterday's overdue repeat in place.
    recurrence: overdue ? [OVERDUE_RULE] : [],
    // Reminders set here reach the user whose grant we write with, and only them.
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] },
  };
}

module.exports = { buildReminderEvent, eventIdFor };
