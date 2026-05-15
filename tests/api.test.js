import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';

describe('GET /health', () => {
  it('returns ok status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body).toHaveProperty('timestamp');
  });

  it('returns valid ISO timestamp', async () => {
    const res = await request(app).get('/health');
    expect(() => new Date(res.body.timestamp)).not.toThrow();
    expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
  });
});

describe('POST /v1/screenshot', () => {
  it('returns 401 without API key', async () => {
    const res = await request(app)
      .post('/v1/screenshot')
      .send({ url: 'https://example.com' });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error', 'missing_api_key');
  });

  it('returns 401 with fake API key', async () => {
    const res = await request(app)
      .post('/v1/screenshot')
      .set('x-api-key', 'sk_00000000invalid')
      .send({ url: 'https://example.com' });
    expect(res.status).toBe(401);
  });

  it('returns 401 with bad format and invalid key', async () => {
    const res = await request(app)
      .post('/v1/screenshot')
      .set('x-api-key', 'sk_fakekey12345678')
      .send({ url: 'https://example.com', format: 'gif' });
    expect(res.status).toBe(401);
  });
});

describe('POST /v1/html', () => {
  it('returns 401 without API key', async () => {
    const res = await request(app)
      .post('/v1/html')
      .send({ html: '<h1>Hello</h1>' });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error', 'missing_api_key');
  });

  it('returns 401 with fake API key', async () => {
    const res = await request(app)
      .post('/v1/html')
      .set('x-api-key', 'sk_00000000invalid')
      .send({ html: '<h1>Hello</h1>' });
    expect(res.status).toBe(401);
  });
});

describe('GET /v1/account', () => {
  it('returns 401 without API key', async () => {
    const res = await request(app).get('/v1/account');
    expect(res.status).toBe(401);
  });
});

describe('GET /v1/admin/users', () => {
  it('returns 401 without API key', async () => {
    const res = await request(app).get('/v1/admin/users');
    expect(res.status).toBe(401);
  });

  it('returns 401 with fake API key', async () => {
    const res = await request(app)
      .get('/v1/admin/users')
      .set('x-api-key', 'sk_00000000invalid');
    expect(res.status).toBe(401);
  });
});

describe('GET / serves landing page', () => {
  it('serves the landing page', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Screenshot API');
    expect(res.text).toContain('Dashboard');
  });
});

describe('404 handling', () => {
  it('returns 404 for unknown route', async () => {
    const res = await request(app).get('/nonexistent');
    expect(res.status).toBe(404);
  });
});
