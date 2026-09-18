const bcrypt = require('bcryptjs');
const prisma = require('../index');

const DEV_EMAIL = 'dev@example.com';
const DEV_PASSWORD = 'devpassword123';
const BCRYPT_ROUNDS = 12;

// Baseline reference data for local dev: one user/household to log in as via
// POST /auth/login, and one `libraries` row per registered scraper (worker/src/
// scrapers/index.js) so POST /households/:id/accounts has a real libraryId to
// point at without needing production library data.
async function main() {
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, BCRYPT_ROUNDS);

  const user = await prisma.user.upsert({
    where: { email: DEV_EMAIL },
    update: {},
    create: { email: DEV_EMAIL, passwordHash },
  });

  const household = await prisma.household.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Dev Household',
      ownerUserId: user.id,
      members: {
        connectOrCreate: {
          where: { householdId_userId: { householdId: '00000000-0000-0000-0000-000000000001', userId: user.id } },
          create: { userId: user.id, role: 'owner' },
        },
      },
    },
  });

  const libraries = [
    { id: '00000000-0000-0000-0000-000000000010', name: 'Demo Koha Library', baseUrl: 'https://demo.koha-library.example', scraperTypeDefault: 'koha' },
    { id: '00000000-0000-0000-0000-000000000011', name: 'Demo BiblioCommons Library', baseUrl: 'https://demo.bibliocommons.example', scraperTypeDefault: 'bibliocommons' },
  ];
  for (const library of libraries) {
    await prisma.library.upsert({ where: { id: library.id }, update: {}, create: library });
  }

  console.log('Seeded:');
  console.log(`  user:      ${user.email} / ${DEV_PASSWORD}`);
  console.log(`  household: ${household.name} (${household.id})`);
  console.log(`  libraries: ${libraries.map((l) => l.name).join(', ')}`);
}

main()
  .catch((error) => {
    console.error('[seed] failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
