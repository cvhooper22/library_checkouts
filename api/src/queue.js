const { Queue } = require('bullmq');
const IORedis = require('ioredis');

// Producer side of the queue worker/src/queue.js consumes. Mirrors its
// connection settings; this package never touches the queue's consumer half.
const QUEUE_NAME = 'scrape-jobs';
let queue;

function getQueue() {
  if (!queue) {
    const url = process.env.REDIS_URL;
    if (!url) {
      throw new Error('REDIS_URL is not set');
    }
    const connection = new IORedis(url, { maxRetriesPerRequest: null });
    queue = new Queue(QUEUE_NAME, { connection });
  }
  return queue;
}

module.exports = { getQueue };
