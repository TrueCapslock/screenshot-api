import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';

const qb = vi.hoisted(() => {
  const obj = {
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
  };
  obj[Symbol.iterator] = function* () { yield { count: '0' }; };
  obj.map = function () { return []; };
  return obj;
});

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
  tier: 'free', stripe_subscription_id: null, email: 'admin@test.com',
  key_hash: '$2b$10$fakehash',
};

const AUTH_APIKEY_CALLS = 1;
const AUTH_SESSION_CALLS = 2;

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
  qb.count.mockReturnThis();
  qb.first.mockResolvedValue(mockRow);
  qb.insert.mockResolvedValue([1]);
  qb.update.mockResolvedValue(1);
  qb.del.mockResolvedValue(1);
});

function consumeAuth(n) {
  for (let i = 0; i < n; i++) {
    qb.first.mockResolvedValueOnce(mockRow);
  }
}

describe('GET /v1/account', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/v1/account');
    expect(res.status).toBe(401);
  });

  it('returns 200 with API key', async () => {
    consumeAuth(AUTH_APIKEY_CALLS);
    qb.first
      .mockResolvedValueOnce({ id: 'user-1', email: 'admin@test.com', name: 'Test', tier: 'free' })
      .mockResolvedValueOnce({ count: '5' });

    const res = await request(app)
      .get('/v1/account')
      .set('x-api-key', 'sk_test1234567890abcdef');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('user');
    expect(res.body.user.email).toBe('admin@test.com');
    expect(res.body).toHaveProperty('keys');
    expect(res.body).toHaveProperty('usage', 5);
  });

  it('returns is_admin true for admin user', async () => {
    consumeAuth(AUTH_APIKEY_CALLS);
    qb.first
      .mockResolvedValueOnce({ id: 'user-1', email: 'admin@test.com', name: 'Test', tier: 'free' })
      .mockResolvedValueOnce({ count: '0' });

    const res = await request(app)
      .get('/v1/account')
      .set('x-api-key', 'sk_test1234567890abcdef');
    expect(res.status).toBe(200);
    expect(res.body.user.is_admin).toBe(true);
  });

  it('returns is_admin false for non-admin user', async () => {
    qb.first
      .mockResolvedValueOnce({ ...mockRow, email: 'regular@test.com' })
      .mockResolvedValueOnce({ id: 'user-2', email: 'regular@test.com', name: 'Regular', tier: 'free' })
      .mockResolvedValueOnce({ count: '0' });

    const res = await request(app)
      .get('/v1/account')
      .set('x-api-key', 'sk_test1234567890abcdef');
    expect(res.status).toBe(200);
    expect(res.body.user.is_admin).toBe(false);
  });

  it('returns 200 with session token', async () => {
    consumeAuth(AUTH_SESSION_CALLS);
    qb.first
      .mockResolvedValueOnce({ id: 'user-1', email: 'admin@test.com', name: 'Test', tier: 'free' })
      .mockResolvedValueOnce({ count: '3' });

    const res = await request(app)
      .get('/v1/account')
      .set('x-session-token', 'valid-token');
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('admin@test.com');
    expect(res.body).toHaveProperty('usage', 3);
  });
});

describe('GET /v1/account/screenshots', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/v1/account/screenshots');
    expect(res.status).toBe(401);
  });

  it('returns 200 with API key', async () => {
    qb.first.mockResolvedValueOnce(mockRow);
    const res = await request(app)
      .get('/v1/account/screenshots')
      .set('x-api-key', 'sk_test1234567890abcdef');
    expect(res.status).toBe(200);
  });
});
