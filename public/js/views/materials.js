// Materials tab: filterable table with bulk actions and upload zone.
import { h, icon, btn, badge, statusBadge, kindIcon, select, confirmDialog, toast, fmtBytes, fmtDuration, fmtRelative, STATUS_LABELS, KIND_LABELS, debounce, append, replace, clear } from '../dom.js';
import { api } from '../api.js';
import { lookups, refresh } from '../state.js';
import { dropzone, enqueueUploads, wireDrop } from '../uploads.js';

const filters = { q: '', kind: '', status: '', session: '', sort: 'recentes' };
const selected = new Set();

export function renderMaterials(container, { bundle }) {
  const { event, assets, sessions } = bundle;
  const q = filters.q.toLowerCase();
  let list = assets.filter((a) =>
    (!filters.kind || a.kind === filters.kind) &&
    (!filters.status || a.status === filters.status || (filters.status === 'pendentes' && ['recebido', 'em_revisao'].includes(a.status))) &&
    (!filters.session || (filters.session === 'sem' ? !a.sessionId : a.sessionId === filters.session)) &&
    (!q || [a.originalName, a.name, a.notes, ...(a.tags || []), lookups.sessionLabel(a.sessionId), lookups.speaker(a.speakerId)?.name].filter(Boolean).join(' ').toLowerCase().includes(q)));
  const sorters = {
    recentes: (a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''),
    nome: (a, b) => a.originalName.localeCompare(b.originalName),
    tamanho: (a, b) => (b.size || 0) - (a.size || 0),
    sessao: (a, b) => (lookups.sessionLabel(a.sessionId) || 'zzz').localeCompare(lookups.sessionLabel(b.sessionId) || 'zzz'),
    status: (a, b) => a.status.localeCompare(b.status),
  };
  list.sort(sorters[filters.sort] || sorters.recentes);
  for (const id of [...selected]) if (!assets.some((a) => a.id === id)) selected.delete(id);

  const rerender = () => { clear(container); renderMaterials(container, { bundle }); };
  const searchInput = h('input', { class: 'input input-sm', placeholder: 'Filtrar por nome, tag, sessão…', value: filters.q, style: { width: '260px' }, onInput: debounce((e) => { filters.q = e.target.value; rerender(); setTimeout(() => { const i = container.querySelector('input.input-sm'); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); }, 0); }, 250) });
  const sessionOptions = [{ value: 'sem', label: 'Sem sessão' }, ...sessions.map((s) => ({ value: s.id, label: `${s.date ? s.date.slice(5) + ' ' : ''}${s.start ? s.start + ' ' : ''}${s.title}` }))];

  append(container, 
    h('div', { class: 'flex between flex-wrap mb-16' },
      h('div', { class: 'flex flex-wrap' },
        searchInput,
        select(Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label })), filters.kind, { cls: 'select-sm input-inline', empty: 'Todos os tipos', onChange: (v) => { filters.kind = v; rerender(); } }),
        select([{ value: 'pendentes', label: 'Aguardando revisão' }, ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))], filters.status, { cls: 'select-sm input-inline', empty: 'Todos os status', onChange: (v) => { filters.status = v; rerender(); } }),
        select(sessionOptions, filters.session, { cls: 'select-sm input-inline', empty: 'Todas as sessões', onChange: (v) => { filters.session = v; rerender(); } }),
        select([{ value: 'recentes', label: 'Mais recentes' }, { value: 'nome', label: 'Nome' }, { value: 'tamanho', label: 'Tamanho' }, { value: 'sessao', label: 'Sessão' }, { value: 'status', label: 'Status' }], filters.sort, { cls: 'select-sm input-inline', onChange: (v) => { filters.sort = v; rerender(); } })),
      h('div', { class: 'flex' }, h('span', { class: 'muted small' }, `${list.length} de ${assets.length}`), btn('Enviar arquivos', { icon: 'upload', cls: 'btn-primary btn-sm', onClick: () => container.querySelector('.dropzone input')?.click() }))),
    dropzone({ eventId: event.id, label: 'Arraste arquivos aqui para enviar ao evento', hint: 'Depois associe cada arquivo a uma sessão. Dica: arraste direto para a linha da sessão na programação para já vincular.' }),
    list.length ? table(bundle, list, rerender) : h('div', { class: 'empty mt-16' }, icon('folder'), h('h3', null, assets.length ? 'Nenhum material com esses filtros' : 'Nenhum material enviado'), h('p', null, assets.length ? 'Ajuste os filtros acima.' : 'Envie apresentações, PDFs, vídeos e outros arquivos.')),
    selected.size ? bulkBar(bundle, rerender) : null,
  );
}

