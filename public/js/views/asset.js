// Asset drawer: preview, metadata, workflow, versions and actions.
import { h, clear, icon, btn, badge, statusBadge, kindIcon, select, confirmDialog, promptDialog, toast, fmtBytes, fmtDuration, fmtDateTime, fmtRelative, STATUS_LABELS, KIND_LABELS, downloadUrl, copyText, append, replace } from '../dom.js';
import { api } from '../api.js';
import { state, lookups, refresh, subscribe } from '../state.js';
import { enqueueUploads } from '../uploads.js';

let drawer = null; let currentId = null; let unsub = null;

export function closeAssetDrawer() {
  if (drawer) { drawer.overlay.remove(); drawer.el.remove(); drawer = null; }
  currentId = null;
  if (unsub) { unsub(); unsub = null; }
}

export function openAssetDrawer(assetId) {
  if (drawer && currentId === assetId) { renderBody({ keepPreview: true }); return; }
  closeAssetDrawer();
  currentId = assetId;
  const close = () => { location.hash = `#/eventos/${state.bundle.event.id}/materiais`; };
  const overlay = h('div', { class: 'drawer-overlay', onClick: close });
  const previewSlot = h('div');
  const rest = h('div', { class: 'col gap-16' });
  const body = h('div', { class: 'drawer-body' }, previewSlot, rest);
  const header = h('div', { class: 'drawer-header' });
  const el = h('aside', { class: 'drawer' }, header, body);
  append(document.body, overlay, el);
  drawer = { overlay, el, body, header, previewSlot, rest, previewKey: null };
  unsub = subscribe((topic) => { if (topic === 'refresh' || topic === 'bundle') renderBody({ keepPreview: true }); });
  renderBody({});
}

const WORKFLOW = ['recebido', 'em_revisao', 'aprovado', 'final'];

