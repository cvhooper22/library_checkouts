// Mirrors eventIdFor in worker/src/calendarEvent.js and must produce the same id: a
// disconnect records it on the revocation so the worker deletes the right event
// (api/test/calendar.test.js checks the two agree).
function eventIdFor(householdId) {
  return `due${householdId.replace(/-/g, '').toLowerCase()}`;
}

module.exports = { eventIdFor };
