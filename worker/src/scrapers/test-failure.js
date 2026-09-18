// Dev-only scraper — see worker/scripts/seed-test-fixtures.js. Always fails after a short wait,
// to exercise the failed-run path (run marked failed, account.lastStatus, the frontend's
// "Pull failed" state) and to prove a failed run never marks existing checkouts returned.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = {
  id: 'test-failure',

  // `config.delayMs` tunes how long it takes to fail (default 1s).
  async scrape({ config }) {
    await sleep(config?.delayMs ?? 1000);
    throw new Error('Simulated scraper failure (test-failure)');
  },
};
