import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../src/db/knex.js', () => ({
  default: Object.assign(
    () => ({ first: vi.fn(), where: vi.fn().mockReturnThis(), count: vi.fn().mockResolvedValue([{ count: 0 }]) }),
    {
      raw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
      where: vi.fn().mockReturnThis(),
      first: vi.fn(),
      count: vi.fn().mockResolvedValue([{ count: 0 }]),
    },
  ),
}));

vi.mock('../src/services/redis.js', () => ({
  getRedis: () => ({
    ping: vi.fn().mockResolvedValue('PONG'),
  }),
  pingRedis: vi.fn().mockResolvedValue(true),
}));

let app;

beforeEach(async () => {
  vi.clearAllMocks();
  app = (await import('../src/app.js')).default;
});

describe('GET /health with DB+Redis checks', () => {
  it('returns 200 when all services are up', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks).toEqual({ db: true, redis: true });
  });

  it('returns 503 when DB is down', async () => {
    const db = await import('../src/db/knex.js');
    db.default.raw.mockRejectedValue(new Error('connection refused'));

    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.checks.db).toBe(false);
  });

  it('returns 503 when Redis is down', async () => {
    const redis = await import('../src/services/redis.js');
    redis.pingRedis.mockResolvedValue(false);

    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.checks.redis).toBe(false);
  });

  it('returns valid ISO timestamp', async () => {
    const res = await request(app).get('/health');
    expect(() => new Date(res.body.timestamp)).not.toThrow();
    expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
  });
});
