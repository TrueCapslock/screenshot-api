import { Router } from 'express';
import { auth } from '../middleware/auth.js';
import db from '../db/knex.js';
import config from '../config.js';

const router = Router();

router.use(auth);

router.get('/account', async (req, res) => {
  const user = await db('users')
    .where({ id: req.apiKey.userId })
    .select('id', 'email', 'name', 'tier', 'stripe_subscription_id', 'created_at')
    .first();

  const usage = await db('usage_logs')
    .join('api_keys', 'usage_logs.api_key_id', 'api_keys.id')
    .where({ 'api_keys.user_id': req.apiKey.userId })
    .where('usage_logs.created_at', '>=', db.raw("now() - interval '30 days'"))
    .count('* as count')
    .first();

  const keys = await db('api_keys')
    .where({ user_id: req.apiKey.userId })
    .select('id', 'key_prefix', 'name', 'active', 'last_used_at', 'created_at');

  const tierConfig = config.tiers[user.tier] || config.tiers.free;

  res.json({
    user: { ...user, is_admin: req.isAdmin },
    current_key_prefix: req.apiKey.keyPrefix,
    usage: parseInt((usage?.count || '0').toString(), 10),
    monthly_limit: tierConfig.monthlyLimit,
    rate_limit: { limit: tierConfig.rateLimit, window_ms: tierConfig.windowMs },
    keys,
    screenshot_retention_hours: config.screenshotRetentionHours,
  });
});

router.get('/account/screenshots', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);
  const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);

  const screenshots = await db('screenshots')
    .join('api_keys', 'screenshots.api_key_id', 'api_keys.id')
    .where({ 'api_keys.user_id': req.apiKey.userId })
    .where('screenshots.hidden', false)
    .select(
      'screenshots.id',
      'screenshots.url',
      'screenshots.format',
      'screenshots.bytes',
      'screenshots.status',
      'screenshots.is_baseline',
      'screenshots.baseline_id',
      'screenshots.diff_percentage',
      'screenshots.created_at',
      'screenshots.completed_at',
      'screenshots.options',
    )
    .orderBy('screenshots.created_at', 'desc')
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db('screenshots')
    .join('api_keys', 'screenshots.api_key_id', 'api_keys.id')
    .where({ 'api_keys.user_id': req.apiKey.userId })
    .where('screenshots.hidden', false)
    .count('* as count');

  const baseUrl = config.baseUrl;
  res.json({
    total: parseInt(count, 10),
    offset,
    limit,
    screenshots: screenshots.map((s) => ({
      ...s,
      image_url: s.status === 'completed' ? `${baseUrl}/v1/screenshot/${s.id}` : null,
    })),
  });
});

router.get('/account/recent-urls', async (req, res) => {
  const rows = await db('screenshots')
    .join('api_keys', 'screenshots.api_key_id', 'api_keys.id')
    .where({ 'api_keys.user_id': req.apiKey.userId })
    .whereNotNull('screenshots.url')
    .select('screenshots.url')
    .max('screenshots.created_at as latest')
    .groupBy('screenshots.url')
    .orderBy('latest', 'desc')
    .limit(10);

  res.json({ urls: rows.map((r) => r.url) });
});

export default router;
