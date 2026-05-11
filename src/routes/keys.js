import { Router } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import db from '../db/knex.js';
import { auth } from '../middleware/auth.js';

const router = Router();

router.use(auth);

router.get('/', async (req, res) => {
  const keys = await db('api_keys')
    .where({ user_id: req.apiKey.userId })
    .select('id', 'key_prefix', 'name', 'active', 'last_used_at', 'created_at');
  res.json({ keys });
});

router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'validation_error', message: 'name is required' });
  }

  const rawKey = `sk_${crypto.randomBytes(32).toString('hex')}`;
  const keyPrefix = rawKey.slice(0, 8);
  const keyHash = await bcrypt.hash(rawKey, 10);

  await db('api_keys').insert({
    user_id: req.apiKey.userId,
    key_hash: keyHash,
    key_prefix: keyPrefix,
    name: name.slice(0, 255),
  });

  res.status(201).json({
    key: rawKey,
    prefix: keyPrefix,
    name: name.slice(0, 255),
    message: 'Save this key — it will not be shown again',
  });
});

router.delete('/:id', async (req, res) => {
  const deleted = await db('api_keys').where({ id: req.params.id, user_id: req.apiKey.userId }).del();

  if (!deleted) {
    return res.status(404).json({ error: 'not_found', message: 'API key not found' });
  }
  res.json({ message: 'API key revoked' });
});

export default router;
