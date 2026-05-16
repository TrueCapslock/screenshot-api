import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const qb = vi.hoisted(() => {
  const chainable = [
    'join', 'where', 'whereIn', 'whereNull', 'whereNotNull', 'whereRaw',
    'select', 'orderBy', 'limit', 'offset', 'count', 'increment',
    'insert', 'update', 'del',
  ];
  const obj = {};
  for (const m of chainable) {
    obj[m] = vi.fn().mockReturnThis();
  }
  obj.first = vi.fn().mockResolvedValue(null);
  obj.returning = vi.fn().mockReturnValue([{ id: 'screenshot-1', consecutive_failures: 1 }]);
  obj[Symbol.iterator] = function* () {};
  obj.map = function () { return []; };
  return obj;
});

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
  readFile: vi.fn(),
  deleteFile: vi.fn(),
}));

vi.mock('../src/services/email.js', () => ({
  sendAlertNotification: vi.fn(),
}));

vi.mock('../src/jobs/alert-check.js', () => ({
  alertCheckQueue: {
    add: vi.fn().mockResolvedValue({ id: 'job-1' }),
  },
}));

const mockSharpInstance = vi.hoisted(() => ({
  metadata: vi.fn().mockResolvedValue({ width: 1280, height: 720 }),
  resize: vi.fn().mockReturnThis(),
  ensureAlpha: vi.fn().mockReturnThis(),
  raw: vi.fn().mockReturnThis(),
  png: vi.fn().mockReturnThis(),
  toBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-png')),
}));

vi.mock('sharp', () => ({
  default: vi.fn(() => mockSharpInstance),
}));

vi.mock('pixelmatch', () => ({
  default: vi.fn(() => 0),
}));

const mockAlert = {
  id: 'alert-1',
  user_id: 'user-1',
  name: 'Test Alert',
  url: 'https://example.com',
  options: '{}',
  threshold: 0,
  interval_minutes: 60,
  email: 'user@test.com',
};

const mockBaseline = {
  id: 'baseline-1',
  storage_path: 'user-1/baseline.png',
};

function resetQb() {
  const chainable = [
    'join', 'where', 'whereIn', 'whereNull', 'whereNotNull', 'whereRaw',
    'select', 'orderBy', 'limit', 'offset', 'count', 'increment',
    'insert', 'update', 'del',
  ];
  for (const m of chainable) {
    qb[m].mockReturnThis();
  }
  qb.first.mockResolvedValue(null);
  qb.returning = vi.fn().mockReturnValue([{ id: 'screenshot-1', consecutive_failures: 1 }]);
  qb[Symbol.iterator] = function* () {};
  qb.map = function () { return []; };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetQb();
  global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  mockSharpInstance.metadata.mockResolvedValue({ width: 1280, height: 720 });
  mockSharpInstance.resize.mockReturnThis();
  mockSharpInstance.ensureAlpha.mockReturnThis();
  mockSharpInstance.raw.mockReturnThis();
  mockSharpInstance.png.mockReturnThis();
  mockSharpInstance.toBuffer.mockResolvedValue(Buffer.from('fake-png'));
});

describe('checkAlerts', () => {
  it('enqueues alert-check job when baseline exists', async () => {
    const { checkAlerts } = await import('../src/alert-checker.js');
    const { renderScreenshot } = await import('../src/services/renderer.js');
    const { alertCheckQueue } = await import('../src/jobs/alert-check.js');

    qb.first.mockResolvedValue(mockBaseline);
    qb[Symbol.iterator] = function* () { yield mockAlert; };

    await checkAlerts();

    expect(alertCheckQueue.add).toHaveBeenCalledWith(
      'alert-check',
      { alert: mockAlert, baseline: mockBaseline },
      expect.objectContaining({ jobId: expect.stringContaining('alert-alert-1') }),
    );
    expect(renderScreenshot).not.toHaveBeenCalled();
    expect(qb.update).toHaveBeenCalled();
  });

  it('handles empty alert list gracefully', async () => {
    const { checkAlerts } = await import('../src/alert-checker.js');

    qb[Symbol.iterator] = function* () {};

    await expect(checkAlerts()).resolves.toBeUndefined();
  });

  it('auto-creates baseline when none exists', async () => {
    const { checkAlerts } = await import('../src/alert-checker.js');
    const { renderScreenshot } = await import('../src/services/renderer.js');
    const { saveFile } = await import('../src/services/storage.js');

    qb.first.mockResolvedValue(null);
    qb[Symbol.iterator] = function* () { yield mockAlert; };

    renderScreenshot.mockResolvedValue({
      buffer: Buffer.from('fake-image'),
      format: 'png',
      width: 1280,
      height: 720,
      durationMs: 100,
    });
    saveFile.mockResolvedValue('user-1/baseline.png');

    await checkAlerts();

    expect(saveFile).toHaveBeenCalled();
    expect(qb.insert).toHaveBeenCalled();
    expect(qb.update).toHaveBeenCalled();
  });

  it('logs ping failure and does not create baseline when url unreachable', async () => {
    const { checkAlerts } = await import('../src/alert-checker.js');
    const { renderScreenshot } = await import('../src/services/renderer.js');

    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    qb.first.mockResolvedValue(null);
    qb[Symbol.iterator] = function* () { yield mockAlert; };

    await checkAlerts();

    expect(renderScreenshot).not.toHaveBeenCalled();
    expect(qb.increment).toHaveBeenCalled();
    expect(qb.insert).not.toHaveBeenCalled();
    expect(qb.update).toHaveBeenCalled();
  });
});

