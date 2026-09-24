const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReminderEvent, eventIdFor } = require('../src/calendarEvent');

const HOUSEHOLD_ID = '3F2A9C1E-5B7D-4E8A-9C21-7D4E5F6A8B90';
const LINK = { reminderTime: 480, timeZone: 'America/Los_Angeles', showTitles: true };
// 2026-10-05 07:00 in Los Angeles (14:00 UTC): before the 8:00 reminder time.
const NOW = new Date('2026-10-05T14:00:00Z');

function checkout(title, dueDate, displayName, { returnedAt = null, deletedAt = null } = {}) {
  return {
    title,
    dueDate: new Date(`${dueDate}T00:00:00Z`), // how Prisma returns a DATE column
    returnedAt,
    account: { displayName, deletedAt },
  };
}

function build(checkouts, { link = LINK, now = NOW } = {}) {
  return buildReminderEvent({ householdId: HOUSEHOLD_ID, checkouts, link, now });
}

test('event ids use only characters Google allows and are stable per household', () => {
  const id = eventIdFor(HOUSEHOLD_ID);
  assert.match(id, /^[a-v0-9]{5,1024}$/);
  assert.equal(id, eventIdFor(HOUSEHOLD_ID.toLowerCase()));
  assert.equal(build([checkout('Dune', '2026-10-09', 'Ian')]).id, id);
});

test('no event when nothing is checked out', () => {
  assert.equal(build([]), null);
});

test('the event sits on the soonest due date and lists only the books due that day', () => {
  const event = build([
    checkout('Later Book', '2026-10-20', 'Ian'),
    checkout('The Hobbit', '2026-10-09', 'Ian'),
    checkout('Dune', '2026-10-09', 'Ian'),
    checkout('Matilda', '2026-10-09', 'Mom'),
  ]);

  assert.equal(event.summary, '3 library books due');
  assert.equal(event.description, 'Ian: Dune, The Hobbit\nMom: Matilda');
  assert.deepEqual(event.start, { dateTime: '2026-10-09T08:00:00', timeZone: 'America/Los_Angeles' });
  assert.deepEqual(event.end, { dateTime: '2026-10-09T08:15:00', timeZone: 'America/Los_Angeles' });
  assert.deepEqual(event.recurrence, []);
  assert.deepEqual(event.reminders, { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] });
});

test('a book due today is not overdue', () => {
  const event = build([checkout('Dune', '2026-10-05', 'Ian')]);
  assert.equal(event.summary, '1 library book due');
  assert.equal(event.start.dateTime, '2026-10-05T08:00:00');
  assert.deepEqual(event.recurrence, []);
});

test('overdue: today at the reminder time, repeating once for tomorrow, listing every overdue book', () => {
  const event = build([
    checkout('Dune', '2026-10-01', 'Ian'),
    checkout('Matilda', '2026-10-03', 'Mom'),
    checkout('Not Yet', '2026-10-05', 'Mom'),
  ]);

  assert.equal(event.summary, '2 library books overdue');
  assert.equal(event.description, 'Ian: Dune\nMom: Matilda');
  assert.equal(event.start.dateTime, '2026-10-05T08:00:00');
  assert.deepEqual(event.recurrence, ['RRULE:FREQ=DAILY;COUNT=2']);
});

test('"today" comes from the link\'s time zone, not UTC', () => {
  // 2026-10-05 22:00 UTC is still the 5th in Los Angeles (15:00) but already the 6th
  // in Tokyo (07:00, before the 8:00 reminder).
  const now = new Date('2026-10-05T22:00:00Z');
  const books = [checkout('Dune', '2026-10-05', 'Ian')];

  assert.equal(build(books, { now }).summary, '1 library book due');
  const tokyo = build(books, { now, link: { ...LINK, timeZone: 'Asia/Tokyo' } });
  assert.equal(tokyo.summary, '1 library book overdue');
  assert.equal(tokyo.start.dateTime, '2026-10-06T08:00:00');
});

test('Show titles off lists only whose books, not the titles', () => {
  const event = build(
    [checkout('Dune', '2026-10-09', 'Mom'), checkout('The Hobbit', '2026-10-09', 'Ian')],
    { link: { ...LINK, showTitles: false } },
  );
  assert.equal(event.description, 'Ian, Mom');
  assert.doesNotMatch(event.description, /Dune|Hobbit/);
});

test('returned books and books on deleted cards are skipped', () => {
  const event = build([
    checkout('Returned', '2026-10-06', 'Ian', { returnedAt: new Date('2026-10-04T00:00:00Z') }),
    checkout('Deleted Card', '2026-10-01', 'Old Card', { deletedAt: new Date('2026-09-30T00:00:00Z') }),
    checkout('Dune', '2026-10-09', 'Ian'),
  ]);
  assert.equal(event.summary, '1 library book due');
  assert.equal(event.description, 'Ian: Dune');
  assert.equal(event.start.dateTime, '2026-10-09T08:00:00');

  assert.equal(build([checkout('Deleted Card', '2026-10-01', 'Old Card', { deletedAt: new Date() })]), null);
});

test('reminder time sets the start; a late one rolls the end into the next day', () => {
  const event = build([checkout('Dune', '2026-10-09', 'Ian')], { link: { ...LINK, reminderTime: 23 * 60 + 50 } });
  assert.equal(event.start.dateTime, '2026-10-09T23:50:00');
  assert.equal(event.end.dateTime, '2026-10-10T00:05:00');
});

test('written after today\'s reminder time: the event moves to 15 minutes from now', () => {
  const afternoon = new Date('2026-10-05T21:00:00Z'); // 14:00 in Los Angeles

  const dueToday = build([checkout('Dune', '2026-10-05', 'Ian')], { now: afternoon });
  assert.equal(dueToday.start.dateTime, '2026-10-05T14:15:00');
  assert.equal(dueToday.end.dateTime, '2026-10-05T14:30:00');

  const overdue = build([checkout('Dune', '2026-10-01', 'Ian')], { now: afternoon });
  assert.equal(overdue.start.dateTime, '2026-10-05T14:15:00');
  assert.deepEqual(overdue.recurrence, ['RRULE:FREQ=DAILY;COUNT=2']);

  // A future due date keeps the reminder time whatever time it is now.
  const later = build([checkout('Dune', '2026-10-09', 'Ian')], { now: afternoon });
  assert.equal(later.start.dateTime, '2026-10-09T08:00:00');
});

test('written exactly at the reminder time counts as late', () => {
  const eight = new Date('2026-10-05T15:00:00Z'); // 08:00 in Los Angeles
  const event = build([checkout('Dune', '2026-10-05', 'Ian')], { now: eight });
  assert.equal(event.start.dateTime, '2026-10-05T08:15:00');
});

test('a late reminder near midnight rolls into the next day', () => {
  const lateNight = new Date('2026-10-06T06:50:00Z'); // 23:50 on the 5th in Los Angeles
  const event = build([checkout('Dune', '2026-10-05', 'Ian')], { now: lateNight });
  assert.equal(event.start.dateTime, '2026-10-06T00:05:00');
  assert.equal(event.end.dateTime, '2026-10-06T00:20:00');
});
