import db from '../db/knex.js';

export async function logUsage(req, res, next) {
  const start = Date.now();
  res.on('finish', async () => {
    if (!req.apiKey) return;
    const duration = Date.now() - start;
    try {
      await db('usage_logs').insert({
        api_key_id: req.apiKey.id,
        endpoint: req.originalUrl,
        status: res.statusCode >= 400 ? 'error' : 'success',
        bytes: parseInt(res.get('Content-Length') || '0', 10),
        duration_ms: duration,
      });
    } catch {
      // usage logging is best-effort
    }
  });
  next();
}
