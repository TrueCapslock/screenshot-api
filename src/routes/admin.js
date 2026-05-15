import { Router } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { auth } from '../middleware/auth.js';
import { admin } from '../middleware/admin.js';
import db from '../db/knex.js';

const router = Router();

router.get('/admin/users', auth, admin, async (req, res) => {
  const users = await db('users')
    .select('id', 'email', 'name', 'tier', 'stripe_subscription_id', 'created_at', 'updated_at')
    .orderBy('created_at', 'desc');

  const result = await Promise.all(
    users.map(async (u) => {
      const [{ count: apiUsage }] = await db('usage_logs')
        .join('api_keys', 'usage_logs.api_key_id', 'api_keys.id')
        .where({ 'api_keys.user_id': u.id })
        .where('usage_logs.created_at', '>=', db.raw("now() - interval '30 days'"))
        .count('* as count');

      const [{ count: screenshotCount }] = await db('screenshots')
        .join('api_keys', 'screenshots.api_key_id', 'api_keys.id')
        .where({ 'api_keys.user_id': u.id })
        .count('* as count');

      const [{ count: keyCount }] = await db('api_keys').where({ user_id: u.id }).count('* as count');

      return {
        ...u,
        api_usage: parseInt(apiUsage, 10),
        screenshots: parseInt(screenshotCount, 10),
        api_keys: parseInt(keyCount, 10),
      };
    }),
  );

  res.json({ users: result });
});

router.get('/admin/users/:id', auth, admin, async (req, res) => {
  const user = await db('users').where({ id: req.params.id }).first();
  if (!user) return res.status(404).json({ error: 'not_found', message: 'User not found' });

  const keys = await db('api_keys')
    .where({ user_id: user.id })
    .select('id', 'key_prefix', 'name', 'active', 'last_used_at', 'created_at');

  const [{ count: apiUsage }] = await db('usage_logs')
    .join('api_keys', 'usage_logs.api_key_id', 'api_keys.id')
    .where({ 'api_keys.user_id': user.id })
    .count('* as count');

  const [{ count: screenshotCount }] = await db('screenshots')
    .join('api_keys', 'screenshots.api_key_id', 'api_keys.id')
    .where({ 'api_keys.user_id': user.id })
    .count('* as count');

  res.json({ user: { ...user, api_usage: parseInt(apiUsage, 10), screenshots: parseInt(screenshotCount, 10) }, keys });
});

router.patch('/admin/users/:id', auth, admin, async (req, res) => {
  const { tier, name } = req.body;
  const user = await db('users').where({ id: req.params.id }).first();
  if (!user) return res.status(404).json({ error: 'not_found', message: 'User not found' });

  const updates = {};
  if (tier) {
    const valid = ['free', 'starter', 'pro', 'business'];
    if (!valid.includes(tier))
      return res.status(400).json({ error: 'invalid_tier', message: `Tier must be one of: ${valid.join(', ')}` });
    updates.tier = tier;
  }
  if (name !== undefined) updates.name = name;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'no_updates', message: 'No valid fields to update' });
  }

  await db('users').where({ id: user.id }).update(updates);
  const updated = await db('users').where({ id: user.id }).first();
  res.json({ user: updated });
});

router.delete('/admin/users/:id', auth, admin, async (req, res) => {
  const user = await db('users').where({ id: req.params.id }).first();
  if (!user) return res.status(404).json({ error: 'not_found', message: 'User not found' });

  await db('users').where({ id: user.id }).del();
  res.json({ message: 'User deleted' });
});

router.post('/admin/users/:id/keys', auth, admin, async (req, res) => {
  const { name } = req.body;
  const user = await db('users').where({ id: req.params.id }).first();
  if (!user) return res.status(404).json({ error: 'not_found', message: 'User not found' });

  const rawKey = `sk_${crypto.randomBytes(32).toString('hex')}`;
  const keyPrefix = rawKey.slice(0, 8);
  const keyHash = await bcrypt.hash(rawKey, 10);

  await db('api_keys').insert({
    user_id: user.id,
    key_hash: keyHash,
    key_prefix: keyPrefix,
    name: (name || 'Admin created').slice(0, 255),
  });

  res.status(201).json({ key: rawKey, prefix: keyPrefix });
});

router.delete('/admin/keys/:id', auth, admin, async (req, res) => {
  const deleted = await db('api_keys').where({ id: req.params.id }).del();
  if (!deleted) {
    return res.status(404).json({ error: 'not_found', message: 'API key not found' });
  }
  res.json({ message: 'API key revoked' });
});

export default router;
