const Ajv = require('ajv');

const ajv = new Ajv({ allErrors: true });

// Mirrors the scraper contract in architecture.md §2.
const scrapeResultSchema = {
  type: 'object',
  required: ['checkouts', 'errors'],
  additionalProperties: false,
  properties: {
    checkouts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['externalId', 'title', 'dueDate', 'overdue'],
        additionalProperties: true,
        properties: {
          externalId: { type: 'string', minLength: 1 },
          title: { type: 'string', minLength: 1 },
          dueDate: { type: 'string', minLength: 1 },
          overdue: { type: 'boolean' },
          imgSrc: { type: ['string', 'null'] },
        },
      },
    },
    errors: {
      type: 'array',
      items: { type: 'string' },
    },
  },
};

const validate = ajv.compile(scrapeResultSchema);

// Throws if a scraper's return value doesn't match the shared contract, so a broken
// scrape fails loudly instead of corrupting `checkouts` — see architecture.md §7.
function validateScrapeResult(result) {
  if (!validate(result)) {
    throw new Error(`Scraper returned an invalid shape: ${ajv.errorsText(validate.errors, { separator: '; ' })}`);
  }
  return result;
}

module.exports = { validateScrapeResult };
