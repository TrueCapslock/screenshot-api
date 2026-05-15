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

  const rawKey = `sk_${crypto.randomBytes(32).toString('hex')}`;
  const keyPrefix = rawKey.slice(0, 8);
  const keyHash = await bcrypt.hash(rawKey, 10);

  await db('api_keys').insert({
    user_id: user.id,
    key_hash: keyHash,
    key_prefix: keyPrefix,
    name: 'Magic Link',
  });

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
    <title>Login — Screenshot API</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 500px; margin: 40px auto; padding: 0 20px; text-align: center; }
      h1 { font-size: 22px; margin-bottom: 8px; }
      p { font-size: 14px; color: #555; line-height: 1.5; }
      .key { background: #f5f5f5; padding: 14px; border-radius: 6px; font-family: monospace; font-size: 13px; word-break: break-all; margin: 16px 0; cursor: pointer; border: 2px solid transparent; user-select: all; }
      .key:hover { border-color: #0052cc; }
      .key.copied { border-color: #28a745; background: #d4edda; }
      .btn { display: inline-block; padding: 12px 28px; background: #0052cc; color: #fff; text-decoration: none; border-radius: 6px; font-size: 15px; font-weight: 600; margin-top: 8px; }
      .btn:hover { background: #003d99; }
      .warn { font-size: 12px; color: #dc3545; margin-top: 8px; }
    </style>
    </head>
    <body>
    <h1>Welcome${user.name ? `, ${user.name}` : ''}!</h1>
    <p>Your new API key is ready. Click to copy, then save it somewhere safe.</p>
    <div class="key" id="keyDisplay" onclick="copyKey()">${rawKey}</div>
    <p style="font-size:12px;color:#999;">This key will not be shown again.</p>
    <a href="${config.baseUrl}/docs" class="btn" id="dashBtn">Go to Dashboard</a>
    <script>
      localStorage.setItem('apiKey', '${rawKey}');
      function copyKey() {
        navigator.clipboard.writeText('${rawKey}').then(() => {
          const el = document.getElementById('keyDisplay');
          el.classList.add('copied');
          el.textContent = 'Copied!';
          setTimeout(() => { el.textContent = '${rawKey}'; el.classList.remove('copied'); }, 1500);
        });
      }
      document.getElementById('dashBtn').addEventListener('click', function(e) {
        e.preventDefault();
        const u = new URL(location);
        const email = u.searchParams.get('email');
        if (email && email !== 'null') localStorage.setItem('magicEmail', email);
        location.href = this.href;
      });
    </script>
    </body>
    </html>
  `);
});

export default router;
