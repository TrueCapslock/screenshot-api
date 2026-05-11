import db from './db/knex.js';
import config from './config.js';
import { deleteFile } from './services/storage.js';

let intervalHandle = null;

export async function cleanupOldScreenshots() {
  const retentionMs = config.screenshotRetentionHours * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - retentionMs).toISOString();

  try {
    const old = await db('screenshots').where('created_at', '<', cutoff).select('id', 'storage_path');

    if (old.length === 0) return;

    for (const s of old) {
      if (s.storage_path) {
        await deleteFile(s.storage_path);
      }
    }

    const ids = old.map((s) => s.id);
    await db('screenshots').whereIn('id', ids).del();

    console.log(`Cleanup: removed ${old.length} screenshots older than ${config.screenshotRetentionHours}h`);
  } catch (err) {
    console.error('Cleanup error:', err);
  }
}

export function startCleanup() {
  cleanupOldScreenshots();
  intervalHandle = setInterval(cleanupOldScreenshots, 15 * 60 * 1000);
}

export function stopCleanup() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
