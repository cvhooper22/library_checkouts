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

function getScraper(scraperType) {
  const scraper = REGISTRY[scraperType];
  if (!scraper) {
    throw new Error(`No scraper registered for scraper_type "${scraperType}"`);
  }
  return scraper;
}

module.exports = { REGISTRY, getScraper };
