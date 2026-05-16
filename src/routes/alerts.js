import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { auth } from '../middleware/auth.js';
import { renderScreenshot } from '../services/renderer.js';
import { saveFile, deleteFile } from '../services/storage.js';
import db from '../db/knex.js';

const router = Router();
router.use(auth);

const createAlertSchema = z.object({
  name: z.string().min(1).max(255),
  url: z.string().url().max(2048),
  width: z.number().int().min(1).max(7680).optional(),
  height: z.number().int().min(1).max(7680).optional(),
  mobile: z.boolean().optional(),
  fullPage: z.boolean().optional(),
  interval_minutes: z.number().int().min(1).max(43200).default(60),
  threshold: z.number().min(0).max(100).default(0),
});

const updateAlertSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  url: z.string().url().max(2048).optional(),
  width: z.number().int().min(1).max(7680).optional(),
  height: z.number().int().min(1).max(7680).optional(),
  mobile: z.boolean().optional(),
  fullPage: z.boolean().optional(),
  interval_minutes: z.number().int().min(1).max(43200).optional(),
  threshold: z.number().min(0).max(100).optional(),
  enabled: z.boolean().optional(),
});

router.get('/alerts', async (req, res) => {
  const alerts = await db('alerts')
    .select('alerts.*', db.raw("(select ar.triggered from alert_runs ar where ar.alert_id = alerts.id order by ar.created_at desc limit 1) as last_triggered"), db.raw("(select ar.error_message from alert_runs ar where ar.alert_id = alerts.id order by ar.created_at desc limit 1) as last_error_message"))
    .where({ user_id: req.apiKey.userId })
    .orderBy('created_at', 'desc');

  res.json({ alerts });
});

router.post('/alerts', async (req, res) => {
  const parsed = createAlertSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'validation_error',
      message: parsed.error.errors.map((e) => e.message).join(', '),
    });
  }

  const { name, url, width, height, mobile, fullPage, interval_minutes, threshold } = parsed.data;
  const options = {};
  if (width !== undefined) options.width = width;
  if (height !== undefined) options.height = height;
  if (mobile !== undefined) options.mobile = mobile;
  if (fullPage !== undefined) options.fullPage = fullPage;

  const [alert] = await db('alerts')
    .insert({
      user_id: req.apiKey.userId,
      name,
      url,
      options: JSON.stringify(options),
      interval_minutes,
      threshold,
    })
    .returning('*');

  const viewportWidth = mobile ? 390 : width || 1280;
  const viewportHeight = mobile ? 844 : height || 720;

  const existingBaseline = await db('screenshots')
    .join('api_keys', 'screenshots.api_key_id', 'api_keys.id')
    .where({
      'api_keys.user_id': req.apiKey.userId,
      'screenshots.url': url,
      'screenshots.is_baseline': true,
    })
    .whereNotNull('screenshots.storage_path')
    .whereRaw("COALESCE((screenshots.options->>'mobile')::boolean, false) = ?", [!!mobile])
    .whereRaw("COALESCE((screenshots.options->>'width')::int, 1280) = ?", [viewportWidth])
    .whereRaw("COALESCE((screenshots.options->>'height')::int, 720) = ?", [viewportHeight])
    .orderBy('screenshots.created_at', 'desc')
    .select('screenshots.id')
    .first();

  let baselineCreated = false;

  if (!existingBaseline) {
    try {
      const result = await renderScreenshot(url, {
        ...options,
        width: viewportWidth,
        height: viewportHeight,
        acceptCookies: true,
      });

      const ext = result.format === 'jpeg' ? 'jpg' : result.format;
      const filename = `${crypto.randomUUID()}.${ext}`;
      const storagePath = await saveFile(filename, result.buffer, req.apiKey.userId);

      const oldBaselines = await db('screenshots')
        .join('api_keys', 'screenshots.api_key_id', 'api_keys.id')
        .where({
          'api_keys.user_id': req.apiKey.userId,
          'screenshots.url': url,
          'screenshots.is_baseline': true,
        })
        .select('screenshots.id', 'screenshots.storage_path');

      for (const b of oldBaselines) {
        if (b.storage_path) await deleteFile(b.storage_path).catch(() => {});
      }
      if (oldBaselines.length > 0) {
        await db('screenshots')
          .whereIn(
            'id',
            oldBaselines.map((b) => b.id),
          )
          .del();
      }

      await db('screenshots').insert({
        api_key_id: req.apiKey.id,
        url,
        options: JSON.stringify(options),
        format: result.format,
        storage_path: storagePath,
        bytes: result.buffer.length,
        status: 'completed',
        is_baseline: true,
        hidden: true,
        completed_at: db.fn.now(),
      });

      baselineCreated = true;
    } catch (err) {
      console.error('Alert baseline creation failed:', err.message);
    }
  }

  res.status(201).json({ alert, baseline_created: baselineCreated, baseline_exists: !!existingBaseline });
});

