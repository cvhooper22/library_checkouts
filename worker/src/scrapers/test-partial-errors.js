// Dev-only scraper — see worker/scripts/seed-test-fixtures.js. Returns some checkouts *and* a
// non-empty `errors` array, the way a real scrape that got blocked or lost a page partway
// would. The worker must treat that as a failed run and apply none of it: the checkouts here
// must never be written, and the account's existing checkouts must not be marked returned
// (worker/src/index.js). Different code path from test-failure, which throws.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isoDate(daysFromNow) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

module.exports = {
  id: 'test-partial-errors',

  // `config.delayMs` tunes the simulated scrape time (default 1s).
  async scrape({ config }) {
    await sleep(config?.delayMs ?? 1000);
    return {
      checkouts: [
        { externalId: 'test-partial-0', title: 'Exhalation', dueDate: isoDate(4), overdue: false, imgSrc: null },
        { externalId: 'test-partial-1', title: 'Circe', dueDate: isoDate(11), overdue: false, imgSrc: null },
      ],
      errors: ['Simulated: page 2 of the checkouts list failed to load'],
    };
  },
};