function renderBody({ keepPreview }) {
  if (!drawer) return;
  const bundle = state.bundle;
  const a = lookups.asset(currentId);
  const scroll = drawer.body.scrollTop;
  clear(drawer.header); clear(drawer.rest);
  if (!a) { clear(drawer.previewSlot); append(drawer.rest, h('div', { class: 'empty' }, 'Material não encontrado (pode ter sido excluído).')); return; }
  const eventId = bundle.event.id;
  const tools = state.system?.tools || {};
  const session = lookups.session(a.sessionId);
  const source = a.derivedFrom ? lookups.asset(a.derivedFrom) : null;

  append(drawer.header, 
    h('div', { class: 'grow', style: { minWidth: 0 } },
      h('div', { class: 'flex gap-4 mb-8 flex-wrap' }, h('span', { class: 'badge badge-outline' }, kindIcon(a.kind), KIND_LABELS[a.kind]), statusBadge(a.status), a.version > 1 ? badge(`versão ${a.version}`, 'info') : null, a.duplicateOf ? badge('possível duplicata', 'warn', { title: `Mesmo conteúdo de ${lookups.asset(a.duplicateOf)?.originalName || 'outro arquivo'}` }) : null),
      h('h2', { class: 'ellipsis', title: a.originalName }, a.originalName),
      h('div', { class: 'muted small mt-8' }, session ? h('a', { href: `#/eventos/${eventId}/programacao/${session.id}` }, `${session.start ? session.start + ' · ' : ''}${session.title}`) : 'Sem sessão vinculada')),
    h('div', { class: 'flex' },
      btn('Abrir', { icon: 'external', cls: 'btn-sm', onClick: () => window.open(api.fileUrl(a.id), '_blank') }),
      btn('Baixar', { icon: 'download', cls: 'btn-sm', onClick: () => downloadUrl(api.fileUrl(a.id, { download: true })) }),
      btn('', { icon: 'x', cls: 'btn-ghost btn-icon', title: 'Fechar (Esc)', onClick: () => { location.hash = `#/eventos/${eventId}/materiais`; } })),
  );

  // Preview (kept across re-renders to avoid restarting video playback)
  const previewKey = `${a.id}:${a.version}:${a.derived?.pdf || ''}:${a.derived?.proxy || ''}`;
  if (!keepPreview || drawer.previewKey !== previewKey) {
    replace(drawer.previewSlot, preview(a, tools));
    drawer.previewKey = previewKey;
  }

  const idx = WORKFLOW.indexOf(a.status);
  const workflow = h('div', { class: 'section' },
    h('div', { class: 'section-title' }, 'Fluxo de aprovação'),
    h('div', { class: 'flex flex-wrap' },
      WORKFLOW.map((st, i) => btn(STATUS_LABELS[st], { icon: i <= idx ? 'check' : undefined, cls: `btn-sm ${a.status === st ? 'btn-primary' : i < idx ? '' : 'btn-ghost'}`, onClick: () => setStatus(a, st) })),
      h('span', { class: 'sep' }),
      btn('Rejeitar', { icon: 'x', cls: `btn-sm ${a.status === 'rejeitado' ? 'btn-danger' : 'btn-ghost'}`, onClick: () => setStatus(a, 'rejeitado') })),
    a.statusBy ? h('div', { class: 'muted small' }, `Status definido por ${a.statusBy} ${fmtRelative(a.statusAt)}`) : null,
  );

  const name = h('input', { class: 'input', value: a.name });
  const tagsInput = h('input', { class: 'input', value: (a.tags || []).join(', '), placeholder: 'tags separadas por vírgula' });
  const notes = h('textarea', { class: 'textarea', rows: 3, placeholder: 'Observações (ex.: precisa de fontes, vídeo no slide 12…)' }, a.notes || '');
  const details = h('div', { class: 'section' },
    h('div', { class: 'section-title' }, 'Detalhes'),
    h('div', { class: 'form-grid' },
      h('label', { class: 'field' }, 'Nome de exibição', name),
      h('label', { class: 'field' }, 'Tipo', select(Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label })), a.kind, { onChange: (v) => save(a, { kind: v }) })),
      h('label', { class: 'field' }, 'Sessão', select(bundle.sessions.map((s) => ({ value: s.id, label: `${s.date ? s.date.slice(5) + ' ' : ''}${s.start ? s.start + ' ' : ''}${s.title}` })), a.sessionId || '', { empty: '— sem sessão —', onChange: (v) => save(a, { sessionId: v || null }) })),
      h('label', { class: 'field' }, 'Palestrante', select(bundle.speakers.map((s) => ({ value: s.id, label: s.name })), a.speakerId || '', { empty: '— nenhum —', onChange: (v) => save(a, { speakerId: v || null }) })),
      h('label', { class: 'field span-2' }, 'Tags', tagsInput),
      h('label', { class: 'field span-2' }, 'Observações', notes)),
    h('div', { class: 'flex' }, btn('Salvar alterações', { icon: 'save', cls: 'btn-sm', onClick: () => save(a, { name: name.value, tags: tagsInput.value, notes: notes.value }, 'Alterações salvas') })),
  );

  const metaRows = [
    ['Arquivo original', a.originalName], ['Tamanho', fmtBytes(a.size)], ['Enviado por', `${a.uploadedBy} · ${fmtDateTime(a.uploadedAt)}`], ['Origem', { upload: 'Envio pelo navegador', importacao: 'Importado de pasta', corte: 'Corte renderizado', conversao: 'Conversão' }[a.source] || a.source],
    a.meta?.slides ? ['Slides', a.meta.slides] : null, a.meta?.pages ? ['Páginas', a.meta.pages] : null,
    a.meta?.duration ? ['Duração', fmtDuration(a.meta.duration)] : null, a.meta?.width ? ['Resolução', `${a.meta.width}×${a.meta.height}${a.meta.fps ? ` @ ${a.meta.fps}fps` : ''}`] : null,
    a.meta?.videoCodec ? ['Codec', `${a.meta.videoCodec}${a.meta.audioCodec ? ' / ' + a.meta.audioCodec : ''}`] : null, a.meta?.bitrate ? ['Bitrate', `${Math.round(a.meta.bitrate / 1000)} kbps`] : null,
    source ? ['Derivado de', h('a', { href: `#/eventos/${eventId}/materiais/${source.id}` }, source.originalName)] : null,
    ['SHA-256', h('span', { class: 'mono small', style: { cursor: 'pointer' }, title: 'Clique para copiar', onClick: () => copyText(a.sha256) }, a.sha256.slice(0, 16) + '…')],
    ['Arquivo em disco', h('span', { class: 'mono small' }, a.fileName)],
  ].filter(Boolean);
  const meta = h('div', { class: 'section' }, h('div', { class: 'section-title' }, 'Informações técnicas', !a.analyzed ? h('span', { class: 'muted', style: { textTransform: 'none', letterSpacing: 0 } }, h('span', { class: 'spinner', style: { width: '12px', height: '12px', marginRight: '6px' } }), 'analisando…') : null),
    h('div', { class: 'meta-grid' }, metaRows.map(([k, v]) => h('div', null, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v)))));

  const versionInput = h('input', { type: 'file', class: 'hidden', onChange: async (e) => { const f = e.target.files[0]; if (!f) return; const note = await promptDialog({ title: 'Nova versão', label: 'O que mudou? (opcional)', confirmLabel: 'Enviar' }); if (note === null) return; enqueueUploads([f], { eventId, assetId: a.id, note }); e.target.value = ''; } });
  const versions = h('div', { class: 'section' },
    h('div', { class: 'section-title' }, `Versões (${a.versions.length + 1})`, btn('Enviar nova versão', { icon: 'upload', cls: 'btn-ghost btn-sm', onClick: () => versionInput.click() })),
    versionInput,
    h('div', { class: 'col gap-4' },
      h('div', { class: 'version-row' }, badge(`v${a.version}`, 'ok'), h('span', { class: 'grow ellipsis' }, a.originalName), h('span', { class: 'muted' }, `${fmtBytes(a.size)} · ${a.uploadedBy} · ${fmtRelative(a.uploadedAt)}`), h('span', { class: 'muted small' }, 'atual')),
      [...a.versions].reverse().map((v) => h('div', { class: 'version-row' }, badge(`v${v.version}`, 'outline'), h('span', { class: 'grow ellipsis' }, v.originalName), h('span', { class: 'muted' }, `${fmtBytes(v.size)} · ${v.uploadedBy} · ${fmtRelative(v.uploadedAt)}`), btn('', { icon: 'download', cls: 'btn-ghost btn-icon btn-sm', title: 'Baixar esta versão', onClick: () => downloadUrl(api.versionUrl(a.id, v.id)) })))),
  );

  const actions = h('div', { class: 'section' }, h('div', { class: 'section-title' }, 'Ações'),
    h('div', { class: 'flex flex-wrap' },
      ['video', 'corte'].includes(a.kind) ? btn('Criar corte', { icon: 'scissors', cls: 'btn-sm btn-primary', onClick: () => { location.hash = `#/eventos/${eventId}/cortes/novo?asset=${a.id}`; } }) : null,
      ['video', 'corte'].includes(a.kind) && tools.ffmpeg ? btn(a.derived?.proxy ? 'Regerar prévia MP4' : 'Gerar prévia MP4', { icon: 'video', cls: 'btn-sm', title: 'Cria uma versão leve em H.264 para pré-visualizar no navegador', onClick: async () => { await api.post(`/api/assets/${a.id}/proxy`); toast('Prévia MP4 na fila de processamento'); } }) : null,
      a.kind === 'apresentacao' || a.kind === 'documento' ? btn(a.derived?.pdf ? 'Regerar prévia PDF' : 'Gerar prévia PDF', { icon: 'pdf', cls: 'btn-sm', disabled: !tools.libreoffice, title: tools.libreoffice ? 'Converte com LibreOffice' : 'LibreOffice não encontrado no servidor', onClick: async () => { await api.post(`/api/assets/${a.id}/convert`); toast('Conversão na fila de processamento'); } }) : null,
      a.derived?.pdf ? btn('Salvar PDF como material de backup', { icon: 'plus', cls: 'btn-sm', onClick: async () => { const created = await api.post(`/api/assets/${a.id}/pdf-backup`); toast('PDF de backup adicionado aos materiais', { type: 'ok' }); await refresh(); location.hash = `#/eventos/${eventId}/materiais/${created.id}`; } }) : null,
      btn('Reanalisar', { icon: 'refresh', cls: 'btn-sm btn-ghost', onClick: async () => { await api.post(`/api/assets/${a.id}/analyze`); toast('Análise na fila'); } }),
      btn('Excluir', { icon: 'trash', cls: 'btn-sm btn-danger', onClick: async () => { if (await confirmDialog({ title: 'Excluir material', message: `Enviar "${a.originalName}" para a lixeira do evento? Você pode esvaziar a lixeira em Exportar & config.`, confirmLabel: 'Excluir', danger: true })) { await api.delete(`/api/assets/${a.id}`); toast('Material excluído'); location.hash = `#/eventos/${eventId}/materiais`; refresh(); } } })));

  const relatedClips = bundle.clips.filter((c) => c.sourceAssetId === a.id || c.outputAssetId === a.id);
  append(drawer.rest, workflow, details, meta, versions,
    relatedClips.length ? h('div', { class: 'section' }, h('div', { class: 'section-title' }, 'Cortes relacionados'), h('div', { class: 'list' }, relatedClips.map((c) => h('a', { class: 'list-item clickable', href: `#/eventos/${eventId}/cortes/${c.id}` }, icon('scissors', 'kind-icon kind-corte'), h('div', { class: 'body' }, h('div', { class: 'title' }, c.title), h('div', { class: 'sub' }, `${fmtDuration(c.start)} → ${fmtDuration(c.end)} · ${c.status}`)))))) : null,
    actions);
  drawer.body.scrollTop = scroll;
}

