import { Queue } from 'bullmq';
import config from '../config.js';

export const screenshotQueue = new Queue('screenshots', {
  connection: { url: config.redis.url },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});
