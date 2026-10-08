// REST API routes.
import path from 'node:path';
import os from 'node:os';
import { Router } from './router.js';
import { HttpError, badRequest, notFound } from './errors.js';
import { sendFile, exists } from './files.js';
import { parseProgram } from './program.js';
import { scanFolder, suggestSession } from './scan.js';
import { exportOperatorFolder, operatorEntries, programCsv, materialsCsv, clipsCsv, streamAssetsZip, sessionFolderName } from './exporter.js';
import { createBackup, listBackups } from './backup.js';
import { KINDS, ASSET_STATUSES, SESSION_TYPES, EVENT_STATUSES, CLIP_STATUSES, CLIP_FORMATS, CLIP_MODES, slugify, humanComponent } from './naming.js';

const MAX_UPLOAD = Number(process.env.GVS_MAX_UPLOAD_GB || 64) * 1024 ** 3;

export function buildApi({ library, jobs, media, store, storage, version }) {
  const r = new Router();

  r.get('/api/system', async () => ({
    version,
    node: process.version,
    platform: process.platform,
    libraryPath: storage.root,
    tools: media.status(),
    addresses: lanAddresses(),
    settings: library.getSettings(),
    constants: { kinds: KINDS, assetStatuses: ASSET_STATUSES, sessionTypes: SESSION_TYPES, eventStatuses: EVENT_STATUSES, clipStatuses: CLIP_STATUSES, clipFormats: CLIP_FORMATS, clipModes: CLIP_MODES },
  }));

  r.get('/api/settings', async () => library.getSettings());
  r.patch('/api/settings', async (ctx) => library.updateSettings(await ctx.body()));

  r.get('/api/search', async (ctx) => library.search(ctx.query.get('q') || '', { limit: Number(ctx.query.get('limit')) || 50 }));

  r.get('/api/jobs', async (ctx) => jobs.list({ eventId: ctx.query.get('eventId') || undefined, limit: Number(ctx.query.get('limit')) || 100 }));
  r.get('/api/jobs/:id', async (ctx) => jobs.get(ctx.params.id) || notFoundThrow('Job'));

  r.get('/api/backups', async () => listBackups(storage));
  r.post('/api/backups', async () => createBackup(store, storage));

  // ---- events ----
  r.get('/api/events', async () => library.listEvents());
  r.post('/api/events', async (ctx) => library.createEvent(await ctx.body(), ctx.user));
  r.get('/api/events/:id', async (ctx) => library.eventBundle(ctx.params.id));
  r.patch('/api/events/:id', async (ctx) => library.updateEvent(ctx.params.id, await ctx.body(), ctx.user));
  r.delete('/api/events/:id', async (ctx) => library.deleteEvent(ctx.params.id, ctx.user));
  r.get('/api/events/:id/activity', async (ctx) => library.activity(ctx.params.id, { limit: Number(ctx.query.get('limit')) || 200 }));
  r.delete('/api/events/:id/trash', async (ctx) => {
    const e = library.getEvent(ctx.params.id);
    const removed = await storage.emptyTrash(e.slug);
    library.log(e.id, ctx.user, 'esvaziou a lixeira', 'evento', e.id, `${removed} itens`);
    return { removed };
  });
  r.get('/api/events/:id/storage', async (ctx) => {
    const e = library.getEvent(ctx.params.id);
    return {
      files: await storage.dirSize(storage.filesDir(e.slug)),
      versions: await storage.dirSize(storage.versionsDir(e.slug)),
      derived: await storage.dirSize(storage.derivedDir(e.slug)),
      trash: await storage.dirSize(storage.trashDir(e.slug)),
      exports: await storage.dirSize(storage.exportsDir(e.slug)),
      path: storage.eventDir(e.slug),
    };
  });

  // ---- rooms / speakers ----
  r.post('/api/events/:id/rooms', async (ctx) => library.createRoom(ctx.params.id, await ctx.body(), ctx.user));
  r.patch('/api/rooms/:id', async (ctx) => library.updateRoom(ctx.params.id, await ctx.body(), ctx.user));
  r.delete('/api/rooms/:id', async (ctx) => library.deleteRoom(ctx.params.id, ctx.user));
  r.post('/api/events/:id/speakers', async (ctx) => library.createSpeaker(ctx.params.id, await ctx.body(), ctx.user));
  r.patch('/api/speakers/:id', async (ctx) => library.updateSpeaker(ctx.params.id, await ctx.body(), ctx.user));
  r.delete('/api/speakers/:id', async (ctx) => library.deleteSpeaker(ctx.params.id, ctx.user));

  // ---- sessions ----
  r.post('/api/events/:id/sessions', async (ctx) => library.createSession(ctx.params.id, await ctx.body(), ctx.user));
  r.patch('/api/sessions/:id', async (ctx) => library.updateSession(ctx.params.id, await ctx.body(), ctx.user));
  r.delete('/api/sessions/:id', async (ctx) => library.deleteSession(ctx.params.id, ctx.user));
  r.post('/api/sessions/:id/duplicate', async (ctx) => library.duplicateSession(ctx.params.id, ctx.user));
  r.post('/api/sessions/:id/checklist', async (ctx) => library.addChecklistItem(ctx.params.id, (await ctx.body()).text, ctx.user));
  r.patch('/api/sessions/:id/checklist/:itemId', async (ctx) => library.updateChecklistItem(ctx.params.id, ctx.params.itemId, await ctx.body(), ctx.user));
  r.delete('/api/sessions/:id/checklist/:itemId', async (ctx) => library.deleteChecklistItem(ctx.params.id, ctx.params.itemId));
  r.post('/api/events/:id/checklist/apply', async (ctx) => library.applyChecklistTemplate(ctx.params.id, await ctx.body(), ctx.user));

  r.post('/api/events/:id/program/preview', async (ctx) => {
    const event = library.getEvent(ctx.params.id);
    const body = await ctx.body();
    return parseProgram(body.text || '', { defaultDate: body.defaultDate || event.startDate });
  });
  r.post('/api/events/:id/program/import', async (ctx) => {
    const event = library.getEvent(ctx.params.id);
    const body = await ctx.body();
    const rows = Array.isArray(body.rows) ? body.rows : parseProgram(body.text || '', { defaultDate: body.defaultDate || event.startDate }).rows;
    const created = [];
    for (const row of rows) {
      const room = row.room ? library.findOrCreateRoom(event.id, row.room, ctx.user) : null;
      const speakerIds = (row.speakers || []).map((n) => library.findOrCreateSpeaker(event.id, n, ctx.user)?.id).filter(Boolean);
      created.push(library.createSession(event.id, { ...row, roomId: room?.id || null, speakerIds }, ctx.user));
    }
    library.log(event.id, ctx.user, 'importou programação', 'evento', event.id, `${created.length} sessões`);
    return { created: created.length, sessions: created };
  });

  // ---- assets ----
  r.put('/api/events/:id/assets', async (ctx) => {
    const event = library.getEvent(ctx.params.id);
    const q = ctx.query;
    const originalName = decodeURIComponent(q.get('filename') || '') || 'arquivo';
    const received = await storage.receiveStream(ctx.req, { maxBytes: MAX_UPLOAD });
    if (!received.size) { await storage.removeQuiet(received.tmpPath); throw badRequest('Arquivo vazio'); }
    try {
      return await library.addAsset({
        eventId: event.id, tmpPath: received.tmpPath, originalName, size: received.size, sha256: received.sha256,
        sessionId: q.get('sessionId') || null, speakerId: q.get('speakerId') || null, kind: q.get('kind') || undefined,
        status: q.get('status') || undefined, tags: q.get('tags') || '', notes: q.get('notes') || '', user: ctx.user,
      });
    } catch (err) {
      await storage.removeQuiet(received.tmpPath);
      throw err;
    }
  });
  r.patch('/api/assets/:id', async (ctx) => library.updateAsset(ctx.params.id, await ctx.body(), ctx.user));
  r.delete('/api/assets/:id', async (ctx) => library.deleteAsset(ctx.params.id, ctx.user));
  r.put('/api/assets/:id/versions', async (ctx) => {
    library.getAsset(ctx.params.id);
    const originalName = decodeURIComponent(ctx.query.get('filename') || '') || 'arquivo';
    const received = await storage.receiveStream(ctx.req, { maxBytes: MAX_UPLOAD });
    if (!received.size) { await storage.removeQuiet(received.tmpPath); throw badRequest('Arquivo vazio'); }
    try {
      return await library.addAssetVersion(ctx.params.id, { tmpPath: received.tmpPath, originalName, size: received.size, sha256: received.sha256, note: ctx.query.get('note') || '', user: ctx.user });
    } catch (err) {
      await storage.removeQuiet(received.tmpPath);
      throw err;
    }
  });
  r.get('/api/assets/:id/file', async (ctx) => {
    const a = library.getAsset(ctx.params.id);
    ctx.handled = true;
    await sendFile(ctx.req, ctx.res, library.assetPath(a), { fileName: a.originalName, download: ctx.query.get('download') === '1', mime: a.mime });
  });
  r.get('/api/assets/:id/preview', async (ctx) => {
    const a = library.getAsset(ctx.params.id);
    ctx.handled = true;
    if (a.derived.pdf && ctx.query.get('kind') !== 'original') {
      await sendFile(ctx.req, ctx.res, library.assetDerivedPath(a, a.derived.pdf), { fileName: `${a.name}.pdf`, mime: 'application/pdf' });
    } else if (a.derived.proxy && ctx.query.get('kind') !== 'original') {
      await sendFile(ctx.req, ctx.res, library.assetDerivedPath(a, a.derived.proxy), { fileName: `${a.name}-previa.mp4`, mime: 'video/mp4' });
    } else {
      await sendFile(ctx.req, ctx.res, library.assetPath(a), { fileName: a.originalName, mime: a.mime });
    }
  });
  r.get('/api/assets/:id/thumb', async (ctx) => {
    const a = library.getAsset(ctx.params.id);
    ctx.handled = true;
    const p = library.assetThumbPath(a);
    if (!a.thumb || !(await exists(p))) { ctx.res.writeHead(404); ctx.res.end(); return; }
    await sendFile(ctx.req, ctx.res, p, { fileName: `${a.id}.jpg`, mime: 'image/jpeg', cache: true });
  });
  r.get('/api/assets/:id/versions/:vid/file', async (ctx) => {
    const a = library.getAsset(ctx.params.id);
    const v = a.versions.find((x) => x.id === ctx.params.vid);
    if (!v) throw notFound('Versão');
    ctx.handled = true;
    await sendFile(ctx.req, ctx.res, library.versionPath(a, v), { fileName: `v${v.version}-${v.originalName}`, download: ctx.query.get('download') === '1' });
  });
  r.post('/api/assets/:id/convert', async (ctx) => library.requestConversion(ctx.params.id, ctx.user));
  r.post('/api/assets/:id/pdf-backup', async (ctx) => library.promotePdfBackup(ctx.params.id, ctx.user));
  r.post('/api/assets/:id/proxy', async (ctx) => library.requestProxy(ctx.params.id, ctx.user));
  r.post('/api/assets/:id/analyze', async (ctx) => library.scheduleAnalysis(library.getAsset(ctx.params.id)));

  // ---- clips ----
  r.post('/api/events/:id/clips', async (ctx) => library.createClip(ctx.params.id, await ctx.body(), ctx.user));
  r.patch('/api/clips/:id', async (ctx) => library.updateClip(ctx.params.id, await ctx.body(), ctx.user));
  r.delete('/api/clips/:id', async (ctx) => library.deleteClip(ctx.params.id, { deleteOutput: ctx.query.get('deleteOutput') === '1' }, ctx.user));
  r.post('/api/clips/:id/render', async (ctx) => library.renderClip(ctx.params.id, ctx.user));

  // ---- scan / import from folder ----
  r.post('/api/events/:id/scan/preview', async (ctx) => {
    const bundle = library.eventBundle(ctx.params.id);
    const body = await ctx.body();
    if (!body.path) throw badRequest('Informe o caminho da pasta');
    let result;
    try {
      result = await scanFolder(body.path, { recursive: body.recursive !== false });
    } catch (err) {
      throw badRequest(`Não foi possível ler a pasta: ${err.message}`);
    }
    const known = new Set(bundle.assets.map((a) => a.sha256));
    const knownSizes = new Map(bundle.assets.map((a) => [a.size, a]));
    result.files = result.files.map((f) => ({
      ...f,
      suggestion: suggestSession(f.relative, bundle.sessions, bundle.speakers),
      maybeDuplicate: knownSizes.has(f.size) ? knownSizes.get(f.size).originalName : null,
    }));
    result.knownHashes = known.size;
    return result;
  });
  r.post('/api/events/:id/scan/import', async (ctx) => {
    const event = library.getEvent(ctx.params.id);
    const body = await ctx.body();
    if (!body.path || !Array.isArray(body.files) || !body.files.length) throw badRequest('Selecione ao menos um arquivo');
    const root = path.resolve(body.path);
    const assignments = body.assignments || {};
    const mode = body.mode === 'mover' ? 'mover' : 'copiar';
    const files = body.files.map((rel) => {
      const full = path.resolve(root, rel);
      if (!full.startsWith(root + path.sep) && full !== root) throw badRequest('Caminho inválido');
      return { rel, full };
    });
    const user = ctx.user;
    return jobs.add({
      type: 'importar', eventId: event.id, label: `Importar ${files.length} arquivo(s) de ${root}`,
      run: async (update) => {
        const created = [];
        const failed = [];
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          try {
            const asset = await library.addAsset({
              eventId: event.id, tmpPath: f.full, originalName: path.basename(f.rel), sessionId: assignments[f.rel] || body.sessionId || null,
              source: 'importacao', user, move: mode === 'mover', notes: body.notes || '',
            });
            created.push(asset.id);
          } catch (err) {
            failed.push({ file: f.rel, error: err.message });
          }
          update((i + 1) / files.length, { created: created.length, failed: failed.length });
        }
        library.log(event.id, user, 'importou pasta', 'evento', event.id, `${created.length} arquivos de ${root}`);
        return { created, failed };
      },
    });
  });

  // ---- exports ----
  r.post('/api/events/:id/export/operator', async (ctx) => {
    const event = library.getEvent(ctx.params.id);
    const body = await ctx.body();
    const user = ctx.user;
    return jobs.add({
      type: 'exportar', eventId: event.id, label: `Gerar pasta do operador de ${event.name}`,
      run: async (update) => {
        const result = await exportOperatorFolder(library, event.id, { dest: body.dest || undefined, include: body.include || 'aprovados', mode: body.mode || 'copiar', onProgress: update });
        library.log(event.id, user, 'exportou pasta do operador', 'evento', event.id, result.dest);
        return result;
      },
    });
  });
  r.get('/api/events/:id/export/operator/preview', async (ctx) => {
    const bundle = library.eventBundle(ctx.params.id);
    return operatorEntries(bundle, { include: ctx.query.get('include') || 'aprovados' }).map((e) => ({ assetId: e.asset.id, path: e.relativePath, size: e.asset.size }));
  });
  r.get('/api/events/:id/export/programacao.csv', async (ctx) => csv(ctx, programCsv(library.eventBundle(ctx.params.id)), 'programacao.csv'));
  r.get('/api/events/:id/export/materiais.csv', async (ctx) => csv(ctx, materialsCsv(library.eventBundle(ctx.params.id)), 'materiais.csv'));
  r.get('/api/events/:id/export/cortes.csv', async (ctx) => csv(ctx, clipsCsv(library.eventBundle(ctx.params.id)), 'cortes.csv'));
  r.get('/api/events/:id/export/zip', async (ctx) => {
    const bundle = library.eventBundle(ctx.params.id);
    const entries = operatorEntries(bundle, { include: ctx.query.get('include') || 'aprovados' });
    ctx.handled = true;
    await streamAssetsZip(library, ctx.res, entries, {
      fileName: `${slugify(bundle.event.name)}-materiais.zip`,
      extraFiles: [{ name: 'programacao.csv', content: programCsv(bundle) }, { name: 'materiais.csv', content: materialsCsv(bundle) }],
    });
  });
  r.get('/api/sessions/:id/zip', async (ctx) => {
    const session = library.getSession(ctx.params.id);
    const bundle = library.eventBundle(session.eventId);
    const all = ctx.query.get('include') === 'todos';
    const assets = bundle.assets.filter((a) => a.sessionId === session.id && (all ? !['substituido', 'rejeitado'].includes(a.status) : ['aprovado', 'final'].includes(a.status)));
    const folder = sessionFolderName(session, 1, bundle);
    const entries = assets.map((asset) => ({ asset, relativePath: `${folder}/${humanComponent(asset.originalName, 120)}` }));
    ctx.handled = true;
    await streamAssetsZip(library, ctx.res, entries, { fileName: `${slugify(session.title)}.zip` });
  });

  return r;
}

function csv(ctx, content, name) {
  ctx.handled = true;
  ctx.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"` });
  ctx.res.end(content);
}

function notFoundThrow(what) { throw notFound(what); }

export function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const iface of list || []) {
      if (iface.family === 'IPv4' && !iface.internal) out.push({ name, address: iface.address });
    }
  }
  return out;
}
