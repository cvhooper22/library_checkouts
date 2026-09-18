// Dev-only scraper — see worker/scripts/seed-test-fixtures.js. Succeeds with nothing checked
// out. A trustworthy empty result is how a real account returns its last book, so this marks
// every current checkout returned and exercises the "Nothing checked out" state (plus the
// card's tab disappearing, since tabs come from checkouts). Re-seed with --reset to get the
// checkouts back.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = {
  id: 'test-empty',

  // `config.delayMs` tunes the simulated scrape time (default 1s).
  async scrape({ config }) {
    await sleep(config?.delayMs ?? 1000);
    return { checkouts: [], errors: [] };
  },
};
