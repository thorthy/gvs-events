// File storage: event folders, streaming uploads with hashing, HTTP range streaming.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { mimeOf } from './naming.js';

export class FileStorage {
  constructor(root) {
    this.root = path.resolve(root);
  }

  eventDir(slug) { return path.join(this.root, 'eventos', slug); }
  filesDir(slug) { return path.join(this.eventDir(slug), 'arquivos'); }
  versionsDir(slug) { return path.join(this.eventDir(slug), 'versoes'); }
  derivedDir(slug) { return path.join(this.eventDir(slug), 'derivados'); }
  thumbsDir(slug) { return path.join(this.eventDir(slug), 'miniaturas'); }
  clipsDir(slug) { return path.join(this.eventDir(slug), 'cortes'); }
  exportsDir(slug) { return path.join(this.eventDir(slug), 'exportacoes'); }
  trashDir(slug) { return path.join(this.eventDir(slug), 'lixeira'); }
  tmpDir() { return path.join(this.root, '.tmp'); }
  backupsDir() { return path.join(this.root, 'backups'); }

  async ensureEvent(slug) {
    for (const dir of [this.filesDir(slug), this.versionsDir(slug), this.derivedDir(slug), this.thumbsDir(slug), this.clipsDir(slug), this.exportsDir(slug), this.trashDir(slug)]) {
      await fsp.mkdir(dir, { recursive: true });
    }
  }

  async ensureBase() {
    await fsp.mkdir(this.tmpDir(), { recursive: true });
    await fsp.mkdir(this.backupsDir(), { recursive: true });
  }

  // Streams a readable (e.g. request body) into a temp file, hashing on the way.
  async receiveStream(readable, { maxBytes = Infinity } = {}) {
    await fsp.mkdir(this.tmpDir(), { recursive: true });
    const tmpPath = path.join(this.tmpDir(), `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const hash = createHash('sha256');
    let size = 0;
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        size += chunk.length;
        if (size > maxBytes) return cb(new Error('Arquivo maior que o limite permitido'));
        hash.update(chunk);
        cb(null, chunk);
      },
    });
    try {
      await pipeline(readable, counter, fs.createWriteStream(tmpPath));
    } catch (err) {
      await fsp.rm(tmpPath, { force: true });
      throw err;
    }
    return { tmpPath, size, sha256: hash.digest('hex') };
  }

  async hashFile(filePath) {
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of fs.createReadStream(filePath)) { hash.update(chunk); size += chunk.length; }
    return { sha256: hash.digest('hex'), size };
  }

  // Moves a file, falling back to copy+delete across devices.
  async moveFile(from, to) {
    await fsp.mkdir(path.dirname(to), { recursive: true });
    try {
      await fsp.rename(from, to);
    } catch (err) {
      if (err.code !== 'EXDEV') throw err;
      await fsp.copyFile(from, to);
      await fsp.rm(from, { force: true });
    }
  }

  async copyFile(from, to) {
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.copyFile(from, to);
  }

  // Hard-link when possible (same volume), otherwise copy.
  async linkOrCopy(from, to) {
    await fsp.mkdir(path.dirname(to), { recursive: true });
    try {
      await fsp.link(from, to);
    } catch {
      await fsp.copyFile(from, to);
    }
  }

  async uniquePath(dir, fileName) {
    const ext = path.extname(fileName);
    const stem = fileName.slice(0, fileName.length - ext.length);
    let candidate = path.join(dir, fileName);
    let i = 2;
    while (await exists(candidate)) {
      candidate = path.join(dir, `${stem}-${i}${ext}`);
      i++;
    }
    return candidate;
  }

  async removeQuiet(filePath) {
    if (!filePath) return;
    await fsp.rm(filePath, { force: true }).catch(() => {});
  }

  async moveToTrash(slug, filePath) {
    if (!filePath || !(await exists(filePath))) return null;
    const dest = await this.uniquePath(this.trashDir(slug), path.basename(filePath));
    await this.moveFile(filePath, dest);
    return dest;
  }

  async emptyTrash(slug) {
    const dir = this.trashDir(slug);
    let count = 0;
    if (!(await exists(dir))) return 0;
    for (const entry of await fsp.readdir(dir)) {
      await fsp.rm(path.join(dir, entry), { recursive: true, force: true });
      count++;
    }
    return count;
  }

  async dirSize(dir) {
    let total = 0;
    if (!(await exists(dir))) return 0;
    const stack = [dir];
    while (stack.length) {
      const current = stack.pop();
      for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.isFile()) total += (await fsp.stat(full)).size;
      }
    }
    return total;
  }
}

export async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

function contentDisposition(type, fileName) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

// Streams a file with HTTP Range support (needed for video seeking).
export async function sendFile(req, res, filePath, { fileName, download = false, mime, cache = false } = {}) {
  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Arquivo não encontrado no disco' }));
    return;
  }
  const name = fileName || path.basename(filePath);
  const headers = {
    'Content-Type': mime || mimeOf(name),
    'Accept-Ranges': 'bytes',
    'Content-Disposition': contentDisposition(download ? 'attachment' : 'inline', name),
    'Last-Modified': stat.mtime.toUTCString(),
    'Cache-Control': cache ? 'private, max-age=3600' : 'no-cache',
  };
  const range = req.headers.range;
  let start = 0;
  let end = stat.size - 1;
  let status = 200;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m && (m[1] !== '' || m[2] !== '')) {
      if (m[1] === '') {
        const suffix = Number(m[2]);
        start = Math.max(0, stat.size - suffix);
      } else {
        start = Number(m[1]);
        if (m[2] !== '') end = Math.min(Number(m[2]), stat.size - 1);
      }
      if (start > end || start >= stat.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        res.end();
        return;
      }
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    }
  }
  headers['Content-Length'] = end - start + 1;
  res.writeHead(status, headers);
  if (req.method === 'HEAD') { res.end(); return; }
  const stream = fs.createReadStream(filePath, { start, end });
  stream.on('error', () => { if (!res.headersSent) res.writeHead(500); res.end(); });
  req.on('close', () => stream.destroy());
  stream.pipe(res);
}
