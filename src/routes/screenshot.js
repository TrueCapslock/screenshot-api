import { Router } from 'express';
import { z } from 'zod';
import { renderScreenshot, renderHtml } from '../services/renderer.js';
import { saveFile } from '../services/storage.js';
import { getCached, setCache } from '../services/cache.js';
import { auth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { logUsage } from '../middleware/usage.js';
import db from '../db/knex.js';
import crypto from 'crypto';
import config from '../config.js';

const router = Router();

router.use(auth, rateLimit);

function unmarkExistingBaselines(userId, url, options) {
  const viewportWidth = options.mobile ? 390 : options.width || 1280;
  const viewportHeight = options.mobile ? 844 : options.height || 720;
  return db('screenshots')
    .whereIn('api_key_id', db('api_keys').select('id').where('user_id', userId))
    .where({ url, is_baseline: true })
    .whereRaw("(options->>'mobile')::boolean = ?", [!!options.mobile])
    .whereRaw("COALESCE((options->>'width')::int, 1280) = ?", [viewportWidth])
    .whereRaw("COALESCE((options->>'height')::int, 720) = ?", [viewportHeight])
    .update({ is_baseline: false });
}

const screenshotSchema = z.object({
  url: z.string().url().max(2048),
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
  acceptCookies: z.union([z.boolean(), z.string().max(512)]).optional(),
  scale: z.number().int().min(1).max(3).optional(),
  cache: z.boolean().optional(),
  baseline: z.boolean().optional(),
});

router.post('/screenshot', logUsage, async (req, res) => {
  const parsed = screenshotSchema.safeParse(req.body);
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

  if (options.cache) {
    const cached = await getCached(options.url, options);
    if (cached) {
      const ct = options.format === 'jpeg' ? 'image/jpeg' : options.format === 'webp' ? 'image/webp' : 'image/png';
      res.set('Content-Type', ct);
      res.set('X-Cache', 'HIT');
      return res.status(200).send(cached);
    }
  }

  try {
    const viewportWidth = options.mobile ? 390 : options.width || 1280;
    const viewportHeight = options.mobile ? 844 : options.height || 720;

    const result = await renderScreenshot(options.url, {
      ...options,
      width: viewportWidth,
      height: viewportHeight,
    });

    const ext = result.format === 'jpeg' ? 'jpg' : result.format;
    const filename = `${crypto.randomUUID()}.${ext}`;
    const storagePath = await saveFile(filename, result.buffer);

    if (options.baseline) {
      await unmarkExistingBaselines(req.apiKey.userId, options.url, options);
    }

    const [screenshot] = await db('screenshots')
      .insert({
        api_key_id: req.apiKey.id,
        url: options.url,
        options: JSON.stringify(options),
        format: result.format,
        storage_path: storagePath,
        bytes: result.buffer.length,
        status: 'completed',
        is_baseline: options.baseline || false,
        completed_at: db.fn.now(),
      })
      .returning('id');

    if (options.cache) {
      await setCache(options.url, options, result.buffer);
    }

    const contentType = result.format === 'jpeg' ? 'image/jpeg' : result.format === 'webp' ? 'image/webp' : 'image/png';

    res.set('Content-Type', contentType);
    res.set('X-Screenshot-Id', screenshot.id);
    res.set('X-Duration-Ms', String(result.durationMs));
    res.set('X-Cache', 'MISS');
    if (options.baseline) res.set('X-Baseline', 'true');
    res.status(200).send(result.buffer);
  } catch (err) {
    console.error('Screenshot error:', err);
    res.status(502).json({
      error: 'render_failed',
      message: `Failed to render URL: ${err.message}`,
    });
  }
});

const htmlSchema = z.object({
  html: z.string().min(1).max(1_000_000),
  width: z.number().int().min(1).max(7680).optional(),
  height: z.number().int().min(1).max(7680).optional(),
  format: z.enum(['png', 'jpeg', 'webp']).optional(),
  quality: z.number().int().min(1).max(100).optional(),
  fullPage: z.boolean().optional(),
  delay: z.number().int().min(0).max(60_000).optional(),
});

router.post('/html', logUsage, async (req, res) => {
  const parsed = htmlSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'validation_error',
      message: parsed.error.errors.map((e) => e.message).join(', '),
    });
  }

  const options = parsed.data;

  try {
    const result = await renderHtml(options.html, options);

    const ext = result.format === 'jpeg' ? 'jpg' : result.format;
    const filename = `${crypto.randomUUID()}.${ext}`;
    const storagePath = await saveFile(filename, result.buffer);

    const [screenshot] = await db('screenshots')
      .insert({
        api_key_id: req.apiKey.id,
        url: 'html://inline',
        options: JSON.stringify(options),
        format: result.format,
        storage_path: storagePath,
        bytes: result.buffer.length,
        status: 'completed',
        completed_at: db.fn.now(),
      })
      .returning('id');

    const contentType = result.format === 'jpeg' ? 'image/jpeg' : result.format === 'webp' ? 'image/webp' : 'image/png';

    res.set('Content-Type', contentType);
    res.set('X-Screenshot-Id', screenshot.id);
    res.status(200).send(result.buffer);
  } catch (err) {
    console.error('HTML render error:', err);
    res.status(502).json({
      error: 'render_failed',
      message: `Failed to render HTML: ${err.message}`,
    });
  }
});

router.post('/screenshot/:id/baseline', async (req, res) => {
  const screenshot = await db('screenshots')
    .join('api_keys', 'screenshots.api_key_id', 'api_keys.id')
    .where({ 'screenshots.id': req.params.id, 'api_keys.user_id': req.apiKey.userId })
    .select('screenshots.id', 'screenshots.url', 'screenshots.options')
    .first();

  if (!screenshot) {
    return res.status(404).json({ error: 'not_found', message: 'Screenshot not found' });
  }

  const opts = typeof screenshot.options === 'string' ? JSON.parse(screenshot.options) : screenshot.options || {};
  await unmarkExistingBaselines(req.apiKey.userId, screenshot.url, opts);
  await db('screenshots').where({ id: screenshot.id }).update({ is_baseline: true });
  res.json({ message: 'Baseline set', id: screenshot.id });
});

export default router;
