import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';

const qb = vi.hoisted(() => ({
  join: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  first: vi.fn().mockResolvedValue(null),
  count: vi.fn().mockResolvedValue([{ count: 0 }]),
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
  default: {
    compare: vi.fn().mockResolvedValue(true),
    hash: vi.fn().mockResolvedValue('$2b$10$mockedhash'),
  },
}));

const mockRow = {
  id: 'key-1', user_id: 'user-1', key_prefix: 'sk_test12',
  tier: 'free', stripe_subscription_id: null, email: 'admin@test.com',
  key_hash: '$2b$10$fakehash',
};

const AUTH_APIKEY_CALLS = 5;
const AUTH_SESSION_CALLS = 10;

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
  qb.count.mockResolvedValue([{ count: 0 }]);
});

function consumeAuth(n) {
  for (let i = 0; i < n; i++) {
    qb.first.mockResolvedValueOnce(mockRow);
  }
}

describe('GET /v1/keys', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/v1/keys');
    expect(res.status).toBe(401);
  });

  it('returns 200 with valid API key', async () => {
    const res = await request(app)
      .get('/v1/keys')
      .set('x-api-key', 'sk_test1234567890abcdef');
    expect(res.status).toBe(200);
  });

  it('returns 200 with session token', async () => {
    const res = await request(app)
      .get('/v1/keys')
      .set('x-session-token', 'valid-token');
    expect(res.status).toBe(200);
  });
});

describe('POST /v1/keys', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/v1/keys')
      .send({ name: 'My Key' });
    expect(res.status).toBe(401);
  });

  it('returns 400 without name', async () => {
    const res = await request(app)
      .post('/v1/keys')
      .set('x-api-key', 'sk_test1234567890abcdef')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });

  it('returns 201 with valid name', async () => {
    const res = await request(app)
      .post('/v1/keys')
      .set('x-api-key', 'sk_test1234567890abcdef')
      .send({ name: 'My Key' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('key');
    expect(res.body).toHaveProperty('prefix');
    expect(res.body.name).toBe('My Key');
    expect(qb.insert).toHaveBeenCalledOnce();
  });

  it('returns 201 with session token', async () => {
    const res = await request(app)
      .post('/v1/keys')
      .set('x-session-token', 'valid-token')
      .send({ name: 'Session Key' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('key');
    expect(qb.insert).toHaveBeenCalledOnce();
  });
});

describe('DELETE /v1/keys/:id', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).delete('/v1/keys/key-1');
    expect(res.status).toBe(401);
  });

  it('returns 200 when key revoked', async () => {
    const res = await request(app)
      .delete('/v1/keys/key-1')
      .set('x-api-key', 'sk_test1234567890abcdef');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'API key revoked' });
    expect(qb.del).toHaveBeenCalledOnce();
  });

  it('returns 404 when key not found', async () => {
    qb.del.mockResolvedValue(0);

    const res = await request(app)
      .delete('/v1/keys/nonexistent')
      .set('x-api-key', 'sk_test1234567890abcdef');
    expect(res.status).toBe(404);
  });
});
