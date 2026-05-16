import db from './db/knex.js';
import crypto from 'crypto';
import sharp from 'sharp';
import pixelmatch from 'pixelmatch';
import { renderScreenshot } from './services/renderer.js';
import { saveFile, readFile } from './services/storage.js';
import { sendAlertNotification } from './services/email.js';
import { alertCheckQueue } from './jobs/alert-check.js';

let intervalHandle = null;

async function pingUrl(url, timeout = 10000) {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(url, { method: 'HEAD', signal: controller.signal });
    clearTimeout(id);
    return { ok: response.ok, status: response.status };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
}

async function handlePingFailure(alert, errorMessage) {
  const [updated] = await db('alerts')
    .where({ id: alert.id })
    .increment('consecutive_failures', 1)
    .returning('consecutive_failures');

  const consecutiveFailures = updated?.consecutive_failures ?? 1;

  if (consecutiveFailures >= 5) {
    await db('alerts').where({ id: alert.id }).update({ enabled: false });
    await db('alert_runs').insert({
      alert_id: alert.id,
      triggered: true,
      diff_percentage: null,
      threshold: alert.threshold,
      screenshot_id: null,
      error_message: errorMessage,
    });
    console.log(
      `Alert ${alert.id}: disabled after ${consecutiveFailures} consecutive failures — ${errorMessage}`,
    );
  } else {
    console.log(
      `Alert ${alert.id}: ${errorMessage} — consecutive failure ${consecutiveFailures}/5`,
    );
  }
}

async function findBaseline(alert, opts, viewportWidth, viewportHeight) {
  return db('screenshots')
    .join('api_keys', 'screenshots.api_key_id', 'api_keys.id')
    .join('users', 'api_keys.user_id', 'users.id')
    .where({
      'users.id': alert.user_id,
      'screenshots.url': alert.url,
      'screenshots.is_baseline': true,
    })
    .whereNotNull('screenshots.storage_path')
    .whereRaw("COALESCE((screenshots.options->>'mobile')::boolean, false) = ?", [!!opts.mobile])
    .whereRaw("COALESCE((screenshots.options->>'width')::int, 1280) = ?", [viewportWidth])
    .whereRaw("COALESCE((screenshots.options->>'height')::int, 720) = ?", [viewportHeight])
    .orderBy('screenshots.created_at', 'desc')
    .select('screenshots.id', 'screenshots.storage_path')
    .first();
}

async function createBaseline(alert, opts, viewportWidth, viewportHeight) {
  console.log(`Alert ${alert.id}: no baseline for ${alert.url} — auto-creating`);

  const ping = await pingUrl(alert.url);
  if (!ping.ok) {
    const msg = ping.error || `HTTP ${ping.status}`;
    await handlePingFailure(alert, `${alert.url} unreachable (${msg})`);
    return;
  }

  await db('alerts').where({ id: alert.id }).update({ consecutive_failures: 0 });

  try {
    const result = await renderScreenshot(alert.url, {
      ...opts,
      width: viewportWidth,
      height: viewportHeight,
      acceptCookies: true,
    });

    const ext = result.format === 'jpeg' ? 'jpg' : result.format;
    const filename = `${crypto.randomUUID()}.${ext}`;
    const storagePath = await saveFile(filename, result.buffer, alert.user_id);

    await db('screenshots').insert({
      api_key_id: null,
      url: alert.url,
      options: JSON.stringify(opts),
      format: result.format,
      storage_path: storagePath,
      bytes: result.buffer.length,
      status: 'completed',
      is_baseline: true,
      hidden: true,
      completed_at: db.fn.now(),
    });

    console.log(`Alert ${alert.id}: auto-created baseline for ${alert.url}`);
  } catch (err) {
    console.error(`Alert ${alert.id}: failed to auto-create baseline:`, err.message);
  }
}

