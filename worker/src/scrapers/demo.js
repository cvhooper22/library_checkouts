// Scraper contract — see architecture.md §2. `id` must match `accounts.scraper_type`.
//
// Unlike every other scraper here, this one is never meant to be dispatched
// through the queue for a real job (see adr/0002-demo-mode.md) — it's registered
// so it can be called in-process, synchronously, by worker/scripts/reseed-demo.js
// to regenerate the shared demo household's data on its own schedule, outside BullMQ.
const CATALOG = [
  { title: 'The Left Hand of Darkness', daysFromNow: -3 },
  { title: 'Braiding Sweetgrass', daysFromNow: 2 },
  { title: 'The Warmth of Other Suns', daysFromNow: 6 },
  { title: 'Piranesi', daysFromNow: 14 },
  { title: "A Psalm for the Wild-Built", daysFromNow: -1 },
  { title: 'The Overstory', daysFromNow: 9 },
  { title: 'Klara and the Sun', daysFromNow: 4 },
  { title: 'Pachinko', daysFromNow: 21 },
];

function isoDate(daysFromNow) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

module.exports = {
  id: 'demo',

  // `config.seed` selects which subset of the catalog this account "has checked
  // out" so multiple demo accounts in the same household don't show identical
  // shelves. Everything else about the contract matches a real scraper's output.
  async scrape({ config }) {
    const seed = Number(config?.seed) || 0;
    const count = 3 + (seed % 3); // 3-5 items per account
    const offset = (seed * 3) % CATALOG.length;

    const checkouts = Array.from({ length: count }, (_, i) => {
      const item = CATALOG[(offset + i) % CATALOG.length];
      return {
        externalId: `demo-${seed}-${i}`,
        title: item.title,
        dueDate: isoDate(item.daysFromNow),
        overdue: item.daysFromNow < 0,
        imgSrc: null,
      };
    });

    return { checkouts, errors: [] };
  },
};
