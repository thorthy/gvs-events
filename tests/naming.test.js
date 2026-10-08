import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, safeFileName, kindFromName, humanComponent, timeToMinutes, formatBytes, formatDuration, mimeOf } from '../src/naming.js';

test('slugify remove acentos e caracteres especiais', () => {
  assert.equal(slugify('Congresso Brasileiro de Cardiologia 2026!'), 'congresso-brasileiro-de-cardiologia-2026');
  assert.equal(slugify('  Ação & Reação  '), 'acao-reacao');
  assert.equal(slugify(''), 'item');
  assert.equal(slugify('a'.repeat(100), { maxLength: 10 }), 'aaaaaaaaaa');
});

test('safeFileName mantém extensão e remove caracteres perigosos', () => {
  assert.equal(safeFileName('Apresentação João: final?.pptx'), 'Apresentacao-Joao-final.pptx');
  assert.equal(safeFileName('../../etc/passwd'), 'passwd');
  assert.equal(safeFileName('.hidden'), 'hidden');
  assert.equal(safeFileName(''), 'arquivo');
  assert.equal(safeFileName('x'.repeat(300) + '.mp4').length <= 140, true);
});

test('kindFromName detecta tipos', () => {
  assert.equal(kindFromName('slides.PPTX'), 'apresentacao');
  assert.equal(kindFromName('doc.pdf'), 'pdf');
  assert.equal(kindFromName('video.MOV'), 'video');
  assert.equal(kindFromName('foto.jpeg'), 'imagem');
  assert.equal(kindFromName('audio.mp3'), 'audio');
  assert.equal(kindFromName('planilha.xlsx'), 'documento');
  assert.equal(kindFromName('arquivo.xyz'), 'outro');
  assert.equal(kindFromName('semextensao'), 'outro');
});

test('helpers diversos', () => {
  assert.equal(humanComponent('  Sala  A/B: Principal  '), 'Sala AB Principal');
  assert.equal(timeToMinutes('09:30'), 570);
  assert.equal(timeToMinutes('25:00'), null);
  assert.equal(timeToMinutes('9h'), null);
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(3 * 1024 ** 3), '3.0 GB');
  assert.equal(formatDuration(65), '1:05');
  assert.equal(formatDuration(3725), '1:02:05');
  assert.equal(mimeOf('a.mp4'), 'video/mp4');
  assert.equal(mimeOf('a.unknown'), 'application/octet-stream');
});
