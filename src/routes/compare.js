import { Router } from 'express';
import { z } from 'zod';
import pixelmatch from 'pixelmatch';
import sharp from 'sharp';
import { renderScreenshot } from '../services/renderer.js';
import { saveFile, readFile } from '../services/storage.js';
import { auth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { logUsage } from '../middleware/usage.js';
import db from '../db/knex.js';
import crypto from 'crypto';
import config from '../config.js';

const router = Router();

const compareSchema = z.object({
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
});

router.post('/compare', auth, rateLimit, logUsage, async (req, res) => {
  if (!req.isAdmin && req.tier !== 'pro' && req.tier !== 'business') {
    return res
      .status(403)
      .json({ error: 'forbidden', message: 'Comparison is only available on Pro and Business tiers' });
  }

  const parsed = compareSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'validation_error',
      message: parsed.error.errors.map((e) => e.message).join(', '),
    });
  }

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

  try {
    const options = parsed.data;
    const viewportWidth = options.mobile ? 390 : options.width || 1280;
    const viewportHeight = options.mobile ? 844 : options.height || 720;

    const baseline = await db('screenshots')
      .join('api_keys', 'screenshots.api_key_id', 'api_keys.id')
      .where({
        'api_keys.user_id': req.apiKey.userId,
        'screenshots.url': options.url,
        'screenshots.is_baseline': true,
      })
      .whereNotNull('screenshots.storage_path')
      .orderBy('screenshots.created_at', 'desc')
      .select('screenshots.id', 'screenshots.storage_path')
      .first();

    if (!baseline) {
      return res.status(404).json({
        error: 'no_baseline',
        message: 'No baseline screenshot found for this URL. Take a screenshot with baseline:true first.',
      });
    }

    const result = await renderScreenshot(options.url, {
      ...options,
      width: viewportWidth,
      height: viewportHeight,
    });

    const ext = result.format === 'jpeg' ? 'jpg' : result.format;
    const screenshotFilename = `${crypto.randomUUID()}.${ext}`;
    const screenshotPath = await saveFile(screenshotFilename, result.buffer);

    const baselineBuffer = await readFile(baseline.storage_path);
    const [baselineMeta, currentMeta] = await Promise.all([
      sharp(baselineBuffer).metadata(),
      sharp(result.buffer).metadata(),
    ]);

    const width = Math.max(baselineMeta.width, currentMeta.width);
    const height = Math.min(baselineMeta.height, currentMeta.height);

    const [baselineRgba, currentRgba] = await Promise.all([
      sharp(baselineBuffer).resize(width, height, { fit: 'cover', position: 'top' }).ensureAlpha().raw().toBuffer(),
      sharp(result.buffer).resize(width, height, { fit: 'cover', position: 'top' }).ensureAlpha().raw().toBuffer(),
    ]);

    const diffRgba = new Uint8Array(width * height * 4);

    let mismatched;
    try {
      mismatched = pixelmatch(baselineRgba, currentRgba, diffRgba, width, height, {
        threshold: 0.1,
        includeAA: false,
        alpha: 0.5,
        diffColor: [255, 0, 0],
      });
    } catch (pErr) {
      console.error('pixelmatch error:', pErr.message);
      console.error('  baselineRgba length:', baselineRgba.length);
      console.error('  currentRgba length:', currentRgba.length);
      console.error('  diffRgba length:', diffRgba.length);
      console.error('  width:', width, 'height:', height, 'expected:', width * height * 4);
      console.error('  baselineMeta:', baselineMeta, 'currentMeta:', currentMeta);
      throw pErr;
    }

    const totalPixels = width * height;
    const diffPercentage = Math.round((mismatched / totalPixels) * 10000) / 100;

    const diffPng = await sharp(diffRgba, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer();

    const diffFilename = `diff_${crypto.randomUUID()}.png`;
    const diffPath = await saveFile(diffFilename, diffPng);

    const [screenshot] = await db('screenshots')
      .insert({
        api_key_id: req.apiKey.id,
        url: options.url,
        options: JSON.stringify(options),
        format: result.format,
        storage_path: screenshotPath,
        bytes: result.buffer.length,
        status: 'completed',
        completed_at: db.fn.now(),
        baseline_id: baseline.id,
        diff_percentage: diffPercentage,
        diff_storage_path: diffPath,
      })
      .returning('id');

    res.json({
      screenshot_id: screenshot.id,
      baseline_id: baseline.id,
      diff_percentage: diffPercentage,
      diff_pixels: mismatched,
      total_pixels: totalPixels,
      diff_image_url: `${config.baseUrl}/v1/screenshot/${screenshot.id}/diff`,
      duration_ms: result.durationMs,
    });
  } catch (err) {
    console.error('Compare error:', err);
    res.status(502).json({ error: 'compare_failed', message: err.message });
  }
});

router.get('/screenshot/:id/baseline', auth, async (req, res) => {
  const screenshot = await db('screenshots')
    .join('api_keys', 'screenshots.api_key_id', 'api_keys.id')
    .where({ 'screenshots.id': req.params.id, 'api_keys.user_id': req.apiKey.userId })
    .select('screenshots.url')
    .first();

  if (!screenshot) {
    return res.status(404).json({ error: 'not_found', message: 'Screenshot not found' });
  }

  const baseline = await db('screenshots')
    .join('api_keys', 'screenshots.api_key_id', 'api_keys.id')
    .where({
      'api_keys.user_id': req.apiKey.userId,
      'screenshots.url': screenshot.url,
      'screenshots.is_baseline': true,
    })
    .whereNotNull('screenshots.storage_path')
    .orderBy('screenshots.created_at', 'desc')
    .select('screenshots.storage_path', 'screenshots.format')
    .first();

  if (!baseline) {
    return res.status(200).json({ exists: false });
  }

  try {
    const buf = await readFile(baseline.storage_path);
    const contentType =
      baseline.format === 'jpeg' ? 'image/jpeg' : baseline.format === 'webp' ? 'image/webp' : 'image/png';
    res.set('Content-Type', contentType);
    res.set('X-Baseline-Exists', 'true');
    res.status(200).send(buf);
  } catch {
    return res.status(200).json({ exists: false });
  }
});

router.get('/screenshot/:id/diff', auth, async (req, res) => {
  const screenshot = await db('screenshots')
    .join('api_keys', 'screenshots.api_key_id', 'api_keys.id')
    .where({ 'screenshots.id': req.params.id, 'api_keys.user_id': req.apiKey.userId })
    .select('screenshots.diff_storage_path')
    .first();

  if (!screenshot || !screenshot.diff_storage_path) {
    return res.status(200).json({ exists: false });
  }

  try {
    const buf = await readFile(screenshot.diff_storage_path);
    res.set('Content-Type', 'image/png');
    res.set('X-Diff-Exists', 'true');
    res.status(200).send(buf);
  } catch {
    return res.status(200).json({ exists: false });
  }
});

export default router;
