// Exports: operator folder tree, CSV reports and ZIP downloads.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { humanComponent, APPROVED_STATUSES, KINDS, formatBytes, formatDuration } from './naming.js';
import { sessionSortKey } from './library.js';
import { ZipWriter } from './zip.js';

export function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows, headers) {
  const lines = [headers.map(csvEscape).join(';')];
  for (const row of rows) lines.push(headers.map((h) => csvEscape(row[h])).join(';'));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export function dayIndexOf(event, date) {
  if (!event.startDate || !date) return 1;
  const a = Date.parse(`${event.startDate}T00:00:00Z`);
  const b = Date.parse(`${date}T00:00:00Z`);
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

function speakersOf(session, bundle) {
  return (session.speakerIds || []).map((id) => bundle.speakers.find((s) => s.id === id)?.name).filter(Boolean);
}

function roomOf(session, bundle) {
  return bundle.rooms.find((r) => r.id === session.roomId)?.name || '';
}

export function sessionFolderName(session, index, bundle) {
  const time = session.start ? session.start.replace(':', 'h') : '';
  const speakers = speakersOf(session, bundle).join(', ');
  const parts = [String(index).padStart(2, '0'), time, speakers ? humanComponent(speakers, 40) : '', humanComponent(session.title, 60)].filter(Boolean);
  return parts.join(' - ');
}

export function dayFolderName(event, date) {
  const idx = dayIndexOf(event, date);
  return date ? `Dia ${idx} - ${date}` : 'Sem data';
}

// Builds the list of {asset, relativePath} entries for the operator folder.
export function operatorEntries(bundle, { include = 'aprovados' } = {}) {
  const entries = [];
  const sessions = bundle.sessions.slice().sort((a, b) => sessionSortKey(a).localeCompare(sessionSortKey(b)));
  const counters = new Map();
  const eligible = (a) => (include === 'todos' ? !['substituido', 'rejeitado'].includes(a.status) : APPROVED_STATUSES.includes(a.status));
  for (const session of sessions) {
    const assets = bundle.assets.filter((a) => a.sessionId === session.id && eligible(a));
    if (!assets.length) continue;
    const day = dayFolderName(bundle.event, session.date);
    const room = roomOf(session, bundle) || 'Sem sala';
    const key = `${day}/${room}`;
    const idx = (counters.get(key) || 0) + 1;
    counters.set(key, idx);
    const folder = path.posix.join(day, humanComponent(room, 40), sessionFolderName(session, idx, bundle));
    for (const asset of assets) {
      const suffix = include === 'todos' && !APPROVED_STATUSES.includes(asset.status) ? ` [${asset.status.toUpperCase()}]` : '';
      const base = humanComponent(asset.originalName.replace(/\.[^.]+$/, ''), 80) + suffix + (asset.ext ? `.${asset.ext}` : '');
      entries.push({ asset, relativePath: path.posix.join(folder, base), session });
    }
  }
  const loose = bundle.assets.filter((a) => !a.sessionId && eligible(a));
  for (const asset of loose) {
    const kindLabel = KINDS[asset.kind]?.label || 'Outros';
    entries.push({ asset, relativePath: path.posix.join('Geral', humanComponent(kindLabel, 30), humanComponent(asset.originalName, 100)), session: null });
  }
  // de-duplicate paths
  const seen = new Map();
  for (const e of entries) {
    const n = (seen.get(e.relativePath) || 0) + 1;
    seen.set(e.relativePath, n);
    if (n > 1) e.relativePath = e.relativePath.replace(/(\.[^./]+)?$/, `-${n}$1`);
  }
  return entries;
}

export async function exportOperatorFolder(library, eventId, { dest, include = 'aprovados', mode = 'copiar', onProgress } = {}) {
  const bundle = library.eventBundle(eventId);
  const event = bundle.event;
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const target = dest ? path.resolve(dest) : path.join(library.storage.exportsDir(event.slug), `pasta-operador-${stamp}`);
  await fsp.mkdir(target, { recursive: true });
  const entries = operatorEntries(bundle, { include });
  let done = 0;
  for (const e of entries) {
    const out = path.join(target, ...e.relativePath.split('/'));
    const src = library.assetPath(e.asset);
    if (mode === 'link') await library.storage.linkOrCopy(src, out);
    else await library.storage.copyFile(src, out);
    done++;
    onProgress?.(done / entries.length);
  }
  const readme = buildReadme(bundle, entries);
  await fsp.writeFile(path.join(target, 'LEIA-ME.txt'), readme, 'utf8');
  await fsp.writeFile(path.join(target, 'programacao.csv'), programCsv(bundle), 'utf8');
  return { dest: target, files: entries.length, bytes: entries.reduce((n, e) => n + (e.asset.size || 0), 0) };
}

function buildReadme(bundle, entries) {
  const lines = [];
  lines.push(`${bundle.event.name}`);
  lines.push(`Pasta do operador gerada em ${new Date().toLocaleString('pt-BR')}`);
  lines.push('');
  lines.push('Estrutura: Dia N - data / Sala / NN - horário - palestrante - título / arquivos');
  lines.push('');
  let lastFolder = '';
  for (const e of entries) {
    const folder = path.posix.dirname(e.relativePath);
    if (folder !== lastFolder) { lines.push(folder); lastFolder = folder; }
    const meta = [];
    if (e.asset.meta?.slides) meta.push(`${e.asset.meta.slides} slides`);
    if (e.asset.meta?.pages) meta.push(`${e.asset.meta.pages} páginas`);
    if (e.asset.meta?.duration) meta.push(formatDuration(e.asset.meta.duration));
    lines.push(`  - ${path.posix.basename(e.relativePath)}  (${formatBytes(e.asset.size)}${meta.length ? ', ' + meta.join(', ') : ''})${e.asset.notes ? '\n    Obs: ' + e.asset.notes.replace(/\n/g, ' ') : ''}`);
  }
  return lines.join('\n') + '\n';
}

export function programCsv(bundle) {
  const rows = bundle.sessions.map((s) => ({
    data: s.date, inicio: s.start, fim: s.end, sala: roomOf(s, bundle), tipo: s.type, titulo: s.title,
    palestrantes: speakersOf(s, bundle).join(', '), status_materiais: s.readiness?.label || '',
    materiais: bundle.assets.filter((a) => a.sessionId === s.id && !['substituido', 'rejeitado'].includes(a.status)).map((a) => `${a.originalName} [${a.status}]`).join(' | '),
    checklist: s.readiness ? `${s.readiness.checklistDone}/${s.readiness.checklistTotal}` : '', observacoes: s.notes,
  }));
  return toCsv(rows, ['data', 'inicio', 'fim', 'sala', 'tipo', 'titulo', 'palestrantes', 'status_materiais', 'materiais', 'checklist', 'observacoes']);
}

export function materialsCsv(bundle) {
  const rows = bundle.assets.map((a) => {
    const s = bundle.sessions.find((x) => x.id === a.sessionId);
    return {
      arquivo: a.originalName, tipo: KINDS[a.kind]?.label || a.kind, status: a.status, versao: a.version, tamanho: formatBytes(a.size),
      duracao: a.meta?.duration ? formatDuration(a.meta.duration) : '', slides_paginas: a.meta?.slides || a.meta?.pages || '',
      sessao: s ? s.title : '', data: s?.date || '', sala: s ? roomOf(s, bundle) : '', palestrante: bundle.speakers.find((x) => x.id === a.speakerId)?.name || '',
      enviado_por: a.uploadedBy, enviado_em: a.uploadedAt, tags: (a.tags || []).join(', '), sha256: a.sha256, observacoes: a.notes,
    };
  });
  return toCsv(rows, ['arquivo', 'tipo', 'status', 'versao', 'tamanho', 'duracao', 'slides_paginas', 'sessao', 'data', 'sala', 'palestrante', 'enviado_por', 'enviado_em', 'tags', 'sha256', 'observacoes']);
}

export function clipsCsv(bundle) {
  const rows = bundle.clips.map((c) => {
    const src = bundle.assets.find((a) => a.id === c.sourceAssetId);
    const out = bundle.assets.find((a) => a.id === c.outputAssetId);
    const s = bundle.sessions.find((x) => x.id === c.sessionId);
    return {
      titulo: c.title, origem: src?.originalName || '', inicio: formatDuration(c.start), fim: formatDuration(c.end), duracao: formatDuration(c.end - c.start),
      formato: c.format, modo: c.mode, destinos: (c.destinations || []).join(', '), status: c.status, arquivo_gerado: out?.originalName || '', sessao: s?.title || '', observacoes: c.notes,
    };
  });
  return toCsv(rows, ['titulo', 'origem', 'inicio', 'fim', 'duracao', 'formato', 'modo', 'destinos', 'status', 'arquivo_gerado', 'sessao', 'observacoes']);
}

// Streams a ZIP with the given assets to an HTTP response.
export async function streamAssetsZip(library, res, entries, { fileName = 'materiais.zip', extraFiles = [] } = {}) {
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${fileName.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    'Cache-Control': 'no-store',
  });
  const zip = new ZipWriter(res);
  for (const extra of extraFiles) await zip.addBuffer(extra.name, extra.content);
  for (const e of entries) await zip.addFile(e.relativePath, library.assetPath(e.asset));
  await zip.finish();
  res.end();
}
