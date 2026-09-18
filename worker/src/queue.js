const IORedis = require('ioredis');

const QUEUE_NAME = 'scrape-jobs';

function createConnection() {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error('REDIS_URL is not set');
  }
  // BullMQ requires this on any connection it owns, or blocking commands can hang.
  return new IORedis(url, { maxRetriesPerRequest: null });
}

module.exports = { QUEUE_NAME, createConnection };
