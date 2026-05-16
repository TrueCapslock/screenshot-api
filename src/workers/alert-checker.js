import { Worker } from 'bullmq';
import config from '../config.js';
import { processAlert } from '../alert-checker.js';

const worker = new Worker('alert-checks', async (job) => {
  await processAlert(job.data.alert, job.data.baseline);
  return { alertId: job.data.alert.id };
}, {
  connection: { url: config.redis.url },
  concurrency: 5,
});

worker.on('completed', (job) => {
  console.log(`Alert check ${job.id} completed — alert ${job.returnvalue.alertId}`);
});

worker.on('failed', async (job, err) => {
  console.error(`Alert check ${job.id} failed:`, err.message);
});

worker.on('error', (err) => {
  console.error('Alert checker worker error:', err);
});

console.log('Alert checker worker started');
