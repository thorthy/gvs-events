// Scans a folder for supported media files and suggests which session they belong to.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { kindFromName, isSupportedExt, normalizeForSearch } from './naming.js';

const IGNORED_DIRS = new Set(['node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information', '.Trashes', '__MACOSX']);

export async function scanFolder(dir, { recursive = true, maxFiles = 5000 } = {}) {
  const root = path.resolve(dir);
  const stat = await fsp.stat(root);
  if (!stat.isDirectory()) throw new Error('O caminho informado não é uma pasta');
  const files = [];
  const stack = [root];
  while (stack.length && files.length < maxFiles) {
    const current = stack.pop();
    let entries;
    try { entries = await fsp.readdir(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.startsWith('~$')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (recursive && !IGNORED_DIRS.has(entry.name)) stack.push(full);
        continue;
      }
      if (!entry.isFile() || !isSupportedExt(entry.name)) continue;
      const st = await fsp.stat(full).catch(() => null);
      if (!st) continue;
      files.push({ path: full, relative: path.relative(root, full), name: entry.name, size: st.size, mtime: st.mtime.toISOString(), kind: kindFromName(entry.name) });
    }
  }
  files.sort((a, b) => a.relative.localeCompare(b.relative));
  return { root, files, truncated: files.length >= maxFiles };
}

function tokens(str) {
  return normalizeForSearch(str).split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
}

// Suggests a session for a file name using speaker names, session titles and folder names.
export function suggestSession(fileRelativePath, sessions, speakers) {
  const hay = tokens(fileRelativePath.replace(/\.[^.]+$/, ''));
  if (!hay.length) return null;
  const haySet = new Set(hay);
  let best = null;
  for (const s of sessions) {
    let score = 0;
    const titleTokens = tokens(s.title);
    const titleHits = titleTokens.filter((t) => haySet.has(t)).length;
    if (titleTokens.length) score += (titleHits / titleTokens.length) * 2 + titleHits * 0.3;
    for (const id of s.speakerIds || []) {
      const sp = speakers.find((x) => x.id === id);
      if (!sp) continue;
      const nameTokens = tokens(sp.name);
      const hits = nameTokens.filter((t) => haySet.has(t)).length;
      if (hits >= 2 || (hits === 1 && nameTokens.length === 1)) score += 3;
      else if (hits === 1) score += 1;
    }
    if (score > 0 && (!best || score > best.score)) best = { sessionId: s.id, score, title: s.title };
  }
  return best && best.score >= 1.2 ? best : null;
}
