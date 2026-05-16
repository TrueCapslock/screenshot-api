import db from './db/knex.js';
import fs from 'fs/promises';
import path from 'path';
import config from './config.js';
import { deleteFile } from './services/storage.js';

export async function cleanupOrphans() {
  try {
    await removeOrphanRecords();
    await removeHiddenOrphans();
    await cleanLocalOrphanFiles();
  } catch (err) {
    console.error('Orphan cleanup error:', err);
  }
}

async function removeOrphanRecords() {
  const orphans = await db('screenshots')
    .whereNotNull('api_key_id')
    .whereNotIn('api_key_id', db('api_keys').select('id'))
    .select('id', 'storage_path', 'diff_storage_path');

  if (orphans.length === 0) return;

  for (const s of orphans) {
    if (s.storage_path) await deleteFile(s.storage_path).catch(() => {});
    if (s.diff_storage_path) await deleteFile(s.diff_storage_path).catch(() => {});
  }

  await db('screenshots')
    .whereIn(
      'id',
      orphans.map((s) => s.id),
    )
    .del();
  console.log(`Orphan cleanup: removed ${orphans.length} screenshot records with missing API keys`);
}

async function removeHiddenOrphans() {
  const orphans = await db('screenshots')
    .where('hidden', true)
    .where(function () {
      this.whereNotIn('id', function () {
        this.select('screenshot_id').from('alert_runs').whereNotNull('screenshot_id');
      }).andWhere('is_baseline', false);
    })
    .orWhere(function () {
      this.where('hidden', true)
        .where('is_baseline', true)
        .whereNotExists(function () {
          this.select(db.raw('1'))
            .from('alerts')
            .join('api_keys', 'api_keys.user_id', 'alerts.user_id')
            .whereRaw('api_keys.id = screenshots.api_key_id')
            .whereRaw('alerts.url = screenshots.url');
        });
    })
    .select('id', 'storage_path', 'diff_storage_path');

  if (orphans.length === 0) return;

  for (const s of orphans) {
    if (s.storage_path) await deleteFile(s.storage_path).catch(() => {});
    if (s.diff_storage_path) await deleteFile(s.diff_storage_path).catch(() => {});
  }

  await db('screenshots')
    .whereIn(
      'id',
      orphans.map((s) => s.id),
    )
    .del();
  console.log(`Orphan cleanup: removed ${orphans.length} hidden orphan screenshots (no matching alert)`);
}

async function cleanLocalOrphanFiles() {
  if (config.storage.endpoint) return;

  const dir = config.storage.localDir;
  let entries;
  try {
    entries = await fs.readdir(dir, { recursive: true });
  } catch {
    return;
  }

  const rows = await db('screenshots')
    .whereNotNull('storage_path')
    .select('storage_path')
    .union(function () {
      this.from('screenshots').whereNotNull('diff_storage_path').select('diff_storage_path');
    });

  const referenced = new Set();
  for (const r of rows) {
    const val = Object.values(r)[0];
    if (val) referenced.add(path.relative(dir, val));
  }

  for (const entry of entries) {
    if (referenced.has(entry)) continue;
    const fullPath = path.join(dir, entry);
    try {
      const stat = await fs.stat(fullPath);
      if (stat.isFile()) {
        await fs.unlink(fullPath);
        console.log(`Orphan cleanup: deleted orphan file ${entry}`);
      }
    } catch {
      // file removed between readdir and stat, or intermediate dir entry
    }
  }
}