function table(bundle, list, rerender) {
  const eventId = bundle.event.id;
  const allSelected = list.every((a) => selected.has(a.id));
  return h('div', { class: 'table-wrap mt-16' }, h('table', { class: 'table' },
    h('thead', null, h('tr', null,
      h('th', { style: { width: '32px' } }, h('input', { type: 'checkbox', checked: allSelected && list.length > 0, onChange: (e) => { for (const a of list) e.target.checked ? selected.add(a.id) : selected.delete(a.id); rerender(); } })),
      h('th', null, 'Arquivo'), h('th', null, 'Tipo'), h('th', null, 'Sessão'), h('th', null, 'Status'), h('th', null, 'Detalhes'), h('th', null, 'Enviado'), h('th', null))),
    h('tbody', null, list.map((a) => {
      const session = lookups.session(a.sessionId);
      const details = [fmtBytes(a.size), a.meta?.slides ? `${a.meta.slides} slides` : null, a.meta?.pages ? `${a.meta.pages} pág.` : null, a.meta?.duration ? fmtDuration(a.meta.duration) : null, a.meta?.width ? `${a.meta.width}×${a.meta.height}` : null].filter(Boolean).join(' · ');
      const open = () => { location.hash = `#/eventos/${eventId}/materiais/${a.id}`; };
      return h('tr', { class: `clickable ${selected.has(a.id) ? 'selected' : ''}` },
        h('td', { onClick: (e) => e.stopPropagation() }, h('input', { type: 'checkbox', checked: selected.has(a.id), onChange: (e) => { e.target.checked ? selected.add(a.id) : selected.delete(a.id); rerender(); } })),
        h('td', { onClick: open }, h('div', { class: 'flex' }, thumb(a), h('div', { class: 'grow', style: { minWidth: 0 } },
          h('div', { class: 'ellipsis', style: { fontWeight: 600, maxWidth: '360px' }, title: a.originalName }, a.originalName),
          h('div', { class: 'muted small flex gap-4 flex-wrap' }, a.version > 1 ? badge(`v${a.version}`, 'outline') : null, a.duplicateOf ? badge('possível duplicata', 'warn') : null, a.derived?.pdf ? badge('prévia PDF', 'info') : null, (a.tags || []).map((t) => h('span', { class: 'tag' }, t)))))),
        h('td', { onClick: open }, h('span', { class: 'flex gap-4' }, kindIcon(a.kind), KIND_LABELS[a.kind])),
        h('td', { onClick: (e) => e.stopPropagation() }, select([{ value: '', label: '— sem sessão —' }, ...bundle.sessions.map((s) => ({ value: s.id, label: `${s.start ? s.start + ' ' : ''}${s.title}` }))], a.sessionId || '', { cls: 'select-sm', onChange: async (v) => { await api.patch(`/api/assets/${a.id}`, { sessionId: v || null }); refresh(); } })),
        h('td', { onClick: (e) => e.stopPropagation() }, select(Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })), a.status, { cls: `select-sm status-select status-${a.status}`, onChange: async (v) => { await api.patch(`/api/assets/${a.id}`, { status: v }); refresh(); } })),
        h('td', { class: 'small muted nowrap', onClick: open }, details, !a.analyzed ? h('span', { class: 'spinner', style: { marginLeft: '6px', width: '12px', height: '12px' }, title: 'Analisando…' }) : null),
        h('td', { class: 'small muted nowrap', onClick: open }, fmtRelative(a.uploadedAt), h('div', null, a.uploadedBy)),
        h('td', { onClick: (e) => e.stopPropagation() }, h('div', { class: 'flex gap-4' },
          btn('', { icon: 'external', cls: 'btn-ghost btn-icon btn-sm', title: 'Abrir', onClick: () => window.open(api.fileUrl(a.id), '_blank') }),
          btn('', { icon: 'download', cls: 'btn-ghost btn-icon btn-sm', title: 'Baixar', onClick: () => window.open(api.fileUrl(a.id, { download: true }), '_blank') }))));
    }))));
}

export function thumb(a, cls = 'thumb') {
  const el = h('div', { class: cls }, kindIcon(a.kind));
  if (a.thumb) {
    const img = h('img', { src: api.thumbUrl(a.id, a.updatedAt), alt: '', loading: 'lazy' });
    img.addEventListener('error', () => img.remove());
    replace(el, img);
  }
  return el;
}

function bulkBar(bundle, rerender) {
  const ids = [...selected];
  const run = async (fn, label) => { for (const id of ids) await fn(id); toast(label, { type: 'ok' }); selected.clear(); await refresh(); };
  return h('div', { class: 'bulk-bar' },
    h('strong', null, `${ids.length} selecionado(s)`),
    select(Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })), '', { cls: 'select-sm input-inline', empty: 'Alterar status…', onChange: (v) => v && run((id) => api.patch(`/api/assets/${id}`, { status: v }), 'Status atualizado') }),
    select([{ value: 'sem', label: '— sem sessão —' }, ...bundle.sessions.map((s) => ({ value: s.id, label: `${s.start ? s.start + ' ' : ''}${s.title}` }))], '', { cls: 'select-sm input-inline', empty: 'Mover para sessão…', onChange: (v) => v && run((id) => api.patch(`/api/assets/${id}`, { sessionId: v === 'sem' ? null : v }), 'Sessão atualizada') }),
    btn('Excluir', { icon: 'trash', cls: 'btn-sm btn-danger', onClick: async () => { if (await confirmDialog({ title: 'Excluir materiais', message: `Enviar ${ids.length} arquivo(s) para a lixeira do evento?`, confirmLabel: 'Excluir', danger: true })) run((id) => api.delete(`/api/assets/${id}`), 'Materiais excluídos'); } }),
    btn('Limpar seleção', { cls: 'btn-ghost btn-sm', onClick: () => { selected.clear(); rerender(); } }),
  );
}
