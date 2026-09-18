// Dev-only harness for exercising one scraper directly — no queue/DB needed.
// Usage: fill in SCRAPER_* vars in worker/.env, then `npm run scrape-local`.
require('dotenv').config();
const { getScraper } = require('../src/scrapers');
const { validateScrapeResult } = require('../src/scrapers/validate');

(async () => {
  const scraper = getScraper(process.env.SCRAPER_TYPE || 'koha');

  const result = await scraper.scrape({
    credentials: {
      username: process.env.SCRAPER_USERNAME,
      pin: process.env.SCRAPER_PIN,
    },
    config: {
      baseUrl: process.env.SCRAPER_BASE_URL,
      headless: process.env.SCRAPER_HEADLESS !== 'false',
      debug: process.env.SCRAPER_DEBUG === 'true',
    },
  });

  validateScrapeResult(result);

  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length > 0) {
    console.error(`\n${result.errors.length} error(s) reported — the real worker would fail this run rather than write it.`);
    process.exitCode = 1;
  }
})();
