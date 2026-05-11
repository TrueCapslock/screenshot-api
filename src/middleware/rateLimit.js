import { getRedis } from '../services/redis.js';
import config from '../config.js';

const redis = getRedis();

export function rateLimit(req, res, next) {
  if (req.isAdmin) return next();
  const tier = req.tier || 'free';
  const limits = config.tiers[tier];
  if (!limits) return next();

  const key = `rl:${req.apiKey.id}`;
  const window = limits.windowMs;

  redis
    .multi()
    .incr(key)
    .pttl(key)
    .exec((err, results) => {
      if (err) return next();

      const count = results[0][1];
      const ttl = results[1][1];

      if (ttl === -1) {
        redis.pexpire(key, window).catch(() => {});
      }

      res.set('X-RateLimit-Limit', limits.rateLimit);
      res.set('X-RateLimit-Remaining', Math.max(0, limits.rateLimit - count));
      res.set('X-RateLimit-Tier', tier);

      if (count > limits.rateLimit) {
        return res.status(429).json({
          error: 'rate_limit_exceeded',
          message: `Exceeded rate limit of ${limits.rateLimit} req/min for ${tier} tier`,
        });
      }

      next();
    });
}
