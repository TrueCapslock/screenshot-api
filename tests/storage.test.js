import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

// Must set before any import of config/storage modules
process.env.LOCAL_STORAGE_DIR = path.join(os.tmpdir(), 'screenshot-api-test-' + crypto.randomUUID());
process.env.STORAGE_ENDPOINT = '';
process.env.STORAGE_ACCESS_KEY = '';
process.env.STORAGE_SECRET_KEY = '';

let saveFile, readFile, deleteFile;

beforeAll(async () => {
  const mod = await import('../src/services/storage.js');
  saveFile = mod.saveFile;
  readFile = mod.readFile;
  deleteFile = mod.deleteFile;
  await fs.mkdir(process.env.LOCAL_STORAGE_DIR, { recursive: true });
});

afterAll(async () => {
  await fs.rm(process.env.LOCAL_STORAGE_DIR, { recursive: true, force: true });
});

describe('storage service (local disk)', () => {
  it('saves a file to disk', async () => {
    const filename = 'test-' + crypto.randomUUID() + '.png';
    const buffer = Buffer.from('fake-image-data');
    const filePath = await saveFile(filename, buffer);
    expect(filePath).toBe(path.join(process.env.LOCAL_STORAGE_DIR, filename));
    const exists = await fs.access(filePath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it('reads a saved file', async () => {
    const filename = 'test-' + crypto.randomUUID() + '.txt';
    const buffer = Buffer.from('hello storage');
    await saveFile(filename, buffer);
    const data = await readFile(path.join(process.env.LOCAL_STORAGE_DIR, filename));
    expect(Buffer.from(data).toString()).toBe('hello storage');
  });

  it('deletes a saved file', async () => {
    const filename = 'test-' + crypto.randomUUID() + '.txt';
    const buffer = Buffer.from('delete me');
    const filePath = await saveFile(filename, buffer);
    await deleteFile(filePath);
    const exists = await fs.access(filePath).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });

  it('handles deleting a nonexistent file gracefully', async () => {
    const fakePath = path.join(process.env.LOCAL_STORAGE_DIR, 'nonexistent-' + crypto.randomUUID() + '.txt');
    await expect(deleteFile(fakePath)).resolves.not.toThrow();
  });

  it('saves a file in a userId subdirectory', async () => {
    const userId = 'user-' + crypto.randomUUID();
    const filename = 'test-' + crypto.randomUUID() + '.png';
    const buffer = Buffer.from('user-specific-data');
    const filePath = await saveFile(filename, buffer, userId);
    const expected = path.join(process.env.LOCAL_STORAGE_DIR, userId, filename);
    expect(filePath).toBe(expected);
    const exists = await fs.access(expected).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it('saves multiple files for the same userId in the same subdirectory', async () => {
    const userId = 'user-' + crypto.randomUUID();
    const file1 = await saveFile('a-' + crypto.randomUUID() + '.txt', Buffer.from('a'), userId);
    const file2 = await saveFile('b-' + crypto.randomUUID() + '.txt', Buffer.from('b'), userId);
    expect(path.dirname(file1)).toBe(path.dirname(file2));
    const exists1 = await fs.access(file1).then(() => true).catch(() => false);
    const exists2 = await fs.access(file2).then(() => true).catch(() => false);
    expect(exists1).toBe(true);
    expect(exists2).toBe(true);
  });

  it('separates files for different userIds into different subdirectories', async () => {
    const userA = 'user-a-' + crypto.randomUUID();
    const userB = 'user-b-' + crypto.randomUUID();
    const fileA = await saveFile('test.txt', Buffer.from('a'), userA);
    const fileB = await saveFile('test.txt', Buffer.from('b'), userB);
    expect(path.dirname(fileA)).not.toBe(path.dirname(fileB));
  });

  it('saves without userId in the base directory', async () => {
    const filename = 'root-' + crypto.randomUUID() + '.txt';
    const buffer = Buffer.from('root file');
    const filePath = await saveFile(filename, buffer);
    expect(path.dirname(filePath)).toBe(process.env.LOCAL_STORAGE_DIR);
    const exists = await fs.access(filePath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });
});
