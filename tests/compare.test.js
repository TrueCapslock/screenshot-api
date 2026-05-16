import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';

const qb = vi.hoisted(() => {
  const obj = {
    join: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    whereNotNull: vi.fn().mockReturnThis(),
    whereRaw: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(null),
    count: vi.fn().mockReturnThis(),
    del: vi.fn().mockResolvedValue(1),
    insert: vi.fn().mockResolvedValue([1]),
    update: vi.fn().mockResolvedValue(1),
    returning: vi.fn().mockResolvedValue([1]),
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

const adminRow = {
  id: 'key-1', user_id: 'user-1', key_prefix: 'sk_test12',
  tier: 'pro', stripe_subscription_id: null, email: 'admin@test.com',
  key_hash: '$2b$10$fakehash',
};

const AUTH_APIKEY_CALLS = 5;

let app;

beforeAll(async () => {
  app = (await import('../src/app.js')).default;
});

beforeEach(() => {
  vi.clearAllMocks();
  qb.join.mockReturnThis();
  qb.where.mockReturnThis();
  qb.whereNotNull.mockReturnThis();
  qb.select.mockReturnThis();
  qb.orderBy.mockReturnThis();
  qb.limit.mockReturnThis();
  qb.first.mockResolvedValue(adminRow);
  qb.insert.mockResolvedValue([1]);
  qb.update.mockResolvedValue(1);
  qb.del.mockResolvedValue(1);
  qb.returning.mockResolvedValue([1]);
  qb.count.mockReturnThis();
});

function consumeAuth(n) {
  for (let i = 0; i < n; i++) {
    qb.first.mockResolvedValueOnce(adminRow);
  }
}

describe('POST /v1/compare', () => {
  it('returns 400 for invalid URL', async () => {
    const res = await request(app)
      .post('/v1/compare')
      .set('x-api-key', 'sk_test1234567890abcdef')
      .send({ url: 'not-a-url' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });

  it('returns 404 when no baseline exists', async () => {
    consumeAuth(AUTH_APIKEY_CALLS);
    qb.first.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/v1/compare')
      .set('x-api-key', 'sk_test1234567890abcdef')
      .send({ url: 'https://example.com' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('no_baseline');
  });
});

describe('GET /v1/screenshot/:id/baseline', () => {
  it('returns 404 when screenshot not found', async () => {
    consumeAuth(AUTH_APIKEY_CALLS);
    qb.first.mockResolvedValueOnce(null);

    const res = await request(app)
      .get('/v1/screenshot/nonexistent/baseline')
      .set('x-api-key', 'sk_test1234567890abcdef');
    expect(res.status).toBe(404);
  });

  it('returns 200 with exists false when no baseline', async () => {
    consumeAuth(AUTH_APIKEY_CALLS);
    qb.first
      .mockResolvedValueOnce({ id: 'ss-1', url: 'https://example.com' })
      .mockResolvedValueOnce(null);

    const res = await request(app)
      .get('/v1/screenshot/ss-1/baseline')
      .set('x-api-key', 'sk_test1234567890abcdef');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ exists: false });
  });
});

describe('GET /v1/screenshot/:id/diff', () => {
  it('returns 200 with exists false when no diff', async () => {
    consumeAuth(AUTH_APIKEY_CALLS);
    qb.first.mockResolvedValueOnce(null);

    const res = await request(app)
      .get('/v1/screenshot/ss-1/diff')
      .set('x-api-key', 'sk_test1234567890abcdef');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ exists: false });
  });

  it('returns 200 with exists false when diff_storage_path is null', async () => {
    consumeAuth(AUTH_APIKEY_CALLS);
    qb.first.mockResolvedValueOnce({ id: 'ss-1', diff_storage_path: null });

    const res = await request(app)
      .get('/v1/screenshot/ss-1/diff')
      .set('x-api-key', 'sk_test1234567890abcdef');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ exists: false });
  });
});

describe('GET /v1/screenshot/:id/describe', () => {
  it('returns 400 when screenshot has no baseline', async () => {
    consumeAuth(AUTH_APIKEY_CALLS);
    qb.first.mockResolvedValueOnce({
      id: 'ss-1', url: 'https://example.com',
      storage_path: '/tmp/ss.png', format: 'png',
    });

    const res = await request(app)
      .get('/v1/screenshot/ss-1/describe')
      .set('x-api-key', 'sk_test1234567890abcdef');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no_baseline');
  });

  it('returns 404 when screenshot not found', async () => {
    consumeAuth(AUTH_APIKEY_CALLS);
    qb.first.mockResolvedValueOnce(null);

    const res = await request(app)
      .get('/v1/screenshot/ss-1/describe')
      .set('x-api-key', 'sk_test1234567890abcdef');
    expect(res.status).toBe(404);
  });
});
