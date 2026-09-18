// Scraper contract — see architecture.md §2. `id` must match `accounts.scraper_type`.
module.exports = {
  id: 'bibliocommons',
  async scrape({ credentials, config }) {
    throw new Error('bibliocommons scraper not implemented yet');
  },
};
