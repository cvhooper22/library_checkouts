const bibliocommons = require('./bibliocommons');
const koha = require('./koha');

// Registry: accounts.scraper_type -> scraper module. Add a new library by adding a
// module here — the worker never branches on library type. See architecture.md §2.
const REGISTRY = {
  [bibliocommons.id]: bibliocommons,
  [koha.id]: koha,
};

function getScraper(scraperType) {
  const scraper = REGISTRY[scraperType];
  if (!scraper) {
    throw new Error(`No scraper registered for scraper_type "${scraperType}"`);
  }
  return scraper;
}

module.exports = { REGISTRY, getScraper };