export async function checkAlerts() {
  try {
    const now = new Date();
    const alerts = await db('alerts')
      .join('users', 'alerts.user_id', 'users.id')
      .where('alerts.enabled', true)
      .where(function () {
        this.whereNull('alerts.last_checked_at').orWhere(
          db.raw("alerts.last_checked_at + (alerts.interval_minutes || ' minutes')::interval <= ?", [now]),
        );
      })
      .select(
        'alerts.id',
        'alerts.user_id',
        'alerts.name',
        'alerts.url',
        'alerts.options',
        'alerts.threshold',
        'alerts.interval_minutes',
        'users.email',
      );

    for (const alert of alerts) {
      try {
        const opts = typeof alert.options === 'string' ? JSON.parse(alert.options) : alert.options || {};
        const viewportWidth = opts.mobile ? 390 : opts.width || 1280;
        const viewportHeight = opts.mobile ? 844 : opts.height || 720;

        const baseline = await findBaseline(alert, opts, viewportWidth, viewportHeight);

        if (!baseline) {
          await createBaseline(alert, opts, viewportWidth, viewportHeight);
        } else {
          await alertCheckQueue.add(
            'alert-check',
            { alert, baseline },
            { jobId: `alert-${alert.id}-${Date.now()}` },
          );
        }

        await db('alerts').where({ id: alert.id }).update({ last_checked_at: db.fn.now() });
      } catch (err) {
        console.error(`Alert ${alert.id} check failed:`, err.message);
      }
    }
  } catch (err) {
    console.error('Alert checker error:', err);
  }
}

export async function processAlert(alert, baseline) {
  const opts = typeof alert.options === 'string' ? JSON.parse(alert.options) : alert.options || {};
  const viewportWidth = opts.mobile ? 390 : opts.width || 1280;
  const viewportHeight = opts.mobile ? 844 : opts.height || 720;

  if (!baseline) {
    baseline = await findBaseline(alert, opts, viewportWidth, viewportHeight);
    if (!baseline) {
      console.log(`Alert ${alert.id}: no baseline found — skipping check`);
      return;
    }
  }

  const ping = await pingUrl(alert.url);
  if (!ping.ok) {
    const msg = ping.error || `HTTP ${ping.status}`;
    await handlePingFailure(alert, `${alert.url} unreachable (${msg})`);
    return;
  }

  await db('alerts').where({ id: alert.id }).update({ consecutive_failures: 0 });

  const result = await renderScreenshot(alert.url, {
    ...opts,
    width: viewportWidth,
    height: viewportHeight,
    acceptCookies: true,
  });

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
  const mismatched = pixelmatch(baselineRgba, currentRgba, diffRgba, width, height, {
    threshold: 0.1,
    includeAA: false,
    alpha: 0.5,
    diffColor: [255, 0, 0],
  });

  const totalPixels = width * height;
  const diffPercentage = Math.round((mismatched / totalPixels) * 10000) / 100;
  const triggered = diffPercentage > alert.threshold;

  let screenshotId = null;

  if (triggered) {
    const ext = result.format === 'jpeg' ? 'jpg' : result.format;
    const screenshotFilename = `${crypto.randomUUID()}.${ext}`;
    const screenshotPath = await saveFile(screenshotFilename, result.buffer, alert.user_id);

    const diffPng = await sharp(diffRgba, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer();
    const diffFilename = `diff_${crypto.randomUUID()}.png`;
    const diffPath = await saveFile(diffFilename, diffPng, alert.user_id);

    const apiKey = await db('api_keys')
      .where({ user_id: alert.user_id, active: true })
      .orderBy('created_at', 'asc')
      .select('id')
      .first();

    const [screenshot] = await db('screenshots')
      .insert({
        api_key_id: apiKey ? apiKey.id : null,
        url: alert.url,
        options: JSON.stringify(opts),
        format: result.format,
        storage_path: screenshotPath,
        bytes: result.buffer.length,
        status: 'completed',
        hidden: true,
        baseline_id: baseline.id,
        diff_percentage: diffPercentage,
        diff_storage_path: diffPath,
        completed_at: db.fn.now(),
      })
      .returning('id');

    screenshotId = screenshot.id;

    await sendAlertNotification(alert.email, alert.name, alert.url, diffPercentage);
    console.log(
      `Alert ${alert.id}: diff ${diffPercentage}% exceeded threshold ${alert.threshold}% — notification sent to ${alert.email}`,
    );
  } else {
    console.log(`Alert ${alert.id}: diff ${diffPercentage}% within threshold ${alert.threshold}% — no notification`);
  }

  await db('alert_runs').insert({
    alert_id: alert.id,
    triggered,
    diff_percentage: diffPercentage,
    threshold: alert.threshold,
    screenshot_id: screenshotId,
  });
}

export function startAlertChecker() {
  checkAlerts();
  intervalHandle = setInterval(checkAlerts, 60 * 1000);
}

export function stopAlertChecker() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
