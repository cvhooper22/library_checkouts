// Dev-only scraper — see worker/scripts/seed-test-fixtures.js. Takes longer than the
// frontend is willing to wait (GIVE_UP_MS in frontend/src/lib/refresh.js, 3 minutes), then
// succeeds, to exercise the "Still working…" state and its Reload button.
//
// The worker runs one job at a time (WORKER_CONCURRENCY=1), so while this is running every
// other pull queues behind it. That's realistic, but it's why this card is off by default in
// test-fixtures.json.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isoDate(daysFromNow) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

module.exports = {
  id: 'test-hang',

  // `config.delayMs` sets how long it hangs (default 200s, just past the frontend's give-up).
  async scrape({ config }) {
    await sleep(config?.delayMs ?? 200_000);
    // Non-empty, so finishing doesn't mark the card's checkouts returned.
    return {
      checkouts: [
        { externalId: 'test-hang-0', title: 'Hyperion', dueDate: isoDate(3), overdue: false, imgSrc: null },
        { externalId: 'test-hang-1', title: 'Sea of Tranquility', dueDate: isoDate(15), overdue: false, imgSrc: null },
      ],
      errors: [],
    };
  },
};
