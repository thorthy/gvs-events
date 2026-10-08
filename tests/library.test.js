import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { FileStorage } from '../src/files.js';
import { Library, computeReadiness } from '../src/library.js';
import { operatorEntries, programCsv } from '../src/exporter.js';
import { suggestSession } from '../src/scan.js';
import { createHash } from 'node:crypto';

let dir; let library; let store;
const fakeMedia = { tools: { ffmpeg: false, soffice: null }, probe: async () => null, pdfPages: async () => 3, presentationSlides: async () => null, videoThumbnail: async () => false, pdfThumbnail: async () => false, imageThumbnail: async () => false };

before(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'gvs-lib-'));
  store = new Store(path.join(dir, 'biblioteca.json'));
  store.load();
  library = new Library({ store, storage: new FileStorage(dir), media: fakeMedia, jobs: null });
});
after(async () => { await store.flush(); await fsp.rm(dir, { recursive: true, force: true }); });

test('fluxo completo: evento, sala, palestrante, sessão, material, corte', async () => {
  const event = await library.createEvent({ name: 'Congresso Teste', startDate: '2026-05-10', endDate: '2026-05-11', venue: 'Centro de Convenções' }, 'tester');
  assert.equal(event.slug, 'congresso-teste-2026');
  const dup = await library.createEvent({ name: 'Congresso Teste', startDate: '2026-05-10' }, 'tester');
  assert.equal(dup.slug, 'congresso-teste-2026-2');
  await library.deleteEvent(dup.id, 'tester');

  const room = library.createRoom(event.id, { name: 'Sala A', capacity: '200' }, 'tester');
  const speaker = library.createSpeaker(event.id, { name: 'Maria Silva', company: 'ACME' }, 'tester');
  const session = library.createSession(event.id, { title: 'Palestra de abertura', roomId: room.id, speakerIds: [speaker.id], date: '2026-05-10', start: '9:00', end: '09:45' }, 'tester');
  assert.equal(session.start, '09:00');
  assert.equal(session.checklist.length, store.data.settings.checklistTemplate.length);
  assert.throws(() => library.createSession(event.id, { title: 'x', start: '10:00', end: '09:00' }), /término/);
  assert.throws(() => library.createSession(event.id, { title: 'x', roomId: 'rm_nope' }), /Sala inválida/);

  let r = computeReadiness({ ...session }, []);
  assert.equal(r.level, 'pendente');

  const tmp = path.join(dir, 'slides.pdf');
  await fsp.writeFile(tmp, 'pdf de teste');
  const asset = await library.addAsset({ eventId: event.id, tmpPath: tmp, originalName: 'Slides Maria.pdf', sessionId: session.id, user: 'tester' });
  assert.equal(asset.kind, 'pdf');
  assert.equal(asset.status, 'recebido');
  assert.match(asset.fileName, /^as_[a-z0-9]+__Slides-Maria\.pdf$/);
  assert.equal(asset.size, 12);
  await library.analyzeAsset(asset.id);
  assert.equal(asset.meta.pages, 3);

  r = computeReadiness(session, store.data.assets);
  assert.equal(r.level, 'parcial');
  library.updateAsset(asset.id, { status: 'aprovado' }, 'tester');
  for (const item of session.checklist) library.updateChecklistItem(session.id, item.id, { done: true }, 'tester');
  r = computeReadiness(session, store.data.assets);
  assert.equal(r.level, 'pronto');
  assert.equal(r.approved, 1);

  // versioning keeps old file
  const tmp2 = path.join(dir, 'slides-v2.pdf');
  await fsp.writeFile(tmp2, 'pdf de teste versão 2');
  await library.addAssetVersion(asset.id, { tmpPath: tmp2, originalName: 'Slides Maria v2.pdf', size: 21, sha256: createHash('sha256').update('pdf de teste versão 2').digest('hex'), note: 'corrigiu capa', user: 'tester' });
  assert.equal(asset.version, 2);
  assert.equal(asset.status, 'recebido');
  assert.equal(asset.versions.length, 1);
  assert.ok(await fsp.stat(library.versionPath(asset, asset.versions[0])));
  assert.ok(await fsp.stat(library.assetPath(asset)));

  // duplicate detection
  const tmp3 = path.join(dir, 'dup.pdf');
  await fsp.writeFile(tmp3, 'pdf de teste versão 2');
  const dupAsset = await library.addAsset({ eventId: event.id, tmpPath: tmp3, originalName: 'copia.pdf', user: 'tester' });
  assert.equal(dupAsset.duplicateOf, asset.id);

  // operator export entries
  const bundle = library.eventBundle(event.id);
  library.updateAsset(asset.id, { status: 'final' }, 'tester');
  const entries = operatorEntries(library.eventBundle(event.id));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].relativePath, 'Dia 1 - 2026-05-10/Sala A/01 - 09h00 - Maria Silva - Palestra de abertura/Slides Maria v2.pdf');
  const csv = programCsv(library.eventBundle(event.id));
  assert.match(csv, /Palestra de abertura/);
  assert.match(csv, /Maria Silva/);
  assert.equal(bundle.sessions[0].readiness.level, 'parcial');

  // clips
  const vtmp = path.join(dir, 'video.mp4');
  await fsp.writeFile(vtmp, 'não é um vídeo de verdade');
  const video = await library.addAsset({ eventId: event.id, tmpPath: vtmp, originalName: 'gravacao.mp4', sessionId: session.id, user: 'tester' });
  const clip = library.createClip(event.id, { sourceAssetId: video.id, title: 'Melhor momento', start: 10, end: 40, destinations: ['Instagram Reels'], format: 'vertical' }, 'tester');
  assert.equal(clip.sessionId, session.id);
  assert.throws(() => library.createClip(event.id, { sourceAssetId: asset.id, title: 'x', start: 0, end: 1 }), /vídeo/);
  assert.throws(() => library.updateClip(clip.id, { end: 5 }), /depois do início/);

  // search
  const hits = library.search('maria');
  assert.ok(hits.some((h) => h.type === 'palestrante'));
  assert.ok(hits.some((h) => h.type === 'material'));

  // delete asset goes to trash
  await library.deleteAsset(dupAsset.id, 'tester');
  const trash = await fsp.readdir(new FileStorage(dir).trashDir(event.slug));
  assert.equal(trash.length, 1);

  // deleting room/speaker cleans references
  library.deleteRoom(room.id, 'tester');
  assert.equal(library.getSession(session.id).roomId, null);
  library.deleteSpeaker(speaker.id, 'tester');
  assert.deepEqual(library.getSession(session.id).speakerIds, []);

  const activity = library.activity(event.id);
  assert.ok(activity.length > 5);
  assert.equal(activity[0].user, 'tester');
});

test('sugestão de sessão por nome de arquivo', () => {
  const sessions = [
    { id: 's1', title: 'Inteligência artificial na prática', speakerIds: ['p1'] },
    { id: 's2', title: 'Encerramento', speakerIds: ['p2'] },
  ];
  const speakers = [{ id: 'p1', name: 'João Souza' }, { id: 'p2', name: 'Ana Lima' }];
  assert.equal(suggestSession('Joao Souza - IA pratica.pptx', sessions, speakers)?.sessionId, 's1');
  assert.equal(suggestSession('Ana_Lima_final.pdf', sessions, speakers)?.sessionId, 's2');
  assert.equal(suggestSession('IMG_0001.jpg', sessions, speakers), null);
});

test('store persiste e recarrega', async () => {
  await store.flush();
  const reloaded = new Store(store.filePath);
  reloaded.load();
  assert.equal(reloaded.data.events.length, 1);
  assert.equal(reloaded.data.events[0].name, 'Congresso Teste');
});
