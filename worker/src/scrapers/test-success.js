// Dev-only scraper — see worker/scripts/seed-test-fixtures.js. Unlike `demo`, this one runs
// through the real queue → worker path, so it exercises on-demand refresh end to end without
// a live library. It ignores credentials and always succeeds.
//
// Each pull picks a random subset of a fixed pool. Items keep the same externalId and due date
// across pulls, so consecutive pulls overlap the way a real account does: some checkouts carry
// over, some are gone (marked returned), some are new.
const POOL = [
  'The Left Hand of Darkness',
  'Braiding Sweetgrass',
  'The Warmth of Other Suns',
  'Piranesi',
  'A Psalm for the Wild-Built',
  'The Overstory',
  'Klara and the Sun',
  'Pachinko',
  'Station Eleven',
  'The Dispossessed',
  'Hyperion',
  'Circe',
  'The Fifth Season',
  'Exhalation',
  'Convenience Store Woman',
  'Sea of Tranquility',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomBetween = (min, max) => min + Math.random() * (max - min);

function isoDate(daysFromNow) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

module.exports = {
  id: 'test-success',

  // `config.minDelayMs` / `config.maxDelayMs` tune the simulated scrape time (default 1-5s).
  async scrape({ config }) {
    const minMs = config?.minDelayMs ?? 1000;
    const maxMs = config?.maxDelayMs ?? 5000;
    await sleep(randomBetween(minMs, maxMs));

    const count = 2 + Math.floor(Math.random() * 7); // 2-8 checkouts
    const picked = [...POOL.keys()].sort(() => Math.random() - 0.5).slice(0, count);

    const checkouts = picked.map((i) => {
      const daysFromNow = ((i * 7) % 30) - 6; // -6..23, fixed per item; the negatives are overdue
      return {
        externalId: `test-success-${i}`,
        title: POOL[i],
        dueDate: isoDate(daysFromNow),
        overdue: daysFromNow < 0,
        imgSrc: null,
      };
    });

    return { checkouts, errors: [] };
  },
};
