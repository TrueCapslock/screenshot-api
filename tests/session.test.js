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
  default: { compare: vi.fn().mockResolvedValue(true) },
}));

const mockRow = {
  id: 'key-1', user_id: 'user-1', key_prefix: 'sk_test12',
  tier: 'free', stripe_subscription_id: null, email: 'admin@test.com',
  key_hash: '$2b$10$fakehash', token: 'sess-token',
};

// Routers mounted before sessionRouter with router.use(auth):
// accountRouter, keysRouter, screenshotRouter, asyncRouter, adminRouter = 5 routers
// Each auth middleware makes 2 first() calls for x-session-token, 1 for x-api-key
const AUTH_FIRST_CALLS = 10;

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

function consumeAuth() {
  for (let i = 0; i < AUTH_FIRST_CALLS; i++) {
    qb.first.mockResolvedValueOnce(mockRow);
  }
}

describe('POST /v1/session', () => {
  it('returns 401 without auth headers', async () => {
    const res = await request(app).post('/v1/session');
    expect(res.status).toBe(401);
  });

  it('returns 401 with invalid session token', async () => {
    qb.first.mockResolvedValue(null);

    const res = await request(app)
      .post('/v1/session')
      .set('x-session-token', 'bad-token');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_session');
  });

  it('returns 401 when session key is inactive', async () => {
    qb.first
      .mockResolvedValueOnce(mockRow)
      .mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/v1/session')
      .set('x-session-token', 'valid-token');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('key_inactive');
  });

  it('returns 201 with valid API key', async () => {
    qb.insert.mockResolvedValue([{ id: 'session-new' }]);

    const res = await request(app)
      .post('/v1/session')
      .set('x-api-key', 'sk_test1234567890abcdef');
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('token');
    expect(res.body.key_id).toBe('key-1');
    expect(qb.insert).toHaveBeenCalledOnce();
  });

  it('returns 201 with valid session token', async () => {
    qb.insert.mockResolvedValue([{ id: 'session-new' }]);

    const res = await request(app)
      .post('/v1/session')
      .set('x-session-token', 'valid-token');
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('token');
    expect(qb.insert).toHaveBeenCalledOnce();
  });
});

describe('POST /v1/session/key', () => {
  it('returns 401 without session token', async () => {
    const res = await request(app)
      .post('/v1/session/key')
      .send({ key_id: 'key-2' });
    expect(res.status).toBe(401);
  });

  it('returns 400 without key_id', async () => {
    const res = await request(app)
      .post('/v1/session/key')
      .set('x-session-token', 'valid-token')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });

  it('returns 401 when session not found', async () => {
    qb.first.mockResolvedValue(null);

    const res = await request(app)
      .post('/v1/session/key')
      .set('x-session-token', 'bad-token')
      .send({ key_id: 'key-2' });
    expect(res.status).toBe(401);
  });

  it('returns 404 when key not found', async () => {
    consumeAuth();
    qb.first.mockResolvedValueOnce(mockRow);
    qb.first.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/v1/session/key')
      .set('x-session-token', 'valid-token')
      .send({ key_id: 'missing-key' });
    expect(res.status).toBe(404);
  });

  it('returns 200 and switches active key', async () => {
    consumeAuth();
    qb.first.mockResolvedValueOnce(mockRow);
    qb.first.mockResolvedValueOnce({ id: 'key-2', key_prefix: 'sk_newkey' });

    const res = await request(app)
      .post('/v1/session/key')
      .set('x-session-token', 'valid-token')
      .send({ key_id: 'key-2' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ key_id: 'key-2', key_prefix: 'sk_newkey' });
  });
});

describe('DELETE /v1/session', () => {
  it('returns 401 without session token', async () => {
    const res = await request(app).delete('/v1/session');
    expect(res.status).toBe(401);
  });

  it('returns 200 and deletes session', async () => {
    const res = await request(app)
      .delete('/v1/session')
      .set('x-session-token', 'valid-token');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Session deleted' });
    expect(qb.del).toHaveBeenCalledOnce();
  });
});
