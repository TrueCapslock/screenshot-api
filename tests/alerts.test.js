import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';

const qb = vi.hoisted(() => ({
  join: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  whereIn: vi.fn().mockReturnThis(),
  whereNull: vi.fn().mockReturnThis(),
  whereNotNull: vi.fn().mockReturnThis(),
  whereRaw: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  offset: vi.fn().mockReturnThis(),
  count: vi.fn().mockReturnThis(),
  returning: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  del: vi.fn().mockReturnThis(),
  first: vi.fn().mockResolvedValue(null),
  [Symbol.iterator]: function* () {},
  map: function () { return []; },
}));

const mockRedis = vi.hoisted(() => ({
  ping: vi.fn().mockResolvedValue('PONG'),
  multi: vi.fn().mockReturnThis(),
  incr: vi.fn().mockReturnThis(),
  pttl: vi.fn().mockReturnThis(),
  pexpire: vi.fn().mockResolvedValue(1),
  exec: vi.fn().mockImplementation((cb) => cb(null, [[null, 1], [null, -1]])),
}));

vi.mock('../src/db/knex.js', () => ({
  default: Object.assign(() => qb, {
    raw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    fn: { now: () => 'now()' },
  }),
}));

vi.mock('../src/services/renderer.js', () => ({
  renderScreenshot: vi.fn(),
}));

vi.mock('../src/services/storage.js', () => ({
  saveFile: vi.fn(),
  deleteFile: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock('../src/services/email.js', () => ({
  sendAlertNotification: vi.fn(),
}));

vi.mock('../src/services/redis.js', () => ({
  getRedis: () => mockRedis,
  pingRedis: vi.fn().mockResolvedValue(true),
}));

vi.mock('bcrypt', () => ({
  default: { compare: vi.fn().mockResolvedValue(true) },
}));

const mockKeyRow = {
  id: 'key-1', user_id: 'user-1', key_prefix: 'sk_test12',
  tier: 'free', stripe_subscription_id: null, email: 'admin@test.com',
  key_hash: '$2b$10$fakehash',
};

const mockAlert = {
  id: 'alert-1', user_id: 'user-1', name: 'Test Alert',
  url: 'https://example.com', options: '{}', interval_minutes: 60,
  threshold: 0, enabled: true, last_checked_at: null,
  created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z',
};

const mockRun = {
  id: 'run-1', alert_id: 'alert-1', triggered: true,
  diff_percentage: 5.5, threshold: 0, screenshot_id: 'screenshot-1',
  created_at: '2025-01-01T00:00:00Z',
};

const mockScreenshot = {
  id: 'screenshot-1', api_key_id: 'key-1', url: 'https://example.com',
  options: '{}', format: 'png', storage_path: 'user-1/screenshot.png',
  bytes: 1234, status: 'completed', is_baseline: false, hidden: true,
  baseline_id: null, diff_percentage: null, diff_storage_path: null,
  completed_at: '2025-01-01T00:00:00Z', created_at: '2025-01-01T00:00:00Z',
};

let app;

beforeAll(async () => {
  app = (await import('../src/app.js')).default;
});

beforeEach(() => {
  qb.first.mockResolvedValue(null);
  qb[Symbol.iterator] = function* () {};
  qb.map = function () { return []; };
});

function consumeAuth() {
  qb.first.mockResolvedValueOnce(mockKeyRow);
}

function setIterator(value) {
  qb[Symbol.iterator] = function* () { yield value; };
}

describe('GET /v1/alerts', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/v1/alerts');
    expect(res.status).toBe(401);
  });

  it('returns 200 with alerts list', async () => {
    consumeAuth();
    const res = await request(app)
      .get('/v1/alerts')
      .set('x-api-key', 'sk_test1234567890abcdef');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('alerts');
  });
});

