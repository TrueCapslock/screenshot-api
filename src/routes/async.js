import { Router } from 'express';
import { z } from 'zod';
import { screenshotQueue } from '../jobs/screenshot.js';
import { auth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import db from '../db/knex.js';
import config from '../config.js';

const router = Router();

router.use(auth, rateLimit);

const asyncScreenshotSchema = z.object({
  url: z.string().url().max(2048),
  webhookUrl: z.string().url().max(2048).optional(),
  width: z.number().int().min(1).max(7680).optional(),
  height: z.number().int().min(1).max(7680).optional(),
  format: z.enum(['png', 'jpeg', 'webp']).optional(),
  quality: z.number().int().min(1).max(100).optional(),
  fullPage: z.boolean().optional(),
  delay: z.number().int().min(0).max(60_000).optional(),
  selector: z.string().max(512).optional(),
  blockAds: z.boolean().optional(),
  darkMode: z.boolean().optional(),
  mobile: z.boolean().optional(),
  timeout: z.number().int().min(1).max(120).optional(),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
  waitForSelector: z.string().max(512).optional(),
  scrollToBottom: z.boolean().optional(),
});

router.post('/screenshot/async', async (req, res) => {
  const parsed = asyncScreenshotSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'validation_error',
      message: parsed.error.errors.map((e) => e.message).join(', '),
    });
  }

  const options = parsed.data;

  if (!req.isAdmin) {
    const tierLimits = config.tiers[req.tier] || config.tiers.free;

    const monthlyCount = await db('usage_logs')
      .join('api_keys', 'usage_logs.api_key_id', 'api_keys.id')
      .where({ 'api_keys.user_id': req.apiKey.userId })
      .where('usage_logs.created_at', '>=', db.raw("now() - interval '30 days'"))
      .count('* as count')
      .first();

    if (parseInt((monthlyCount?.count || '0').toString(), 10) >= tierLimits.monthlyLimit) {
      return res.status(429).json({
        error: 'monthly_limit_exceeded',
        message: `Monthly limit of ${tierLimits.monthlyLimit} screenshots exceeded for ${req.tier} tier`,
      });
    }
  }

  const [screenshot] = await db('screenshots')
    .insert({
      api_key_id: req.apiKey.id,
      url: options.url,
      options: JSON.stringify(options),
      format: options.format || 'png',
      status: 'pending',
    })
    .returning('*');

  await screenshotQueue.add('render', {
    type: 'url',
    options,
    apiKeyId: req.apiKey.id,
    screenshotId: screenshot.id,
    webhookUrl: options.webhookUrl,
  });

  res.status(202).json({
    job_id: screenshot.id,
    status: 'pending',
    url: `${config.baseUrl}/v1/screenshot/${screenshot.id}`,
  });
});

router.get('/screenshot/:id', async (req, res) => {
  const screenshot = await db('screenshots').where({ id: req.params.id, api_key_id: req.apiKey.id }).first();

  if (!screenshot) {
    return res.status(404).json({ error: 'not_found', message: 'Screenshot not found' });
  }

  if (screenshot.status === 'pending' || screenshot.status === 'processing') {
    return res.json({ status: screenshot.status, job_id: screenshot.id });
  }

  if (screenshot.status === 'failed') {
    return res.json({ status: 'failed', job_id: screenshot.id });
  }

  if (screenshot.status === 'completed') {
    const { readFile } = await import('../services/storage.js');
    const buffer = await readFile(screenshot.storage_path);
    const contentType =
      screenshot.format === 'jpeg' ? 'image/jpeg' : screenshot.format === 'webp' ? 'image/webp' : 'image/png';

    res.set('Content-Type', contentType);
    res.set('X-Screenshot-Id', screenshot.id);
    return res.status(200).send(buffer);
  }

  res.json({ status: screenshot.status, job_id: screenshot.id });
});

router.post('/screenshot/:id/retry', async (req, res) => {
  const screenshot = await db('screenshots')
    .where({ id: req.params.id, api_key_id: req.apiKey.id, status: 'failed' })
    .select('id', 'url', 'options')
    .first();

  if (!screenshot) {
    return res.status(404).json({ error: 'not_found', message: 'Failed screenshot not found' });
  }

  const opts = typeof screenshot.options === 'string' ? JSON.parse(screenshot.options) : screenshot.options || {};

  const [newScreenshot] = await db('screenshots')
    .insert({
      api_key_id: req.apiKey.id,
      url: screenshot.url,
      options: JSON.stringify(opts),
      format: opts.format || 'png',
      status: 'pending',
    })
    .returning('*');

  await screenshotQueue.add('render', {
    type: 'url',
    options: opts,
    apiKeyId: req.apiKey.id,
    screenshotId: newScreenshot.id,
    webhookUrl: opts.webhookUrl,
  });

  res.status(202).json({
    job_id: newScreenshot.id,
    status: 'pending',
    url: `${config.baseUrl}/v1/screenshot/${newScreenshot.id}`,
  });
});

export default router;
