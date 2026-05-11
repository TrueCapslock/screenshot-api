import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockDbFn, mockDb, mockDeleteFile } = vi.hoisted(() => {
  const fn = {
    where: vi.fn().mockReturnThis(),
    select: vi.fn().mockResolvedValue([]),
    whereIn: vi.fn().mockReturnThis(),
    del: vi.fn().mockResolvedValue(1),
  };

  return {
    mockDbFn: fn,
    mockDb: Object.assign(
      (table) => fn,
      fn,
    ),
    mockDeleteFile: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../src/db/knex.js', () => ({ default: mockDb }));

vi.mock('../src/services/storage.js', () => ({
  deleteFile: (...args) => mockDeleteFile(...args),
}));

import { cleanupOldScreenshots, startCleanup, stopCleanup } from '../src/cleanup.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockDbFn.select.mockResolvedValue([]);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('cleanupOldScreenshots', () => {
  it('does nothing when no old screenshots exist', async () => {
    await cleanupOldScreenshots();
    expect(mockDbFn.select).toHaveBeenCalledOnce();
    expect(mockDbFn.del).not.toHaveBeenCalled();
  });

  it('deletes old screenshots and their storage files', async () => {
    const oldScreenshots = [
      { id: '1', storage_path: '/screenshots/foo.png' },
      { id: '2', storage_path: '/screenshots/bar.png' },
    ];
    mockDbFn.select.mockResolvedValue(oldScreenshots);

    await cleanupOldScreenshots();

    expect(mockDeleteFile).toHaveBeenCalledTimes(2);
    expect(mockDeleteFile).toHaveBeenCalledWith('/screenshots/foo.png');
    expect(mockDeleteFile).toHaveBeenCalledWith('/screenshots/bar.png');
    expect(mockDbFn.whereIn).toHaveBeenCalledWith('id', ['1', '2']);
    expect(mockDbFn.del).toHaveBeenCalledOnce();
  });

  it('handles screenshots without storage_path', async () => {
    const oldScreenshots = [
      { id: '1', storage_path: null },
      { id: '2', storage_path: undefined },
    ];
    mockDbFn.select.mockResolvedValue(oldScreenshots);

    await cleanupOldScreenshots();

    expect(mockDeleteFile).not.toHaveBeenCalled();
    expect(mockDbFn.del).toHaveBeenCalledOnce();
  });

  it('handles DB errors gracefully', async () => {
    mockDbFn.select.mockRejectedValue(new Error('DB down'));

    await expect(cleanupOldScreenshots()).resolves.not.toThrow();
  });
});

describe('startCleanup / stopCleanup', () => {
  afterEach(() => {
    stopCleanup();
    vi.useRealTimers();
  });

  it('calls cleanup immediately and sets an interval', async () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(global, 'setInterval');

    startCleanup();

    expect(mockDbFn.where).toHaveBeenCalledOnce();
    expect(mockDbFn.select).toHaveBeenCalledOnce();
    expect(setIntervalSpy).toHaveBeenCalledOnce();
  });
});
