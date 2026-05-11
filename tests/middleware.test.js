import { describe, it, expect, vi } from 'vitest';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { admin } from '../src/middleware/admin.js';

function mockReq(overrides = {}) {
  return {
    headers: {},
    apiKey: null,
    tier: 'free',
    isAdmin: false,
    ...overrides,
  };
}

function mockRes() {
  const state = { statusCode: 200, body: null, headers: {} };
  const res = {
    state,
    status(code) { state.statusCode = code; return this; },
    json(body) { state.body = body; return this; },
    setHeader(k, v) { state.headers[k] = v; return this; },
    set(k, v) { if (typeof k === 'object') Object.assign(state.headers, k); else state.headers[k] = v; return this; },
    on() { return this; },
    emit() {},
  };
  return res;
}

describe('errorHandler middleware', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 500 with error message', () => {
    const req = mockReq();
    const res = mockRes();
    const err = new Error('Something broke');

    errorHandler(err, req, res, () => {});

    expect(res.state.statusCode).toBe(500);
    expect(res.state.body).toEqual({
      error: 'internal_error',
      message: 'Something broke',
    });
  });

  it('uses custom status code', () => {
    const req = mockReq();
    const res = mockRes();
    const err = new Error('Bad request');
    err.status = 400;
    err.code = 'bad_request';

    errorHandler(err, req, res, () => {});

    expect(res.state.statusCode).toBe(400);
    expect(res.state.body).toEqual({
      error: 'bad_request',
      message: 'Bad request',
    });
  });

  it('handles error with no message', () => {
    const req = mockReq();
    const res = mockRes();

    errorHandler({}, req, res, () => {});

    expect(res.state.statusCode).toBe(500);
    expect(res.state.body).toEqual({
      error: 'internal_error',
      message: 'Internal server error',
    });
  });
});

describe('admin middleware', () => {
  it('calls next() when req.isAdmin is true', () => {
    const req = mockReq({ isAdmin: true });
    const res = mockRes();
    const next = vi.fn();

    admin(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 403 when req.isAdmin is false', () => {
    const req = mockReq({ isAdmin: false });
    const res = mockRes();
    const next = vi.fn();

    admin(req, res, next);

    expect(res.state.statusCode).toBe(403);
    expect(res.state.body).toEqual({
      error: 'forbidden',
      message: 'Admin access required',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when isAdmin is undefined', () => {
    const req = mockReq({});
    const res = mockRes();
    const next = vi.fn();

    admin(req, res, next);

    expect(res.state.statusCode).toBe(403);
  });
});
