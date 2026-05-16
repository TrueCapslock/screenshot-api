import { it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'fs';

let firstCount = 0;
const callLog = [];

const qb = vi.hoisted(() => {
  const obj = {
    join: vi.fn((t, ...a) => { callLog.push('J:' + t + '(' + a.join(',') + ')'); return obj; }),
    where: vi.fn((a) => { 
      const s = typeof a === 'string' ? a : JSON.stringify(a).slice(0,60); 
      callLog.push('W:' + s); return obj; 
    }),
    select: vi.fn((...a) => { callLog.push('S:' + a.join(',')); return obj; }),
    orderBy: vi.fn(() => { callLog.push('OB'); return obj; }),
    first: vi.fn(() => { 
      firstCount++; 
      callLog.push('1st#' + firstCount); 
      return Promise.resolve(null); 
    }),
    update: vi.fn(() => { callLog.push('UPD'); return Promise.resolve(1); }),
    insert: vi.fn(() => { callLog.push('INS'); return Promise.resolve([1]); }),
    returning: vi.fn(() => { callLog.push('RET'); return obj; }),
    del: vi.fn(() => { callLog.push('DEL'); return Promise.resolve(1); }),
    whereIn: vi.fn(() => obj), whereNotNull: vi.fn(() => obj), whereRaw: vi.fn(() => obj),
    limit: vi.fn(() => obj), offset: vi.fn(() => obj), count: vi.fn(() => obj),
    [Symbol.iterator]: function* () {},
    map: function () { return []; },
  };
  return obj;
});

const mockRedis = vi.hoisted(() => ({
  ping: vi.fn().mockResolvedValue('PONG'),
  multi: vi.fn().mockReturnThis(), incr: vi.fn().mockReturnThis(),
  pttl: vi.fn().mockReturnThis(), pexpire: vi.fn().mockResolvedValue(1),
  exec: vi.fn().mockImplementation((cb) => cb(null, [[null, 1], [null, -1]])),
}));

vi.mock('../src/db/knex.js', () => ({
  default: Object.assign(() => qb, {
    raw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    fn: { now: () => 'now()' },
  }),
}));

vi.mock('../src/services/redis.js', () => ({
  getRedis: () => mockRedis, pingRedis: vi.fn().mockResolvedValue(true),
}));

vi.mock('bcrypt', () => ({
  default: { compare: vi.fn().mockResolvedValue(true) },
}));

const mockKeyRow = { id: 'key-1', user_id: 'user-1', key_prefix: 'sk_test12', tier: 'free', stripe_subscription_id: null, email: 'admin@test.com', key_hash: '$2b$10$fakehash' };

let app;
beforeAll(async () => { app = (await import('../src/app.js')).default; });

beforeEach(() => { callLog.length = 0; firstCount = 0; });

it('debug', async () => {
  qb.first.mockImplementationOnce(() => { firstCount++; callLog.push('1st#' + firstCount); return Promise.resolve(mockKeyRow); });
  const res = await request(app).get('/v1/alerts').set('x-api-key', 'sk_test1234567890abcdef');
  fs.writeFileSync('/tmp/debug3.json', JSON.stringify({ status: res.status, body: res.body, trace: callLog }));
  expect(res.status).toBe(200);
});
