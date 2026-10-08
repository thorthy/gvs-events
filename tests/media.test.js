// Integration tests with real external tools; each test is skipped when the tool is missing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Media } from '../src/media.js';

let dir; let media; let video;

before(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'gvs-media-'));
  media = new Media();
  await media.ready;
  if (media.tools.ffmpeg) {
    video = path.join(dir, 'entrada.mp4');
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=4:size=320x180:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]);
  }
});
after(async () => { await fsp.rm(dir, { recursive: true, force: true }); });

test('ffprobe lê metadados e ffmpeg gera miniatura', async (t) => {
  if (!media.tools.ffprobe || !media.tools.ffmpeg) return t.skip('ffmpeg/ffprobe ausentes');
  const meta = await media.probe(video);
  assert.equal(meta.width, 320);
  assert.equal(meta.height, 180);
  assert.ok(meta.duration >= 3.9 && meta.duration <= 4.2);
  assert.equal(meta.videoCodec, 'h264');
  const thumb = path.join(dir, 'thumb.jpg');
  assert.equal(await media.videoThumbnail(video, thumb, { at: 1 }), true);
  assert.ok((await fsp.stat(thumb)).size > 500);
});

test('ffmpeg renderiza corte vertical preciso com progresso', async (t) => {
  if (!media.tools.ffmpeg) return t.skip('ffmpeg ausente');
  const out = path.join(dir, 'corte.mp4');
  const progress = [];
  await media.renderClip(video, out, { start: 1, end: 3, mode: 'preciso', format: 'vertical', onProgress: (p) => progress.push(p) });
  const meta = await media.probe(out);
  assert.equal(meta.width, 1080);
  assert.equal(meta.height, 1920);
  assert.ok(meta.duration >= 1.8 && meta.duration <= 2.3, `duração inesperada: ${meta.duration}`);
  assert.ok(progress.length > 0 && progress[progress.length - 1] > 0.5);
  const fast = path.join(dir, 'rapido.mp4');
  await media.renderClip(video, fast, { start: 0, end: 2, mode: 'rapido' });
  assert.ok((await fsp.stat(fast)).size > 1000);
});

test('LibreOffice converte documento em PDF e poppler conta páginas', async (t) => {
  if (!media.tools.soffice) return t.skip('LibreOffice ausente');
  const txt = path.join(dir, 'doc.txt');
  await fsp.writeFile(txt, 'Página de teste\n');
  const pdf = await media.convertToPdf(txt, path.join(dir, 'saida'));
  assert.ok(pdf.endsWith('.pdf'));
  assert.equal(await media.pdfPages(pdf), 1);
  if (media.tools.pdftoppm) {
    const thumb = path.join(dir, 'pdf.jpg');
    assert.equal(await media.pdfThumbnail(pdf, thumb), true);
    assert.ok((await fsp.stat(thumb)).size > 500);
  }
});

test('contagem de páginas por leitura direta do PDF (fallback)', async () => {
  const fake = path.join(dir, 'fake.pdf');
  await fsp.writeFile(fake, '%PDF-1.4\n1 0 obj << /Type /Pages /Kids [] >> endobj\n2 0 obj << /Type /Page >> endobj\n3 0 obj << /Type /Page >> endobj\n');
  const saved = media.tools.pdfinfo;
  media.tools.pdfinfo = false;
  try { assert.equal(await media.pdfPages(fake), 2); } finally { media.tools.pdfinfo = saved; }
});
