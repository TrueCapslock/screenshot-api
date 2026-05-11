import bcrypt from 'bcrypt';
import db from '../db/knex.js';
import config from '../config.js';

export async function auth(req, res, next) {
  const header = req.headers['x-api-key'];
  if (!header) {
    return res.status(401).json({ error: 'missing_api_key', message: 'x-api-key header required' });
  }

  const prefix = header.slice(0, 8);
  const keyRow = await db('api_keys')
    .join('users', 'api_keys.user_id', 'users.id')
    .where({ 'api_keys.active': true, 'api_keys.key_prefix': prefix })
    .select(
      'api_keys.id',
      'api_keys.key_hash',
      'api_keys.user_id',
      'users.tier',
      'users.stripe_subscription_id',
      'users.email',
    )
    .first();

  if (!keyRow) {
    return res.status(401).json({ error: 'invalid_api_key', message: 'API key not found or inactive' });
  }

  const match = await bcrypt.compare(header, keyRow.key_hash);
  if (!match) {
    return res.status(401).json({ error: 'invalid_api_key', message: 'API key not found or inactive' });
  }

  await db('api_keys').where({ id: keyRow.id }).update({ last_used_at: db.fn.now() });

  req.apiKey = { id: keyRow.id, userId: keyRow.user_id };
  req.tier = keyRow.tier;
  req.subscriptionId = keyRow.stripe_subscription_id;
  req.isAdmin = config.adminEmail && keyRow.email === config.adminEmail;
  next();
}
