// HTTP server: static front-end + JSON API.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { FileStorage, sendFile } from './files.js';
import { Media } from './media.js';
import { JobQueue } from './jobs.js';
import { Library } from './library.js';
import { buildApi } from './api.js';
import { HttpError } from './errors.js';
import { backupIfStale } from './backup.js';
import { mimeOf } from './naming.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

export async function createApp({ libraryDir, token = '', quiet = false } = {}) {
  const root = path.resolve(libraryDir || process.env.GVS_LIBRARY || 'biblioteca');
  const storage = new FileStorage(root);
  await storage.ensureBase();
  const store = new Store(path.join(root, 'biblioteca.json'));
  store.load();
  const media = new Media();
  await media.ready;
  const jobs = new JobQueue({ concurrency: 2 });
  const library = new Library({ store, storage, media, jobs });
  const api = buildApi({ library, jobs, media, store, storage, version: pkg.version });
  const log = quiet ? () => {} : (...a) => console.log(...a);

  // Re-analyze assets whose analysis never finished (e.g. server stopped mid-way).
  for (const asset of store.data.assets) if (!asset.analyzed) library.scheduleAnalysis(asset);
  backupIfStale(store, storage).then((b) => { if (b) log(`[backup] cópia de segurança criada em ${b.file}`); }).catch(() => {});

  const authorized = (req, url) => {
    if (!token) return true;
    const header = req.headers.authorization || '';
    if (header === `Bearer ${token}`) return true;
    if (url.searchParams.get('token') === token) return true;
    const cookie = req.headers.cookie || '';
    return cookie.split(';').some((c) => c.trim() === `gvs_token=${encodeURIComponent(token)}`);
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    try {
      if (pathname === '/api/auth/login' && req.method === 'POST') {
        const body = await readJson(req);
        if (!token || body.token === token) {
          res.setHeader('Set-Cookie', `gvs_token=${encodeURIComponent(body.token || '')}; Path=/; SameSite=Lax; HttpOnly`);
          return send(res, 200, { ok: true });
        }
        return send(res, 401, { error: 'Token inválido' });
      }
      if (pathname === '/api/auth/status') return send(res, 200, { required: Boolean(token), ok: authorized(req, url) });
      if (pathname.startsWith('/api/')) {
        if (!authorized(req, url)) return send(res, 401, { error: 'Não autorizado. Informe o token de acesso.' });
        const match = api.match(req.method === 'HEAD' ? 'GET' : req.method, pathname);
        if (!match) return send(res, 404, { error: `Rota não encontrada: ${req.method} ${pathname}` });
        if (match.methodNotAllowed) return send(res, 405, { error: 'Método não permitido' });
        const ctx = {
          req, res, params: match.params, query: url.searchParams, handled: false,
          user: decodeUser(req.headers['x-user']),
          body: () => readJson(req),
        };
        const result = await match.handler(ctx);
        if (!ctx.handled) send(res, 200, result ?? { ok: true });
        return;
      }
      await serveStatic(req, res, pathname);
    } catch (err) {
      if (res.headersSent) { res.destroy(); return; }
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) console.error(`[erro] ${req.method} ${pathname}:`, err);
      send(res, status, { error: err.message || 'Erro interno', details: err.details });
    }
  });
  server.requestTimeout = 0;
  server.headersTimeout = 120000;

  return {
    server, library, jobs, media, store, storage, root,
    start({ port = 3210, host = '0.0.0.0' } = {}) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve(server.address()));
      });
    },
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      await store.flush();
    },
  };
}

function decodeUser(value) {
  if (!value) return '';
  try { return decodeURIComponent(String(value)).slice(0, 60); } catch { return String(value).slice(0, 60); }
}

export function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(json), 'Cache-Control': 'no-store' });
  res.end(json);
}

export function readJson(req, { limit = 10 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Corpo da requisição muito grande')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'JSON inválido')); }
    });
    req.on('error', reject);
  });
}

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const full = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!full.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'Acesso negado' });
  let st = await fsp.stat(full).catch(() => null);
  if (st && st.isDirectory()) { st = null; }
  if (!st) {
    if (path.extname(rel)) return send(res, 404, { error: 'Arquivo não encontrado' });
    return sendFile(req, res, path.join(PUBLIC_DIR, 'index.html'), { mime: 'text/html; charset=utf-8' });
  }
  await sendFile(req, res, full, { mime: mimeOf(full) });
}
