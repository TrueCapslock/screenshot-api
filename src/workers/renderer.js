import { Worker } from 'bullmq';
import { renderScreenshot, renderHtml } from '../services/renderer.js';
import { saveFile } from '../services/storage.js';
import db from '../db/knex.js';
import config from '../config.js';
import crypto from 'crypto';

async function processJob(job) {
  const { type, options, apiKeyId: _apiKeyId, screenshotId, userId } = job.data;

  let result;
  if (type === 'html') {
    result = await renderHtml(options.html, options);
  } else {
    result = await renderScreenshot(options.url, options);
  }

  const ext = result.format === 'jpeg' ? 'jpg' : result.format;
  const filename = `${crypto.randomUUID()}.${ext}`;
  const storagePath = await saveFile(filename, result.buffer, userId);

  await db('screenshots').where({ id: screenshotId }).update({
    storage_path: storagePath,
    bytes: result.buffer.length,
    format: result.format,
    status: 'completed',
    completed_at: db.fn.now(),
  });

  return { screenshotId, bytes: result.buffer.length, format: result.format, durationMs: result.durationMs };
}

const worker = new Worker('screenshots', processJob, {
  connection: { url: config.redis.url },
  concurrency: 5,
});

worker.on('completed', (job) => {
  console.log(`Job ${job.id} completed — screenshot ${job.returnvalue.screenshotId}`);
});

worker.on('failed', async (job, err) => {
  console.error(`Job ${job.id} failed:`, err.message);
  if (job?.data?.screenshotId) {
    await db('screenshots').where({ id: job.data.screenshotId }).update({ status: 'failed' });
  }
});

worker.on('error', (err) => {
  console.error('Worker error:', err);
});

console.log('Screenshot worker started');
