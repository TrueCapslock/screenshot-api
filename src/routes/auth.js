import { Router } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import db from '../db/knex.js';

const router = Router();

router.post('/signup', async (req, res) => {
  const { email, name } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'validation_error', message: 'email is required' });
  }

  const existing = await db('users').where({ email: email.toLowerCase().trim() }).first();
  if (existing) {
    return res.status(409).json({ error: 'email_taken', message: 'Email already registered' });
  }

  const [user] = await db('users')
    .insert({
      email: email.toLowerCase().trim(),
      name: (name || '').trim() || null,
      tier: 'free',
    })
    .returning('*');

  const rawKey = `sk_${crypto.randomBytes(32).toString('hex')}`;
  const keyPrefix = rawKey.slice(0, 8);
  const keyHash = await bcrypt.hash(rawKey, 10);

  await db('api_keys').insert({
    user_id: user.id,
    key_hash: keyHash,
    key_prefix: keyPrefix,
    name: 'Default',
  });

  res.status(201).json({
    user: { id: user.id, email: user.email, tier: user.tier },
    api_key: rawKey,
    message: 'Save your API key — it will not be shown again',
  });
});

export default router;
