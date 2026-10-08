import fsp from 'node:fs/promises';
import path from 'node:path';

export async function createBackup(store, storage, { keep = 30 } = {}) {
  await store.flush();
  const dir = storage.backupsDir();
  await fsp.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(dir, `biblioteca-${stamp}.json`);
  await fsp.copyFile(store.filePath, dest);
  const all = (await fsp.readdir(dir)).filter((f) => /^biblioteca-.*\.json$/.test(f)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - keep))) await fsp.rm(path.join(dir, old), { force: true });
  return { file: dest, kept: Math.min(all.length, keep) };
}

export async function listBackups(storage) {
  const dir = storage.backupsDir();
  try {
    const names = (await fsp.readdir(dir)).filter((f) => /^biblioteca-.*\.json$/.test(f)).sort().reverse();
    const out = [];
    for (const name of names) {
      const st = await fsp.stat(path.join(dir, name));
      out.push({ name, path: path.join(dir, name), size: st.size, mtime: st.mtime.toISOString() });
    }
    return out;
  } catch {
    return [];
  }
}

export async function backupIfStale(store, storage, { maxAgeHours = 24 } = {}) {
  const backups = await listBackups(storage);
  const latest = backups[0];
  if (latest && Date.now() - Date.parse(latest.mtime) < maxAgeHours * 3600 * 1000) return null;
  return createBackup(store, storage);
}
