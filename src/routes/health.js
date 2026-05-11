import { Router } from 'express';
import db from '../db/knex.js';
import { pingRedis } from '../services/redis.js';

const router = Router();

router.get('/health', async (_req, res) => {
  const checks = { db: false, redis: false };

  try {
    await db.raw('SELECT 1');
    checks.db = true;
  } catch {
    // db check failed
  }

  checks.redis = await pingRedis();

  const allOk = checks.db && checks.redis;

  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    checks,
  });
});

export default router;
