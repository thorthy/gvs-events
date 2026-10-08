// Clips tab: list + editor with in/out marking and rendering.
import { h, clear, icon, btn, badge, select, openModal, confirmDialog, toast, fmtDuration, fmtBytes, fmtRelative, CLIP_STATUS_LABELS, CLIP_STATUS_BADGE, CLIP_FORMAT_LABELS, CLIP_MODE_LABELS, downloadUrl, append, replace } from '../dom.js';
import { api } from '../api.js';
import { state, lookups, refresh } from '../state.js';
import { thumb } from './materials.js';

let statusFilter = '';

export function renderClips(container, { bundle, sub, query }) {
  if (sub === 'novo') return renderEditor(container, bundle, null, query?.get('asset'));
  if (sub) {
    const clip = lookups.clip(sub);
    if (clip) return renderEditor(container, bundle, clip);
  }
  renderList(container, bundle);
}

function renderList(container, bundle) {
  const { event, clips, assets } = bundle;
  const videos = assets.filter((a) => ['video', 'corte'].includes(a.kind) && !['substituido', 'rejeitado'].includes(a.status));
  const list = clips.filter((c) => !statusFilter || c.status === statusFilter);
  const rerender = () => { clear(container); renderList(container, bundle); };
  append(container, 
    h('div', { class: 'flex between flex-wrap mb-16' },
      h('div', { class: 'flex flex-wrap' },
        h('button', { class: `chip ${!statusFilter ? 'active' : ''}`, onClick: () => { statusFilter = ''; rerender(); } }, 'Todos'),
        Object.entries(CLIP_STATUS_LABELS).map(([id, label]) => { const n = clips.filter((c) => c.status === id).length; return n ? h('button', { class: `chip ${statusFilter === id ? 'active' : ''}`, onClick: () => { statusFilter = id; rerender(); } }, `${label} (${n})`) : null; })),
      h('div', { class: 'flex' },
        state.system?.tools?.ffmpeg ? null : h('span', { class: 'badge badge-warn' }, 'ffmpeg não encontrado: cortes só podem ser planejados'),
        btn('Novo corte', { icon: 'plus', cls: 'btn-primary btn-sm', onClick: () => pickSource(event, videos) }))),
  );
  if (!clips.length) {
    append(container, h('div', { class: 'empty' }, icon('scissors'), h('h3', null, 'Nenhum corte ainda'), h('p', null, 'Marque trechos das gravações para gerar cortes para redes sociais, teasers e highlights. Formatos vertical (Reels/Shorts), quadrado ou original.'),
      btn('Criar primeiro corte', { icon: 'plus', cls: 'btn-primary', onClick: () => pickSource(event, videos) })));
    return;
  }
  append(container, h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    h('thead', null, h('tr', null, h('th', null, 'Corte'), h('th', null, 'Origem'), h('th', null, 'Trecho'), h('th', null, 'Formato'), h('th', null, 'Destinos'), h('th', null, 'Status'), h('th', null, 'Resultado'))),
    h('tbody', null, list.map((c) => {
      const src = lookups.asset(c.sourceAssetId);
      const out = c.outputAssetId ? lookups.asset(c.outputAssetId) : null;
      const job = state.jobs.find((j) => j.meta?.clipId === c.id && (j.status === 'executando' || j.status === 'na_fila'));
      return h('tr', { class: 'clickable', onClick: () => { location.hash = `#/eventos/${event.id}/cortes/${c.id}`; } },
        h('td', null, h('div', { class: 'flex' }, out ? thumb(out) : h('div', { class: 'thumb' }, icon('scissors')), h('div', null, h('div', { style: { fontWeight: 600 } }, c.title), h('div', { class: 'muted small' }, lookups.sessionLabel(c.sessionId) || 'Sem sessão')))),
        h('td', { class: 'small' }, src ? src.originalName : h('span', { class: 'muted' }, 'origem removida')),
        h('td', { class: 'mono small nowrap' }, `${fmtDuration(c.start)} → ${fmtDuration(c.end)}`, h('div', { class: 'muted' }, fmtDuration(c.end - c.start))),
        h('td', { class: 'small' }, c.format === 'original' ? '16:9' : c.format === 'vertical' ? '9:16' : '1:1', h('div', { class: 'muted' }, c.mode)),
        h('td', null, h('div', { class: 'flex gap-4 flex-wrap' }, (c.destinations || []).map((d) => h('span', { class: 'tag' }, d)))),
        h('td', null, badge(CLIP_STATUS_LABELS[c.status], CLIP_STATUS_BADGE[c.status]), job ? h('div', { class: 'progress mt-8', style: { width: '90px' } }, h('span', { class: 'seg-plain', style: { width: `${Math.round(job.progress * 100)}%` } })) : null),
        h('td', { onClick: (e) => e.stopPropagation() }, out ? h('div', { class: 'flex gap-4' }, btn('', { icon: 'play', cls: 'btn-ghost btn-icon btn-sm', title: 'Abrir', onClick: () => window.open(api.fileUrl(out.id), '_blank') }), btn('', { icon: 'download', cls: 'btn-ghost btn-icon btn-sm', title: 'Baixar', onClick: () => downloadUrl(api.fileUrl(out.id, { download: true })) })) : h('span', { class: 'muted small' }, c.error ? c.error.slice(0, 60) : '—')));
    })))));
}