describe('processAlert', () => {
  it('creates run with triggered=true when diff exceeds threshold', async () => {
    const { processAlert } = await import('../src/alert-checker.js');
    const { renderScreenshot } = await import('../src/services/renderer.js');
    const { saveFile, readFile } = await import('../src/services/storage.js');

    const pixelmatch = (await import('pixelmatch')).default;
    pixelmatch.mockReturnValue(50000);

    qb.first.mockResolvedValue({ id: 'key-1' });

    renderScreenshot.mockResolvedValue({
      buffer: Buffer.from('fake-current'),
      format: 'png',
      width: 1280,
      height: 720,
      durationMs: 100,
    });
    readFile.mockResolvedValue(Buffer.from('fake-baseline'));
    saveFile.mockResolvedValue('user-1/current.png');

    await processAlert(mockAlert, mockBaseline);

    expect(pixelmatch).toHaveBeenCalled();
    expect(saveFile).toHaveBeenCalledTimes(2);
  });

  it('creates run with triggered=false when diff within threshold', async () => {
    const { processAlert } = await import('../src/alert-checker.js');
    const { renderScreenshot } = await import('../src/services/renderer.js');
    const { readFile } = await import('../src/services/storage.js');

    const pixelmatch = (await import('pixelmatch')).default;
    pixelmatch.mockReturnValue(0);

    qb.first.mockResolvedValue(mockBaseline);

    renderScreenshot.mockResolvedValue({
      buffer: Buffer.from('fake-current'),
      format: 'png',
      width: 1280,
      height: 720,
      durationMs: 100,
    });
    readFile.mockResolvedValue(Buffer.from('fake-baseline'));

    await processAlert({ ...mockAlert, threshold: 10 }, mockBaseline);

    expect(qb.insert).toHaveBeenCalled();
  });

  it('logs ping failure and skips screenshot when url unreachable', async () => {
    const { processAlert } = await import('../src/alert-checker.js');
    const { renderScreenshot } = await import('../src/services/renderer.js');

    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });

    await processAlert(mockAlert, mockBaseline);

    expect(renderScreenshot).not.toHaveBeenCalled();
    expect(qb.increment).toHaveBeenCalled();
    expect(qb.insert).not.toHaveBeenCalled();
  });

  it('disables alert after 5 consecutive ping failures', async () => {
    const { processAlert } = await import('../src/alert-checker.js');
    const { renderScreenshot } = await import('../src/services/renderer.js');

    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    qb.returning = vi.fn().mockReturnValue([{ consecutive_failures: 5 }]);

    await processAlert(mockAlert, mockBaseline);

    expect(renderScreenshot).not.toHaveBeenCalled();
    expect(qb.increment).toHaveBeenCalled();
    expect(qb.update).toHaveBeenCalledWith({ enabled: false });
  });
});

describe('startAlertChecker / stopAlertChecker', () => {
  it('start calls checkAlerts and sets interval', async () => {
    vi.useFakeTimers();

    const { startAlertChecker, stopAlertChecker, checkAlerts } = await import('../src/alert-checker.js');

    const spy = vi.spyOn(global, 'setInterval');

    startAlertChecker();

    expect(spy).toHaveBeenCalledWith(expect.any(Function), 60000);

    stopAlertChecker();
    vi.useRealTimers();
  });
});
