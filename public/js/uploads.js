// Upload queue with a floating progress panel.
import { h, clear, fmtBytes, toast, btn, icon, append, replace } from './dom.js';
import { uploadFile, api } from './api.js';
import { refresh } from './state.js';

const queue = [];
let active = 0;
const CONCURRENCY = 2;
let panel; let itemsEl; let headEl;
const listeners = new Set();

export function onUploadDone(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function enqueueUploads(files, { eventId, sessionId = null, speakerId = null, kind = null, status = null, tags = null, assetId = null, note = '' }) {
  const list = [...files].filter((f) => f.size > 0);
  if (!list.length) { toast('Nenhum arquivo válido para enviar', { type: 'warn' }); return; }
  for (const file of list) {
    const params = new URLSearchParams({ filename: file.name });
    if (sessionId) params.set('sessionId', sessionId);
    if (speakerId) params.set('speakerId', speakerId);
    if (kind) params.set('kind', kind);
    if (status) params.set('status', status);
    if (tags) params.set('tags', tags);
    if (note) params.set('note', note);
    const url = assetId ? `/api/assets/${assetId}/versions?${params}` : `/api/events/${eventId}/assets?${params}`;
    const item = { file, url, progress: 0, status: 'na_fila', error: null, controller: new AbortController(), eventId, result: null };
    queue.push(item);
  }
  renderPanel();
  pump();
}

function pump() {
  while (active < CONCURRENCY) {
    const next = queue.find((i) => i.status === 'na_fila');
    if (!next) break;
    active++;
    next.status = 'enviando';
    uploadFile(api.store.token ? next.url + `&token=${encodeURIComponent(api.store.token)}` : next.url, next.file, {
      signal: next.controller.signal,
      onProgress: (p) => { next.progress = p; updateItem(next); },
    }).then((result) => {
      next.status = 'concluido'; next.progress = 1; next.result = result;
      for (const fn of listeners) fn(next);
    }).catch((err) => {
      next.status = 'erro'; next.error = err.message;
      toast(`Falha ao enviar ${next.file.name}: ${err.message}`, { type: 'error', timeout: 7000 });
    }).finally(() => {
      active--;
      updateItem(next);
      renderHead();
      pump();
      if (!queue.some((i) => i.status === 'na_fila' || i.status === 'enviando')) {
        const ok = queue.filter((i) => i.status === 'concluido').length;
        if (ok) toast(`${ok} arquivo(s) enviado(s)`, { type: 'ok' });
        refresh().catch(() => {});
        setTimeout(() => { if (!queue.some((i) => i.status === 'na_fila' || i.status === 'enviando')) hidePanelIfDone(); }, 4000);
      } else {
        refresh().catch(() => {});
      }
    });
  }
}

function renderPanel() {
  if (!panel) {
    itemsEl = h('div', { class: 'items' });
    headEl = h('div', { class: 'head' });
    panel = h('div', { class: 'upload-panel' }, headEl, itemsEl);
    append(document.body, panel);
  }
  panel.classList.remove('hidden');
  renderHead();
  clear(itemsEl);
  for (const item of queue) {
    item.el = h('div', { class: 'upload-item' },
      h('div', { class: 'name' }, h('span', { class: 'ellipsis', title: item.file.name }, item.file.name), h('span', { class: 'muted nowrap' })),
      h('div', { class: 'progress' }, h('span', { class: 'seg-plain', style: { width: '0%' } })));
    append(itemsEl, item.el);
    updateItem(item);
  }
}

function renderHead() {
  if (!headEl) return;
  const pending = queue.filter((i) => i.status === 'na_fila' || i.status === 'enviando').length;
  const done = queue.filter((i) => i.status === 'concluido').length;
  clear(headEl);
  append(headEl, 
    h('span', null, pending ? `Enviando ${pending} arquivo(s)…` : `${done} de ${queue.length} enviado(s)`),
    btn('', { icon: 'x', cls: 'btn-ghost btn-icon btn-sm', title: pending ? 'Cancelar envios pendentes' : 'Fechar', onClick: () => {
      for (const i of queue) if (i.status === 'na_fila' || i.status === 'enviando') i.controller.abort();
      queue.length = 0;
      panel.classList.add('hidden');
    } }),
  );
}

function updateItem(item) {
  if (!item.el) return;
  const label = item.el.querySelector('.name .muted');
  const bar = item.el.querySelector('.progress span');
  bar.style.width = `${Math.round(item.progress * 100)}%`;
  if (item.status === 'erro') { label.textContent = 'erro'; bar.style.background = 'var(--danger)'; }
  else if (item.status === 'concluido') { label.textContent = 'ok'; bar.style.background = 'var(--ok)'; }
  else if (item.status === 'enviando') label.textContent = `${Math.round(item.progress * 100)}% · ${fmtBytes(item.file.size)}`;
  else label.textContent = 'na fila';
}

function hidePanelIfDone() {
  if (!queue.some((i) => i.status === 'erro')) { queue.length = 0; panel?.classList.add('hidden'); }
}

// Builds a dropzone element wired to the upload queue.
export function dropzone({ eventId, sessionId = null, label = 'Arraste arquivos aqui ou clique para selecionar', hint = 'PowerPoint, PDF, vídeos, imagens e áudio', compact = false, kind = null }) {
  const input = h('input', { type: 'file', multiple: true, class: 'hidden' });
  const zone = h('div', { class: `dropzone ${compact ? 'compact' : ''}`, style: compact ? { padding: '12px' } : null },
    icon('upload'), ' ', h('strong', null, label), compact ? null : h('div', { class: 'small mt-8' }, hint), input);
  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { enqueueUploads(input.files, { eventId, sessionId, kind }); input.value = ''; });
  wireDrop(zone, (files) => enqueueUploads(files, { eventId, sessionId, kind }));
  return zone;
}

export function wireDrop(el, onFiles, { cls = 'over' } = {}) {
  let depth = 0;
  el.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; el.classList.add(cls); });
  el.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  el.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) el.classList.remove(cls); });
  el.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); e.stopPropagation(); depth = 0; el.classList.remove(cls);
    if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
  });
}

function hasFiles(e) { return [...(e.dataTransfer?.types || [])].includes('Files'); }
