import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';

const qb = vi.hoisted(() => ({
  join: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  first: vi.fn().mockResolvedValue(null),
  count: vi.fn().mockReturnThis(),
  del: vi.fn().mockResolvedValue(1),
  insert: vi.fn().mockResolvedValue([1]),
  update: vi.fn().mockResolvedValue(1),
}));

vi.mock('../src/db/knex.js', () => ({
  default: Object.assign(() => qb, {
    raw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    fn: { now: () => 'now()' },
  }),
}));

const mockRedis = vi.hoisted(() => ({
  ping: vi.fn().mockResolvedValue('PONG'),
  multi: vi.fn().mockReturnThis(),
  incr: vi.fn().mockReturnThis(),
  pttl: vi.fn().mockReturnThis(),
  pexpire: vi.fn().mockResolvedValue(1),
  exec: vi.fn().mockImplementation((cb) => cb(null, [[null, 1], [null, -1]])),
}));

vi.mock('../src/services/redis.js', () => ({
  getRedis: () => mockRedis,
  pingRedis: vi.fn().mockResolvedValue(true),
}));

vi.mock('bcrypt', () => ({
  default: { compare: vi.fn().mockResolvedValue(true) },
}));

const mockRow = {
  id: 'key-1', user_id: 'user-1', key_prefix: 'sk_test12',
  tier: 'free', stripe_subscription_id: null, email: 'regular@test.com',
  key_hash: '$2b$10$fakehash',
};

const AUTH_APIKEY_CALLS = 3;

let app;

beforeAll(async () => {
  app = (await import('../src/app.js')).default;
});

beforeEach(() => {
  vi.clearAllMocks();
  qb.join.mockReturnThis();
  qb.where.mockReturnThis();
  qb.select.mockReturnThis();
  qb.orderBy.mockReturnThis();
  qb.limit.mockReturnThis();
  qb.first.mockResolvedValue(mockRow);
  qb.insert.mockResolvedValue([1]);
  qb.update.mockResolvedValue(1);
  qb.del.mockResolvedValue(1);
  qb.count.mockReturnThis();
  mockRedis.exec.mockImplementation((cb) => cb(null, [[null, 1], [null, -1]]));
});

describe('Rate limiting via POST /v1/screenshot', () => {
  it('returns 429 when rate limit exceeded', async () => {
    mockRedis.exec.mockImplementation((cb) => cb(null, [[null, 6], [null, -1]]));

    const res = await request(app)
      .post('/v1/screenshot')
      .set('x-api-key', 'sk_test1234567890abcdef')
      .send({ url: 'https://example.com' });
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('rate_limit_exceeded');
  });

  it('sets rate limit headers', async () => {
    const res = await request(app)
      .post('/v1/screenshot')
      .set('x-api-key', 'sk_test1234567890abcdef')
      .send({ url: 'not-a-url' });
    expect(res.status).toBe(400);
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
    expect(res.headers['x-ratelimit-tier']).toBe('free');
  });

  it('returns 429 with session token', async () => {
    mockRedis.exec.mockImplementation((cb) => cb(null, [[null, 6], [null, -1]]));

    const res = await request(app)
      .post('/v1/screenshot')
      .set('x-session-token', 'valid-token')
      .send({ url: 'https://example.com' });
    expect(res.status).toBe(429);
  });
});

describe('Rate limiting bypass for admin', () => {
  it('does not rate limit admin users', async () => {
    mockRedis.exec.mockImplementation((cb) => cb(null, [[null, 99], [null, -1]]));
    const adminRow = { ...mockRow, email: 'admin@test.com' };
    qb.first.mockResolvedValue(adminRow);

    const res = await request(app)
      .post('/v1/screenshot')
      .set('x-api-key', 'sk_test1234567890abcdef')
      .send({ url: 'not-a-url' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });
});
