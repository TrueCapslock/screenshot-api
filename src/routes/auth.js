import { Router } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import db from '../db/knex.js';
import config from '../config.js';
import { sendMagicLink } from '../services/email.js';

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

router.post('/magic-link', async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'validation_error', message: 'email is required' });
  }

  const existing = await db('users').where({ email: email.toLowerCase().trim() }).first();
  if (!existing) {
    return res.status(404).json({ error: 'not_found', message: 'No account found with that email' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  const hashed = await bcrypt.hash(token, 10);

  await db('magic_tokens').insert({
    email: email.toLowerCase().trim(),
    token: hashed,
    expires_at: db.raw("now() + interval '15 minutes'"),
  });

  const link = `${config.baseUrl}/v1/verify-magic?token=${token}&email=${encodeURIComponent(email.toLowerCase().trim())}`;
  await sendMagicLink(email, link);

  res.json({ message: 'Magic link sent to your email' });
});

router.get('/verify-magic', async (req, res) => {
  const { token, email } = req.query;
  if (!token || !email) {
    return res.redirect(`${config.baseUrl}/docs?error=invalid_magic_link`);
  }

  const rows = await db('magic_tokens')
    .where({ email: email.toLowerCase().trim(), used: false })
    .where('expires_at', '>', db.fn.now())
    .orderBy('created_at', 'desc');

  let matched = null;
  for (const row of rows) {
    if (await bcrypt.compare(token, row.token)) {
      matched = row;
      break;
    }
  }

  if (!matched) {
    return res.redirect(`${config.baseUrl}/docs?error=invalid_magic_link`);
  }

  await db('magic_tokens').where({ id: matched.id }).update({ used: true });

  const user = await db('users').where({ email: email.toLowerCase().trim() }).first();
  const keys = await db('api_keys').where({ user_id: user.id, active: true }).select('id', 'key_prefix', 'name', 'created_at');

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
    <title>Login — Screenshot API</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 500px; margin: 40px auto; padding: 0 20px; }
      .key { background: #f5f5f5; padding: 12px; border-radius: 6px; font-family: monospace; word-break: break-all; margin: 8px 0; cursor: pointer; }
      .key:hover { background: #eee; }
      .btn { display: inline-block; padding: 10px 20px; background: #0052cc; color: #fff; text-decoration: none; border-radius: 6px; margin-top: 16px; }
      .hint { font-size: 13px; color: #666; margin-top: 4px; }
    </style>
    </head>
    <body>
    <h1>Welcome${user.name ? `, ${user.name}` : ''}!</h1>
    <p>Click any key below to copy it, then paste it in the login field:</p>
    ${keys.length === 0 ? '<p>No active API keys. <a href="/docs">Create one in your dashboard</a>.</p>' : ''}
    ${keys.map(k => `<div class="key" onclick="navigator.clipboard.writeText(this.dataset.full).then(()=>{this.style.background='#d4edda';setTimeout(()=>this.style.background='',1000)})" data-full="sk_${k.key_prefix}...">sk_${k.key_prefix}... <span class="hint">(${k.name || 'unnamed'})</span></div>`).join('')}
    <br>
    <a href="${config.baseUrl}/docs" class="btn">Go to Dashboard</a>
    <script>const u=new URL(location);const e=u.searchParams.get('email');if(e&&e!=='null'){u.pathname='/docs';u.search='';localStorage.setItem('magicEmail',e);}</script>
    </body>
    </html>
  `);
});

export default router;