async function setStatus(a, status) {
  await api.patch(`/api/assets/${a.id}`, { status });
  toast(`Marcado como ${STATUS_LABELS[status]}`, { type: 'ok', timeout: 1500 });
  refresh();
}

async function save(a, patch, msg) {
  await api.patch(`/api/assets/${a.id}`, patch);
  if (msg) toast(msg, { type: 'ok', timeout: 1500 });
  refresh();
}

function preview(a, tools) {
  const wrap = h('div', { class: 'preview' });
  const fallback = (text, extra) => h('div', { class: 'fallback' }, kindIcon(a.kind, 'kind-icon'), h('div', null, text), extra);
  if (['video', 'corte'].includes(a.kind)) {
    const playable = ['mp4', 'm4v', 'webm', 'mov'].includes(a.ext) || a.derived?.proxy;
    if (playable) {
      const video = h('video', { controls: true, preload: 'metadata', src: a.derived?.proxy ? api.previewUrl(a.id) : api.fileUrl(a.id) });
      video.addEventListener('error', () => { replace(wrap, fallback('O navegador não conseguiu reproduzir este vídeo.', tools.ffmpeg ? h('div', { class: 'small mt-8' }, 'Use "Gerar prévia MP4" nas ações abaixo.') : null)); });
      append(wrap, video);
      if (a.derived?.proxy) append(wrap, h('div', { class: 'small muted', style: { padding: '4px 8px', alignSelf: 'flex-start' } }, 'Exibindo prévia MP4 (qualidade reduzida)'));
    } else append(wrap, fallback(`Formato .${a.ext} não reproduz no navegador.`, tools.ffmpeg ? h('div', { class: 'small mt-8' }, 'Use "Gerar prévia MP4" nas ações abaixo.') : null));
  } else if (a.kind === 'pdf') {
    append(wrap, h('iframe', { src: api.fileUrl(a.id) + '#toolbar=1', title: a.originalName }));
  } else if (a.kind === 'imagem' && a.ext !== 'heic' && a.ext !== 'tif' && a.ext !== 'tiff') {
    append(wrap, h('img', { src: api.fileUrl(a.id), alt: a.originalName }));
  } else if (a.kind === 'audio') {
    append(wrap, h('audio', { controls: true, src: api.fileUrl(a.id), style: { width: '100%', padding: '20px' } }));
  } else if (a.derived?.pdf) {
    append(wrap, h('iframe', { src: api.previewUrl(a.id) + '#toolbar=0', title: a.originalName }));
  } else if (a.kind === 'apresentacao') {
    append(wrap, fallback('Sem prévia para esta apresentação.', tools.libreoffice ? h('div', { class: 'small mt-8' }, 'Gere a prévia em PDF nas ações abaixo (automático quando habilitado nas configurações).') : h('div', { class: 'small mt-8' }, 'Instale o LibreOffice no servidor para gerar prévias em PDF.')));
  } else {
    append(wrap, fallback('Sem prévia para este tipo de arquivo.'));
  }
  return wrap;
}