router.put('/alerts/:id', async (req, res) => {
  const existing = await db('alerts').where({ id: req.params.id, user_id: req.apiKey.userId }).first();

  if (!existing) {
    return res.status(404).json({ error: 'not_found', message: 'Alert not found' });
  }

  const parsed = updateAlertSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'validation_error',
      message: parsed.error.errors.map((e) => e.message).join(', '),
    });
  }

  const updates = { ...parsed.data };
  const existingOpts = typeof existing.options === 'string' ? JSON.parse(existing.options) : existing.options || {};
  const newOpts = { ...existingOpts };
  if (updates.width !== undefined) {
    newOpts.width = updates.width;
    delete updates.width;
  }
  if (updates.height !== undefined) {
    newOpts.height = updates.height;
    delete updates.height;
  }
  if (updates.mobile !== undefined) {
    newOpts.mobile = updates.mobile;
    delete updates.mobile;
  }
  if (updates.fullPage !== undefined) {
    newOpts.fullPage = updates.fullPage;
    delete updates.fullPage;
  }
  updates.options = JSON.stringify(newOpts);

  updates.updated_at = db.fn.now();

  const prevOpts = existingOpts;
  const newUrl = updates.url || existing.url;
  const viewportChanged =
    updates.url !== undefined ||
    newOpts.mobile !== prevOpts.mobile ||
    newOpts.fullPage !== prevOpts.fullPage ||
    newOpts.width !== prevOpts.width ||
    newOpts.height !== prevOpts.height;

  const [alert] = await db('alerts')
    .where({ id: req.params.id, user_id: req.apiKey.userId })
    .update(updates)
    .returning('*');

  if (viewportChanged) {
    const viewportWidth = newOpts.mobile ? 390 : newOpts.width || 1280;
    const viewportHeight = newOpts.mobile ? 844 : newOpts.height || 720;

    const oldBaselines = await db('screenshots')
      .join('api_keys', 'screenshots.api_key_id', 'api_keys.id')
      .where({
        'api_keys.user_id': req.apiKey.userId,
        'screenshots.url': existing.url,
        'screenshots.is_baseline': true,
      })
      .whereRaw("COALESCE((screenshots.options->>'mobile')::boolean, false) = ?", [!!prevOpts.mobile])
      .whereRaw("COALESCE((screenshots.options->>'width')::int, 1280) = ?", [
        prevOpts.mobile ? 390 : prevOpts.width || 1280,
      ])
      .whereRaw("COALESCE((screenshots.options->>'height')::int, 720) = ?", [
        prevOpts.mobile ? 844 : prevOpts.height || 720,
      ])
      .select('screenshots.id', 'screenshots.storage_path');

    for (const b of oldBaselines) {
      if (b.storage_path) await deleteFile(b.storage_path).catch(() => {});
    }
    if (oldBaselines.length > 0) {
      await db('screenshots')
        .whereIn(
          'id',
          oldBaselines.map((b) => b.id),
        )
        .del();
    }

    try {
      const result = await renderScreenshot(newUrl, {
        ...newOpts,
        width: viewportWidth,
        height: viewportHeight,
        acceptCookies: true,
      });

      const ext = result.format === 'jpeg' ? 'jpg' : result.format;
      const filename = `${crypto.randomUUID()}.${ext}`;
      const storagePath = await saveFile(filename, result.buffer, req.apiKey.userId);

      await db('screenshots').insert({
        api_key_id: req.apiKey.id,
        url: newUrl,
        options: JSON.stringify(newOpts),
        format: result.format,
        storage_path: storagePath,
        bytes: result.buffer.length,
        status: 'completed',
        is_baseline: true,
        hidden: true,
        completed_at: db.fn.now(),
      });
    } catch (err) {
      console.error('Alert baseline update failed:', err.message);
    }
  }

  res.json({ alert });
});

