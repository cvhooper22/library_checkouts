const { Queue } = require('bullmq');
const prisma = require('@library-tracker/db');
const { QUEUE_NAME, createConnection } = require('./queue');

// Run by the Render Cron Job (Phase 7 of the deployment guide). Enqueues one job
// per account — it never scrapes directly, that stays in the worker.
async function main() {
  const connection = createConnection();
  const queue = new Queue(QUEUE_NAME, { connection });

  // Demo household's account(s) are reseeded directly by reseed-demo.js on their
  // own schedule and must never land on this queue — see adr/0002-demo-mode.md.
  const accounts = await prisma.account.findMany({
    where: { household: { isDemo: false }, deletedAt: null },
    select: { id: true },
  });
  for (const account of accounts) {
    await queue.add('scrape', { accountId: account.id });
  }

  console.log(`[enqueue-daily] enqueued ${accounts.length} job(s)`);

  await queue.close();
  // BullMQ doesn't own this connection (we created it), so it won't close it for us.
  connection.disconnect();
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('[enqueue-daily] failed:', error);
  process.exitCode = 1;
});