function pickSource(event, videos) {
  if (!videos.length) { toast('Envie um vídeo ao evento primeiro (aba Materiais).', { type: 'warn' }); return; }
  const sel = select(videos.map((v) => ({ value: v.id, label: `${v.originalName}${v.meta?.duration ? ` (${fmtDuration(v.meta.duration)})` : ''}` })), videos[0].id);
  openModal({ title: 'Escolha o vídeo de origem', body: h('label', { class: 'field' }, 'Vídeo', sel), actions: [{ label: 'Cancelar' }, { label: 'Abrir editor', primary: true, onClick: () => { location.hash = `#/eventos/${event.id}/cortes/novo?asset=${sel.value}`; } }] });
}

// ---------- editor ----------
export function parseTimeInput(str) {
  const s = String(str || '').trim().replace(',', '.');
  if (!s) return null;
  const parts = s.split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  let secs = 0;
  for (const p of parts) secs = secs * 60 + p;
  return secs;
}

function renderEditor(container, bundle, clip, sourceId) {
  const event = bundle.event;
  const source = lookups.asset(clip ? clip.sourceAssetId : sourceId);
  if (!source) { append(container, h('div', { class: 'empty' }, 'Vídeo de origem não encontrado.', h('div', { class: 'mt-16' }, btn('Voltar', { onClick: () => { location.hash = `#/eventos/${event.id}/cortes`; } })))); return; }
  const tools = state.system?.tools || {};
  const draft = clip ? { ...clip } : { title: '', sessionId: source.sessionId || '', start: 0, end: Math.min(30, source.meta?.duration || 30), destinations: [], format: 'original', mode: 'preciso', notes: '', status: 'planejado' };
  const duration = source.meta?.duration || 0;
  const job = clip ? state.jobs.find((j) => j.meta?.clipId === clip.id && (j.status === 'executando' || j.status === 'na_fila')) : null;
  const output = clip?.outputAssetId ? lookups.asset(clip.outputAssetId) : null;

  const playable = ['mp4', 'm4v', 'webm', 'mov'].includes(source.ext) || source.derived?.proxy;
  const video = h('video', { controls: true, preload: 'metadata', src: source.derived?.proxy ? api.previewUrl(source.id) : api.fileUrl(source.id) });
  const startDisplay = h('span', { class: 'time-display' });
  const endDisplay = h('span', { class: 'time-display' });
  const currentDisplay = h('span', { class: 'time-display muted' }, '0:00.0');
  const durDisplay = h('span', { class: 'time-display muted' });
  const startInput = h('input', { class: 'input input-sm mono', style: { width: '110px' } });
  const endInput = h('input', { class: 'input input-sm mono', style: { width: '110px' } });
  const range = h('div', { class: 'range' });
  const playhead = h('div', { class: 'playhead' });
  const hStart = h('div', { class: 'handle', title: 'Arraste para ajustar o início' });
  const hEnd = h('div', { class: 'handle', title: 'Arraste para ajustar o fim' });
  const timeline = h('div', { class: 'timeline' }, range, playhead, hStart, hEnd);
  let total = duration || 0;
  let loopStop = null;

  const sync = () => {
    const t = total || 1;
    range.style.left = `${(draft.start / t) * 100}%`;
    range.style.width = `${Math.max(0, (draft.end - draft.start) / t) * 100}%`;
    hStart.style.left = `${(draft.start / t) * 100}%`;
    hEnd.style.left = `${(draft.end / t) * 100}%`;
    startDisplay.textContent = fmtDuration(draft.start, { ms: true });
    endDisplay.textContent = fmtDuration(draft.end, { ms: true });
    if (document.activeElement !== startInput) startInput.value = fmtDuration(draft.start, { ms: true });
    if (document.activeElement !== endInput) endInput.value = fmtDuration(draft.end, { ms: true });
    durDisplay.textContent = `duração ${fmtDuration(Math.max(0, draft.end - draft.start), { ms: true })}`;
  };
  const setStart = (v) => { draft.start = Math.max(0, Math.min(v, total ? total - 0.1 : v)); if (draft.end <= draft.start) draft.end = Math.min(total || draft.start + 1, draft.start + 1); sync(); };
  const setEnd = (v) => { draft.end = Math.max(0.1, total ? Math.min(v, total) : v); if (draft.start >= draft.end) draft.start = Math.max(0, draft.end - 1); sync(); };
  video.addEventListener('loadedmetadata', () => { if (video.duration && Number.isFinite(video.duration)) { total = video.duration; if (!clip && draft.end > total) draft.end = total; sync(); } });
  video.addEventListener('timeupdate', () => {
    currentDisplay.textContent = fmtDuration(video.currentTime, { ms: true });
    playhead.style.left = `${(video.currentTime / (total || 1)) * 100}%`;
    if (loopStop !== null && video.currentTime >= loopStop) { video.pause(); loopStop = null; }
  });
  timeline.addEventListener('click', (e) => { if (e.target.classList.contains('handle')) return; const r = timeline.getBoundingClientRect(); video.currentTime = ((e.clientX - r.left) / r.width) * (total || 0); });
  const drag = (handle, setter) => {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const move = (ev) => { const r = timeline.getBoundingClientRect(); const v = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * (total || 0); setter(v); video.currentTime = v; };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
  };
  drag(hStart, setStart); drag(hEnd, setEnd);
  startInput.addEventListener('change', () => { const v = parseTimeInput(startInput.value); if (v !== null) setStart(v); else sync(); });
  endInput.addEventListener('change', () => { const v = parseTimeInput(endInput.value); if (v !== null) setEnd(v); else sync(); });
  const playRange = () => { video.currentTime = draft.start; loopStop = draft.end; video.play(); };
  const step = (d) => { video.pause(); video.currentTime = Math.max(0, Math.min(total || Infinity, video.currentTime + d)); };

  const keyHandler = (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    if (!container.isConnected) { document.removeEventListener('keydown', keyHandler); return; }
    const k = e.key.toLowerCase();
    if (k === 'i') { setStart(video.currentTime); e.preventDefault(); }
    else if (k === 'o') { setEnd(video.currentTime); e.preventDefault(); }
    else if (k === ' ') { video.paused ? video.play() : video.pause(); e.preventDefault(); }
    else if (k === 'arrowleft') { step(e.shiftKey ? -5 : -1); e.preventDefault(); }
    else if (k === 'arrowright') { step(e.shiftKey ? 5 : 1); e.preventDefault(); }
    else if (k === ',') { step(-1 / 30); e.preventDefault(); }
    else if (k === '.') { step(1 / 30); e.preventDefault(); }
    else if (k === 'p') { playRange(); e.preventDefault(); }
  };
  document.addEventListener('keydown', keyHandler);

  // form
  const title = h('input', { class: 'input', value: draft.title, placeholder: 'Ex.: Frase de impacto sobre IA' });
  const sessionSel = select(bundle.sessions.map((s) => ({ value: s.id, label: `${s.start ? s.start + ' ' : ''}${s.title}` })), draft.sessionId || '', { empty: '— sem sessão —' });
  const formatSel = select(Object.entries(CLIP_FORMAT_LABELS).map(([value, label]) => ({ value, label })), draft.format);
  const modeSel = select(Object.entries(CLIP_MODE_LABELS).map(([value, label]) => ({ value, label })), draft.mode);
  const statusSel = select(Object.entries(CLIP_STATUS_LABELS).filter(([v]) => v !== 'renderizando').map(([value, label]) => ({ value, label })), draft.status);
  const notes = h('textarea', { class: 'textarea', rows: 3, placeholder: 'Legenda sugerida, hashtags, instruções de edição…' }, draft.notes || '');
  const destBox = h('div', { class: 'flex flex-wrap gap-4' }, (bundle.destinations || []).map((d) => { const cb = h('input', { type: 'checkbox', value: d, checked: (draft.destinations || []).includes(d), style: { display: 'none' } }); const l = h('label', { class: `chip ${cb.checked ? 'active' : ''}` }, cb, d); cb.addEventListener('change', () => l.classList.toggle('active', cb.checked)); return l; }));
  formatSel.addEventListener('change', () => { if (formatSel.value !== 'original') modeSel.value = 'preciso'; });

  const values = () => ({
    sourceAssetId: source.id, title: title.value, sessionId: sessionSel.value || null, start: Math.round(draft.start * 100) / 100, end: Math.round(draft.end * 100) / 100,
    destinations: [...destBox.querySelectorAll('input:checked')].map((i) => i.value), format: formatSel.value, mode: modeSel.value, notes: notes.value, status: clip ? statusSel.value : undefined,
  });
  const saveClip = async () => {
    const v = values();
    if (!v.title.trim()) throw new Error('Dê um título ao corte');
    let saved;
    if (clip) saved = await api.patch(`/api/clips/${clip.id}`, v);
    else saved = await api.post(`/api/events/${event.id}/clips`, v);
    return saved;
  };
  const errorBox = h('div');
  const onSave = async () => {
    try {
      const saved = await saveClip();
      toast('Corte salvo', { type: 'ok' });
      await refresh();
      if (!clip) location.hash = `#/eventos/${event.id}/cortes/${saved.id}`;
    } catch (err) { replace(errorBox, h('div', { class: 'form-error' }, err.message)); }
  };
  const onRender = async () => {
    try {
      const saved = await saveClip();
      await api.post(`/api/clips/${saved.id}/render`);
      toast('Renderização iniciada', { type: 'ok' });
      await refresh();
      if (!clip) location.hash = `#/eventos/${event.id}/cortes/${saved.id}`;
    } catch (err) { replace(errorBox, h('div', { class: 'form-error' }, err.message)); }
  };

  append(container, 
    h('div', { class: 'flex between mb-16 flex-wrap' },
      h('div', { class: 'flex' }, btn('Voltar aos cortes', { icon: 'chevronLeft', cls: 'btn-ghost btn-sm', onClick: () => { location.hash = `#/eventos/${event.id}/cortes`; } }), h('h2', null, clip ? 'Editar corte' : 'Novo corte'), clip ? badge(CLIP_STATUS_LABELS[clip.status], CLIP_STATUS_BADGE[clip.status]) : null),
      h('div', { class: 'flex' },
        clip ? btn('Excluir', { icon: 'trash', cls: 'btn-sm btn-danger', onClick: async () => { if (await confirmDialog({ title: 'Excluir corte', message: 'Excluir este corte? O arquivo renderizado (se houver) também vai para a lixeira.', confirmLabel: 'Excluir', danger: true })) { await api.delete(`/api/clips/${clip.id}?deleteOutput=1`); location.hash = `#/eventos/${event.id}/cortes`; refresh(); } } }) : null,
        btn('Salvar', { icon: 'save', cls: 'btn-sm', onClick: onSave }),
        btn(job ? 'Renderizando…' : output ? 'Renderizar novamente' : 'Salvar e renderizar', { icon: 'zap', cls: 'btn-sm btn-primary', disabled: !tools.ffmpeg || Boolean(job), title: tools.ffmpeg ? 'Gera o arquivo do corte com ffmpeg' : 'ffmpeg não encontrado no servidor', onClick: onRender }))),
    errorBox,
    h('div', { class: 'clip-editor' },
      h('div', { class: 'clip-player' },
        playable ? video : h('div', { class: 'preview' }, h('div', { class: 'fallback' }, icon('video'), h('div', null, `O navegador não reproduz .${source.ext}. `), tools.ffmpeg ? btn('Gerar prévia MP4 para editar', { icon: 'video', cls: 'btn-sm mt-8', onClick: async () => { await api.post(`/api/assets/${source.id}/proxy`); toast('Prévia MP4 na fila; volte em alguns minutos'); } }) : null)),
        timeline,
        h('div', { class: 'clip-controls' },
          btn('', { icon: 'skipBack', cls: 'btn-sm btn-icon', title: '-5s (Shift+←)', onClick: () => step(-5) }),
          btn('', { icon: 'play', cls: 'btn-sm btn-icon', title: 'Tocar/pausar (espaço)', onClick: () => (video.paused ? video.play() : video.pause()) }),
          btn('', { icon: 'skipForward', cls: 'btn-sm btn-icon', title: '+5s (Shift+→)', onClick: () => step(5) }),
          currentDisplay,
          h('span', { class: 'sep' }),
          btn('Marcar início', { icon: 'flag', cls: 'btn-sm', title: 'Tecla I', onClick: () => setStart(video.currentTime) }),
          btn('Marcar fim', { icon: 'flag', cls: 'btn-sm', title: 'Tecla O', onClick: () => setEnd(video.currentTime) }),
          btn('Tocar trecho', { icon: 'play', cls: 'btn-sm', title: 'Tecla P', onClick: playRange })),
        h('div', { class: 'flex flex-wrap mt-8 gap-12' },
          h('label', { class: 'flex small' }, 'Início', startInput), h('label', { class: 'flex small' }, 'Fim', endInput), durDisplay),
        h('div', { class: 'muted small mt-8' }, 'Atalhos: ', h('kbd', null, 'I'), ' início · ', h('kbd', null, 'O'), ' fim · ', h('kbd', null, 'espaço'), ' tocar · ', h('kbd', null, '←'), h('kbd', null, '→'), ' ±1s · ', h('kbd', null, ','), h('kbd', null, '.'), ' quadro a quadro · ', h('kbd', null, 'P'), ' tocar trecho'),
        h('div', { class: 'card mt-16' }, h('div', { class: 'card-title mb-8' }, icon('video'), 'Origem'), h('div', { class: 'flex' }, thumb(source), h('div', { class: 'grow' }, h('a', { href: `#/eventos/${event.id}/materiais/${source.id}` }, source.originalName), h('div', { class: 'muted small' }, [fmtBytes(source.size), source.meta?.duration ? fmtDuration(source.meta.duration) : null, source.meta?.width ? `${source.meta.width}×${source.meta.height}` : null, lookups.sessionLabel(source.sessionId)].filter(Boolean).join(' · '))))),
        output ? h('div', { class: 'card mt-16' },
          h('div', { class: 'card-header' }, h('div', { class: 'card-title' }, icon('scissors'), 'Resultado'), h('div', { class: 'flex' }, btn('Abrir', { icon: 'external', cls: 'btn-sm', onClick: () => window.open(api.fileUrl(output.id), '_blank') }), btn('Baixar', { icon: 'download', cls: 'btn-sm', onClick: () => downloadUrl(api.fileUrl(output.id, { download: true })) }))),
          h('video', { controls: true, preload: 'metadata', src: api.fileUrl(output.id), style: { width: '100%', maxHeight: '360px', background: '#000', borderRadius: '8px' } }),
          h('div', { class: 'muted small mt-8' }, `${output.originalName} · ${fmtBytes(output.size)}${output.meta?.duration ? ' · ' + fmtDuration(output.meta.duration) : ''}${output.meta?.width ? ` · ${output.meta.width}×${output.meta.height}` : ''} · gerado ${fmtRelative(output.uploadedAt)}`)) : null,
        job ? h('div', { class: 'card mt-16' }, h('div', { class: 'flex between mb-8' }, h('span', null, h('span', { class: 'spinner' }), ' Renderizando…'), h('span', { class: 'mono' }, `${Math.round(job.progress * 100)}%`)), h('div', { class: 'progress' }, h('span', { class: 'seg-plain', style: { width: `${Math.round(job.progress * 100)}%` } }))) : null,
        clip?.status === 'erro' && clip.error ? h('div', { class: 'form-error mt-16' }, `Falha na renderização: ${clip.error}`) : null),
      h('div', { class: 'col gap-12' },
        h('label', { class: 'field' }, 'Título', title),
        h('label', { class: 'field' }, 'Sessão', sessionSel),
        h('label', { class: 'field' }, 'Destinos', destBox),
        h('label', { class: 'field' }, 'Formato de saída', formatSel, h('span', { class: 'hint' }, 'Vertical e quadrado recortam o centro do quadro.')),
        h('label', { class: 'field' }, 'Modo de corte', modeSel),
        clip ? h('label', { class: 'field' }, 'Status', statusSel) : null,
        h('label', { class: 'field' }, 'Notas / legenda', notes),
        h('div', { class: 'info-box small' }, 'Os cortes renderizados viram materiais do tipo "Corte", vinculados à sessão escolhida, com status "Em revisão".'))),
  );
  sync();
}
