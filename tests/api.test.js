import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';

let app; let base; let dir;
const headers = { 'content-type': 'application/json', 'x-user': encodeURIComponent('Operador Teste') };
const api = async (method, url, body) => {
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, res };
};

before(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'gvs-api-'));
  app = await createApp({ libraryDir: dir, quiet: true });
  const addr = await app.start({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${addr.port}`;
});
after(async () => { await app.jobs.idle(); await app.stop(); await fsp.rm(dir, { recursive: true, force: true }); });

test('serve o front-end e o sistema', async () => {
  const html = await fetch(base + '/');
  assert.equal(html.status, 200);
  assert.match(await html.text(), /<!doctype html>/i);
  const sys = await api('GET', '/api/system');
  assert.equal(sys.status, 200);
  assert.ok(sys.body.tools);
  assert.equal((await api('GET', '/api/nada')).status, 404);
  assert.equal((await fetch(base + '/package.json')).status, 404); // só a pasta public é servida
  assert.equal((await fetch(base + '/..%2F..%2Fpackage.json')).status, 403); // path traversal bloqueado
  assert.equal((await fetch(base + '/qualquer/rota')).status, 200); // SPA fallback
});

test('ciclo via API: evento, programação, upload, versão, zip, csv', async () => {
  const ev = await api('POST', '/api/events', { name: 'Evento API', startDate: '2026-08-01', endDate: '2026-08-02' });
  assert.equal(ev.status, 200);
  const eventId = ev.body.id;
  const bad = await api('POST', '/api/events', { name: '' });
  assert.equal(bad.status, 400);

  const preview = await api('POST', `/api/events/${eventId}/program/preview`, { text: '## Sala 1\n09:00-10:00 | Palestra A | Fulano\n10:00-10:30 | Coffee break' });
  assert.equal(preview.body.rows.length, 2);
  const imp = await api('POST', `/api/events/${eventId}/program/import`, { text: '## Sala 1\n09:00-10:00 | Palestra A | Fulano\n10:00-10:30 | Coffee break' });
  assert.equal(imp.body.created, 2);
  const bundle = await api('GET', `/api/events/${eventId}`);
  assert.equal(bundle.body.rooms.length, 1);
  assert.equal(bundle.body.speakers.length, 1);
  assert.equal(bundle.body.sessions[0].title, 'Palestra A');
  const sessionId = bundle.body.sessions[0].id;

  // raw upload
  const content = Buffer.from('%PDF-1.4 fake pdf\n/Type /Page\n/Type /Page\n');
  const up = await fetch(`${base}/api/events/${eventId}/assets?filename=${encodeURIComponent('Slides Fulano.pdf')}&sessionId=${sessionId}`, { method: 'PUT', body: content, headers: { 'x-user': 'up' } });
  assert.equal(up.status, 200);
  const asset = await up.json();
  assert.equal(asset.kind, 'pdf');
  assert.equal(asset.size, content.length);
  await app.jobs.idle();

  const file = await fetch(`${base}/api/assets/${asset.id}/file`, { headers: { range: 'bytes=0-3' } });
  assert.equal(file.status, 206);
  assert.equal(await file.text(), '%PDF');
  assert.equal(file.headers.get('content-range'), `bytes 0-3/${content.length}`);
  const bad416 = await fetch(`${base}/api/assets/${asset.id}/file`, { headers: { range: 'bytes=999-' } });
  assert.equal(bad416.status, 416);

  const empty = await fetch(`${base}/api/events/${eventId}/assets?filename=vazio.pdf`, { method: 'PUT', body: '' });
  assert.equal(empty.status, 400);

  const v2 = await fetch(`${base}/api/assets/${asset.id}/versions?filename=${encodeURIComponent('Slides v2.pdf')}&note=ajustes`, { method: 'PUT', body: Buffer.from('%PDF-1.4 v2') });
  assert.equal((await v2.json()).version, 2);
  await app.jobs.idle();
  const old = await fetch(`${base}/api/assets/${asset.id}/versions/${(await api('GET', `/api/events/${eventId}`)).body.assets[0].versions[0].id}/file`);
  assert.equal(old.status, 200);
  assert.equal((await old.text()).startsWith('%PDF-1.4 fake'), true);

  const patched = await api('PATCH', `/api/assets/${asset.id}`, { status: 'final', tags: 'a, b' });
  assert.equal(patched.body.status, 'final');
  assert.deepEqual(patched.body.tags, ['a', 'b']);
  assert.equal((await api('PATCH', `/api/assets/${asset.id}`, { status: 'xpto' })).status, 400);

  const b2 = await api('GET', `/api/events/${eventId}`);
  assert.equal(b2.body.sessions[0].readiness.level, 'parcial'); // checklist pending
  const item = b2.body.sessions[0].checklist[0];
  const ck = await api('PATCH', `/api/sessions/${sessionId}/checklist/${item.id}`, { done: true });
  assert.equal(ck.body.doneBy, 'Operador Teste');

  const zip = await fetch(`${base}/api/sessions/${sessionId}/zip`);
  assert.equal(zip.status, 200);
  assert.equal(zip.headers.get('content-type'), 'application/zip');
  const zipBuf = Buffer.from(await zip.arrayBuffer());
  assert.equal(zipBuf.readUInt32LE(0), 0x04034b50);

  const csv = await fetch(`${base}/api/events/${eventId}/export/materiais.csv`);
  assert.match(await csv.text(), /Slides v2\.pdf/);

  const prevExport = await api('GET', `/api/events/${eventId}/export/operator/preview`);
  assert.equal(prevExport.body.length, 1);
  const job = await api('POST', `/api/events/${eventId}/export/operator`, {});
  assert.equal(job.body.type, 'exportar');
  await app.jobs.idle();
  const done = await api('GET', `/api/jobs/${job.body.id}`);
  assert.equal(done.body.status, 'concluido');
  assert.equal(done.body.result.files, 1);
  const exported = await fsp.readdir(done.body.result.dest);
  assert.ok(exported.includes('LEIA-ME.txt'));

  const search = await api('GET', '/api/search?q=fulano');
  assert.ok(search.body.length >= 2);

  // scan/import from a folder
  const inbox = path.join(dir, 'pendrive');
  await fsp.mkdir(inbox);
  await fsp.writeFile(path.join(inbox, 'Fulano palestra A.pptx'), 'PK fake');
  await fsp.writeFile(path.join(inbox, 'notas.txt'), 'x');
  const scan = await api('POST', `/api/events/${eventId}/scan/preview`, { path: inbox });
  assert.equal(scan.body.files.length, 2);
  assert.equal(scan.body.files[0].suggestion?.sessionId, sessionId);
  const impJob = await api('POST', `/api/events/${eventId}/scan/import`, { path: inbox, files: ['Fulano palestra A.pptx'], assignments: { 'Fulano palestra A.pptx': sessionId }, mode: 'mover' });
  await app.jobs.idle();
  assert.equal((await api('GET', `/api/jobs/${impJob.body.id}`)).body.result.created.length, 1);
  assert.equal((await fsp.readdir(inbox)).length, 1);
  assert.equal((await api('POST', `/api/events/${eventId}/scan/import`, { path: inbox, files: ['../../x'] })).status, 400);

  // delete flow
  assert.equal((await api('DELETE', `/api/assets/${asset.id}`)).status, 200);
  assert.equal((await api('DELETE', `/api/events/${eventId}/trash`)).body.removed, 2);
  assert.equal((await api('DELETE', `/api/events/${eventId}`)).status, 200);
  assert.equal((await api('GET', `/api/events/${eventId}`)).status, 404);
});

test('token protege a API quando configurado', async () => {
  const d2 = await fsp.mkdtemp(path.join(os.tmpdir(), 'gvs-tok-'));
  const secured = await createApp({ libraryDir: d2, token: 'segredo', quiet: true });
  const addr = await secured.start({ port: 0, host: '127.0.0.1' });
  const b = `http://127.0.0.1:${addr.port}`;
  assert.equal((await fetch(b + '/api/events')).status, 401);
  assert.equal((await fetch(b + '/api/events', { headers: { authorization: 'Bearer segredo' } })).status, 200);
  assert.equal((await fetch(b + '/api/events?token=segredo')).status, 200);
  const login = await fetch(b + '/api/auth/login', { method: 'POST', body: JSON.stringify({ token: 'segredo' }) });
  const cookie = login.headers.get('set-cookie');
  assert.equal((await fetch(b + '/api/events', { headers: { cookie } })).status, 200);
  await secured.stop();
  await fsp.rm(d2, { recursive: true, force: true });
});
