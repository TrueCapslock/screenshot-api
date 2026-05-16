import { Queue } from 'bullmq';
import config from '../config.js';

export const alertCheckQueue = new Queue('alert-checks', {
  connection: { url: config.redis.url },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});
