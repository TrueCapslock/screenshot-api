import { Router } from 'express';
import crypto from 'crypto';
import db from '../db/knex.js';
import { auth } from '../middleware/auth.js';

const router = Router();

router.post('/session', auth, async (req, res) => {
  const rawToken = crypto.randomBytes(32).toString('hex');

  await db('sessions').insert({
    token: rawToken,
    user_id: req.apiKey.userId,
    api_key_id: req.apiKey.id,
  });

  res.status(201).json({
    token: rawToken,
    key_id: req.apiKey.id,
    key_prefix: req.apiKey.keyPrefix,
  });
});

router.post('/session/key', async (req, res) => {
  const token = req.headers['x-session-token'];
  if (!token) {
    return res.status(401).json({ error: 'missing_session', message: 'x-session-token header required' });
  }

  const { key_id } = req.body;
  if (!key_id) {
    return res.status(400).json({ error: 'validation_error', message: 'key_id is required' });
  }

  const session = await db('sessions').where({ token }).first();
  if (!session) {
    return res.status(401).json({ error: 'invalid_session', message: 'Session not found' });
  }

  const key = await db('api_keys')
    .where({ id: key_id, user_id: session.user_id, active: true })
    .select('id', 'key_prefix')
    .first();

  if (!key) {
    return res.status(404).json({ error: 'not_found', message: 'Key not found or inactive' });
  }

  await db('sessions').where({ token }).update({ api_key_id: key_id, last_used_at: db.fn.now() });

  res.json({ key_id: key.id, key_prefix: key.key_prefix });
});

router.delete('/session', async (req, res) => {
  const token = req.headers['x-session-token'];
  if (!token) return res.status(401).json({ error: 'missing_session' });

  await db('sessions').where({ token }).del();
  res.json({ message: 'Session deleted' });
});

export default router;