describe('POST /v1/alerts', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/v1/alerts')
      .send({ name: 'Test', url: 'https://example.com' });
    expect(res.status).toBe(401);
  });

  it('returns 400 with empty body', async () => {
    consumeAuth();
    const res = await request(app)
      .post('/v1/alerts')
      .set('x-api-key', 'sk_test1234567890abcdef')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'validation_error');
  });

  it('returns 400 with invalid url', async () => {
    consumeAuth();
    const res = await request(app)
      .post('/v1/alerts')
      .set('x-api-key', 'sk_test1234567890abcdef')
      .send({ name: 'Test', url: 'not-a-url' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'validation_error');
  });

  it('returns 201 and creates baseline when none exists', async () => {
    const { renderScreenshot } = await import('../src/services/renderer.js');
    const { saveFile } = await import('../src/services/storage.js');
    renderScreenshot.mockResolvedValue({
      buffer: Buffer.from('fake-image'), format: 'png',
      width: 1280, height: 720, durationMs: 100,
    });
    saveFile.mockResolvedValue('user-1/screenshot.png');

    consumeAuth();
    qb.first.mockResolvedValueOnce(null);
    setIterator(mockAlert);

    const res = await request(app)
      .post('/v1/alerts')
      .set('x-api-key', 'sk_test1234567890abcdef')
      .send({ name: 'Test Alert', url: 'https://example.com' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('alert');
    expect(res.body).toHaveProperty('baseline_created', true);
    expect(res.body).toHaveProperty('baseline_exists', false);
  });

  it('returns 201 when baseline already exists', async () => {
    consumeAuth();
    setIterator(mockAlert);

    const res = await request(app)
      .post('/v1/alerts')
      .set('x-api-key', 'sk_test1234567890abcdef')
      .send({ name: 'Existing Alert', url: 'https://example.com' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('alert');
    expect(res.body).toHaveProperty('baseline_created', false);
    expect(res.body).toHaveProperty('baseline_exists', true);
  });
});

describe('PUT /v1/alerts/:id', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .put('/v1/alerts/alert-1')
      .send({ name: 'Updated' });
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-existent alert', async () => {
    consumeAuth();
    qb.first.mockResolvedValueOnce(null);

    const res = await request(app)
      .put('/v1/alerts/alert-1')
      .set('x-api-key', 'sk_test1234567890abcdef')
      .send({ name: 'Updated' });
    expect(res.status).toBe(404);
  });

  it('returns 400 with invalid body', async () => {
    consumeAuth();
    qb.first.mockResolvedValueOnce(mockAlert);

    const res = await request(app)
      .put('/v1/alerts/alert-1')
      .set('x-api-key', 'sk_test1234567890abcdef')
      .send({ interval_minutes: 999999 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'validation_error');
  });

  it('returns 200 and updates alert (no viewport change)', async () => {
    consumeAuth();
    qb.first.mockResolvedValueOnce(mockAlert);
    setIterator({ ...mockAlert, name: 'Updated' });

    const res = await request(app)
      .put('/v1/alerts/alert-1')
      .set('x-api-key', 'sk_test1234567890abcdef')
      .send({ name: 'Updated Name' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('alert');
  });

  it('returns 200 and regenerates baseline on url change', async () => {
    const { renderScreenshot } = await import('../src/services/renderer.js');
    const { saveFile } = await import('../src/services/storage.js');
    renderScreenshot.mockResolvedValue({
      buffer: Buffer.from('fake-image'), format: 'png',
      width: 1280, height: 720, durationMs: 100,
    });
    saveFile.mockResolvedValue('user-1/new-screenshot.png');

    consumeAuth();
    qb.first.mockResolvedValueOnce(mockAlert);
    setIterator({ ...mockAlert, url: 'https://example.com/new' });

    const res = await request(app)
      .put('/v1/alerts/alert-1')
      .set('x-api-key', 'sk_test1234567890abcdef')
      .send({ url: 'https://example.com/new' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('alert');
  });
});

describe('DELETE /v1/alerts/:id', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).delete('/v1/alerts/alert-1');
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-existent alert', async () => {
    consumeAuth();
    qb.first.mockResolvedValueOnce(null);

    const res = await request(app)
      .delete('/v1/alerts/alert-1')
      .set('x-api-key', 'sk_test1234567890abcdef');
    expect(res.status).toBe(404);
  });

  it('returns 200 and deletes alert', async () => {
    consumeAuth();
    qb.first.mockResolvedValueOnce(mockAlert).mockResolvedValueOnce(null);

    const res = await request(app)
      .delete('/v1/alerts/alert-1')
      .set('x-api-key', 'sk_test1234567890abcdef');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('deleted', true);
    expect(res.body).toHaveProperty('screenshots_removed', 0);
  });

  it('removes associated screenshots when baseline found', async () => {
    consumeAuth();
    qb.first.mockResolvedValueOnce(mockAlert).mockResolvedValueOnce({ id: 'baseline-1' });

    const res = await request(app)
      .delete('/v1/alerts/alert-1')
      .set('x-api-key', 'sk_test1234567890abcdef');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('deleted', true);
  });
});

describe('GET /v1/alerts/:id/runs', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/v1/alerts/alert-1/runs');
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-existent alert', async () => {
    consumeAuth();
    qb.first.mockResolvedValueOnce(null);

    const res = await request(app)
      .get('/v1/alerts/alert-1/runs')
      .set('x-api-key', 'sk_test1234567890abcdef');
    expect(res.status).toBe(404);
  });

  it('returns 200 with runs list', async () => {
    consumeAuth();

    const res = await request(app)
      .get('/v1/alerts/alert-1/runs')
      .set('x-api-key', 'sk_test1234567890abcdef');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('runs');
  });
});

describe('POST /v1/alerts/:id/runs/:runId/set-baseline', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).post('/v1/alerts/alert-1/runs/run-1/set-baseline');
    expect(res.status).toBe(401);
  });

  it('returns 404 when alert not found', async () => {
    consumeAuth();
    qb.first.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/v1/alerts/alert-1/runs/run-1/set-baseline')
      .set('x-api-key', 'sk_test1234567890abcdef');
    expect(res.status).toBe(404);
  });

  it('returns 404 when run not found', async () => {
    consumeAuth();
    qb.first.mockResolvedValueOnce(mockAlert).mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/v1/alerts/alert-1/runs/run-1/set-baseline')
      .set('x-api-key', 'sk_test1234567890abcdef');
    expect(res.status).toBe(404);
  });

  it('returns 400 when run has no screenshot', async () => {
    consumeAuth();
    qb.first
      .mockResolvedValueOnce(mockAlert)
      .mockResolvedValueOnce({ ...mockRun, screenshot_id: null });

    const res = await request(app)
      .post('/v1/alerts/alert-1/runs/run-1/set-baseline')
      .set('x-api-key', 'sk_test1234567890abcdef');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'no_screenshot');
  });

  it('returns 200 and promotes screenshot to baseline', async () => {
    consumeAuth();
    qb.first
      .mockResolvedValueOnce(mockAlert)
      .mockResolvedValueOnce(mockRun)
      .mockResolvedValueOnce(mockScreenshot)
      .mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/v1/alerts/alert-1/runs/run-1/set-baseline')
      .set('x-api-key', 'sk_test1234567890abcdef');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message', 'Baseline updated from run');
    expect(res.body).toHaveProperty('screenshot_id', 'screenshot-1');
  });
});
