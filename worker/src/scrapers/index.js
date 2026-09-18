const bibliocommons = require('./bibliocommons');
const koha = require('./koha');
const demo = require('./demo');

// Registry: accounts.scraper_type -> scraper module. Add a new library by adding a
// module here — the worker never branches on library type. See architecture.md §2.
//
// `demo` is registered here like any other scraper (so scrape-local.js and the
// validate.js contract check both apply to it), but the worker/queue never
// dispatches a job for it in practice — see adr/0002-demo-mode.md. It's only
// ever called in-process by worker/scripts/reseed-demo.js.
const REGISTRY = {
  [bibliocommons.id]: bibliocommons,
  [koha.id]: koha,
  [demo.id]: demo,
};

// Local-only fixtures for exercising the queue → worker → frontend path (see
// worker/scripts/seed-test-fixtures.js). Not registered in production, where a stray
// `test-*` account would fail with "No scraper registered" instead of running.
if (process.env.NODE_ENV !== 'production') {
  const testScrapers = [
    require('./test-success'),
    require('./test-failure'),
    require('./test-partial-errors'),
    require('./test-empty'),
    require('./test-hang'),
  ];
  for (const scraper of testScrapers) {
    REGISTRY[scraper.id] = scraper;
  }
}

function getScraper(scraperType) {
  const scraper = REGISTRY[scraperType];
  if (!scraper) {
    throw new Error(`No scraper registered for scraper_type "${scraperType}"`);
  }
  return scraper;
}

module.exports = { REGISTRY, getScraper };
