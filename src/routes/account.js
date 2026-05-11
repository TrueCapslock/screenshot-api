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

  res.json({
    user: { ...user, is_admin: req.isAdmin },
    usage: parseInt((usage?.count || '0').toString(), 10),
    keys,
  });
});

router.get('/account/screenshots', async (req, res) => {
  const screenshots = await db('screenshots')
    .join('api_keys', 'screenshots.api_key_id', 'api_keys.id')
    .where({ 'api_keys.user_id': req.apiKey.userId })
    .select(
      'screenshots.id',
      'screenshots.url',
      'screenshots.format',
      'screenshots.bytes',
      'screenshots.status',
      'screenshots.created_at',
      'screenshots.completed_at',
    )
    .orderBy('screenshots.created_at', 'desc')
    .limit(50);

  const [{ count }] = await db('screenshots')
    .join('api_keys', 'screenshots.api_key_id', 'api_keys.id')
    .where({ 'api_keys.user_id': req.apiKey.userId })
    .count('* as count');

  const baseUrl = config.baseUrl;
  res.json({
    total: parseInt(count, 10),
    screenshots: screenshots.map((s) => ({
      ...s,
      image_url: s.status === 'completed' ? `${baseUrl}/v1/screenshot/${s.id}` : null,
    })),
  });
});

export default router;