router.delete('/alerts/:id', async (req, res) => {
  const alert = await db('alerts').where({ id: req.params.id, user_id: req.apiKey.userId }).first();

  if (!alert) {
    return res.status(404).json({ error: 'not_found', message: 'Alert not found' });
  }

  const opts = typeof alert.options === 'string' ? JSON.parse(alert.options) : alert.options || {};
  const viewportWidth = opts.mobile ? 390 : opts.width || 1280;
  const viewportHeight = opts.mobile ? 844 : opts.height || 720;

  const runScreenshots = await db('alert_runs')
    .where({ alert_id: alert.id })
    .whereNotNull('screenshot_id')
    .select('screenshot_id');

  const screenshotIds = runScreenshots.map((r) => r.screenshot_id);

  const baseline = await db('screenshots')
    .join('api_keys', 'screenshots.api_key_id', 'api_keys.id')
    .where({
      'api_keys.user_id': req.apiKey.userId,
      'screenshots.url': alert.url,
      'screenshots.is_baseline': true,
    })
    .whereRaw("COALESCE((screenshots.options->>'mobile')::boolean, false) = ?", [!!opts.mobile])
    .whereRaw("COALESCE((screenshots.options->>'width')::int, 1280) = ?", [viewportWidth])
    .whereRaw("COALESCE((screenshots.options->>'height')::int, 720) = ?", [viewportHeight])
    .select('screenshots.id')
    .first();

  if (baseline) screenshotIds.push(baseline.id);

  if (screenshotIds.length > 0) {
    const screenshots = await db('screenshots')
      .whereIn('id', screenshotIds)
      .select('id', 'storage_path', 'diff_storage_path');

    for (const s of screenshots) {
      if (s.storage_path) await deleteFile(s.storage_path).catch(() => {});
      if (s.diff_storage_path) await deleteFile(s.diff_storage_path).catch(() => {});
    }

    await db('screenshots').whereIn('id', screenshotIds).del();
  }

  await db('alerts').where({ id: alert.id }).del();

  res.json({ deleted: true, screenshots_removed: screenshotIds.length });
});

router.get('/alerts/:id/runs', async (req, res) => {
  const alert = await db('alerts').where({ id: req.params.id, user_id: req.apiKey.userId }).select('id').first();

  if (!alert) {
    return res.status(404).json({ error: 'not_found', message: 'Alert not found' });
  }

  const runs = await db('alert_runs').where({ alert_id: req.params.id }).orderBy('created_at', 'desc').limit(50);

  res.json({ runs });
});

router.post('/alerts/:id/runs/:runId/set-baseline', async (req, res) => {
  const alert = await db('alerts').where({ id: req.params.id, user_id: req.apiKey.userId }).select('id', 'url').first();

  if (!alert) {
    return res.status(404).json({ error: 'not_found', message: 'Alert not found' });
  }

  const run = await db('alert_runs').where({ id: req.params.runId, alert_id: req.params.id }).select('*').first();

  if (!run) {
    return res.status(404).json({ error: 'not_found', message: 'Run not found' });
  }

  if (!run.screenshot_id) {
    return res.status(400).json({ error: 'no_screenshot', message: 'This run has no screenshot to promote' });
  }

  const screenshot = await db('screenshots').where({ id: run.screenshot_id }).select('*').first();

  if (!screenshot) {
    return res.status(404).json({ error: 'not_found', message: 'Screenshot not found' });
  }

  const opts = typeof screenshot.options === 'string' ? JSON.parse(screenshot.options) : screenshot.options || {};
  const viewportWidth = opts.mobile ? 390 : opts.width || 1280;
  const viewportHeight = opts.mobile ? 844 : opts.height || 720;

  const oldBaselines = await db('screenshots')
    .join('api_keys', 'screenshots.api_key_id', 'api_keys.id')
    .where({
      'api_keys.user_id': req.apiKey.userId,
      'screenshots.url': screenshot.url,
      'screenshots.is_baseline': true,
    })
    .whereRaw("COALESCE((screenshots.options->>'mobile')::boolean, false) = ?", [!!opts.mobile])
    .whereRaw("COALESCE((screenshots.options->>'width')::int, 1280) = ?", [viewportWidth])
    .whereRaw("COALESCE((screenshots.options->>'height')::int, 720) = ?", [viewportHeight])
    .select('screenshots.id', 'screenshots.storage_path');

  for (const b of oldBaselines) {
    if (b.storage_path) await deleteFile(b.storage_path).catch(() => {});
  }
  if (oldBaselines.length > 0) {
    await db('screenshots')
      .whereIn(
        'id',
        oldBaselines.map((b) => b.id),
      )
      .del();
  }

  await db('screenshots').where({ id: run.screenshot_id }).update({ is_baseline: true, hidden: true });

  const priorRuns = await db('alert_runs')
    .where('alert_id', req.params.id)
    .where('created_at', '<=', run.created_at)
    .whereNotNull('screenshot_id')
    .select('id', 'screenshot_id');

  const priorScreenshotIds = [];
  const priorRunIds = [];
  for (const pr of priorRuns) {
    if (pr.screenshot_id && pr.screenshot_id !== run.screenshot_id) {
      priorScreenshotIds.push(pr.screenshot_id);
      priorRunIds.push(pr.id);
    }
  }

  if (priorScreenshotIds.length > 0) {
    const priorScreenshots = await db('screenshots').whereIn('id', priorScreenshotIds).select('id', 'storage_path');

    for (const ps of priorScreenshots) {
      if (ps.storage_path) await deleteFile(ps.storage_path).catch(() => {});
    }

    await db('screenshots').whereIn('id', priorScreenshotIds).del();
    await db('alert_runs').whereIn('id', priorRunIds).update({ screenshot_id: null });
  }

  res.json({ message: 'Baseline updated from run', screenshot_id: run.screenshot_id });
});

export default router;
