// Session drawer: details, materials, checklist, notes, clips.
import { h, clear, icon, btn, badge, readinessBadge, statusBadge, kindIcon, select, confirmDialog, promptDialog, toast, fmtDate, fmtBytes, fmtDuration, fmtRelative, STATUS_LABELS, SESSION_TYPE_LABELS, CLIP_STATUS_LABELS, CLIP_STATUS_BADGE, downloadUrl, append, replace } from '../dom.js';
import { api } from '../api.js';
import { state, lookups, refresh, subscribe } from '../state.js';
import { dropzone, enqueueUploads } from '../uploads.js';
import { sessionForm } from './schedule.js';

let drawer = null; let currentId = null; let unsub = null;

export function closeSessionDrawer() {
  if (drawer) { drawer.overlay.remove(); drawer.el.remove(); drawer = null; }
  currentId = null;
  if (unsub) { unsub(); unsub = null; }
}

export function openSessionDrawer(sessionId) {
  if (drawer && currentId === sessionId) { renderBody(); return; }
  closeSessionDrawer();
  currentId = sessionId;
  const close = () => { location.hash = `#/eventos/${state.bundle.event.id}/programacao`; };
  const overlay = h('div', { class: 'drawer-overlay', onClick: close });
  const body = h('div', { class: 'drawer-body' });
  const header = h('div', { class: 'drawer-header' });
  const el = h('aside', { class: 'drawer' }, header, body);
  append(document.body, overlay, el);
  drawer = { overlay, el, body, header };
  unsub = subscribe((topic) => { if (topic === 'refresh' || topic === 'bundle') renderBody(); });
  renderBody();
}

function renderBody() {
  if (!drawer) return;
  const bundle = state.bundle;
  const s = lookups.session(currentId);
  const scroll = drawer.body.scrollTop;
  clear(drawer.header); clear(drawer.body);
  if (!s) { append(drawer.body, h('div', { class: 'empty' }, 'Sessão não encontrada (pode ter sido excluída).')); return; }
  const eventId = bundle.event.id;
  const assets = lookups.sessionAssets(s.id);
  const live = assets.filter((a) => !['substituido'].includes(a.status));
  const clips = bundle.clips.filter((c) => c.sessionId === s.id);
  const speakers = (s.speakerIds || []).map((id) => lookups.speaker(id)).filter(Boolean);

  append(drawer.header, 
    h('div', { class: 'grow' },
      h('div', { class: 'flex gap-4 mb-8' }, h('span', { class: 'badge badge-outline' }, SESSION_TYPE_LABELS[s.type]), readinessBadge(s.readiness)),
      h('h2', null, s.title),
      h('div', { class: 'muted small mt-8' }, [fmtDate(s.date, { weekday: true }), s.start ? `${s.start}${s.end ? '–' + s.end : ''}` : null, lookups.room(s.roomId)?.name].filter(Boolean).join(' · '))),
    h('div', { class: 'flex' },
      btn('', { icon: 'edit', cls: 'btn-icon', title: 'Editar sessão', onClick: () => sessionForm(bundle, {}, s) }),
      btn('', { icon: 'more', cls: 'btn-icon', title: 'Mais ações', onClick: (e) => moreActions(e, s, eventId, live) }),
      btn('', { icon: 'x', cls: 'btn-ghost btn-icon', title: 'Fechar (Esc)', onClick: () => { location.hash = `#/eventos/${eventId}/programacao`; } })),
  );

  const materialsSection = h('div', { class: 'section' },
    h('div', { class: 'section-title' }, h('span', null, `Materiais (${live.length})`), s.type !== 'intervalo' ? h('label', { class: 'checkbox small', style: { fontWeight: 400, textTransform: 'none', letterSpacing: 0 } }, h('input', { type: 'checkbox', checked: s.noMaterial, onChange: async (e) => { await api.patch(`/api/sessions/${s.id}`, { noMaterial: e.target.checked }); refresh(); } }), 'Não precisa de material') : null),
    live.length ? h('div', { class: 'list' }, live.map((a) => assetRow(a, eventId))) : h('p', { class: 'muted small' }, 'Nenhum material ainda. Envie abaixo ou arraste para esta sessão na programação.'),
    s.type === 'intervalo' ? null : dropzone({ eventId, sessionId: s.id, compact: true, label: 'Enviar material para esta sessão' }),
  );

  const checklist = h('div', { class: 'section' },
    h('div', { class: 'section-title' }, h('span', null, `Checklist (${s.readiness.checklistDone}/${s.readiness.checklistTotal})`),
      btn('Adicionar item', { icon: 'plus', cls: 'btn-ghost btn-sm', onClick: async () => { const text = await promptDialog({ title: 'Novo item do checklist', label: 'Descrição' }); if (text) { await api.post(`/api/sessions/${s.id}/checklist`, { text }); refresh(); } } })),
    s.checklist.length ? h('div', null, s.checklist.map((item) => h('div', { class: `checklist-item ${item.done ? 'done' : ''}` },
      h('input', { type: 'checkbox', checked: item.done, onChange: async (e) => { await api.patch(`/api/sessions/${s.id}/checklist/${item.id}`, { done: e.target.checked }); refresh(); } }),
      h('span', { class: 'text grow' }, item.text),
      item.done ? h('span', { class: 'by' }, `${item.doneBy} · ${fmtRelative(item.doneAt)}`) : null,
      btn('', { icon: 'x', cls: 'btn-ghost btn-icon btn-sm remove', title: 'Remover item', onClick: async () => { await api.delete(`/api/sessions/${s.id}/checklist/${item.id}`); refresh(); } })))) : h('p', { class: 'muted small' }, 'Sem itens de checklist.'),
  );

  const notes = h('textarea', { class: 'textarea', rows: 3, placeholder: 'Observações para a equipe (ex.: palestrante vai usar o próprio notebook, precisa de adaptador HDMI…)' }, s.notes || '');
  let notesTimer;
  notes.addEventListener('input', () => { clearTimeout(notesTimer); notesTimer = setTimeout(async () => { await api.patch(`/api/sessions/${s.id}`, { notes: notes.value }); toast('Observações salvas', { type: 'ok', timeout: 1500 }); }, 800); });

  append(drawer.body, 
    speakers.length || s.description ? h('div', { class: 'section' },
      speakers.length ? h('div', { class: 'flex flex-wrap' }, speakers.map((sp) => h('span', { class: 'chip', title: [sp.company, sp.role, sp.email].filter(Boolean).join(' · ') }, icon('mic', 'kind-icon'), sp.name))) : null,
      s.description ? h('p', { class: 'muted' }, s.description) : null) : null,
    materialsSection,
    checklist,
    h('div', { class: 'section' }, h('div', { class: 'section-title' }, 'Observações'), notes),
    clips.length ? h('div', { class: 'section' }, h('div', { class: 'section-title' }, `Cortes (${clips.length})`), h('div', { class: 'list' }, clips.map((c) => h('a', { class: 'list-item clickable', href: `#/eventos/${eventId}/cortes/${c.id}` }, icon('scissors', 'kind-icon kind-corte'), h('div', { class: 'body' }, h('div', { class: 'title' }, c.title), h('div', { class: 'sub' }, `${fmtDuration(c.start)} → ${fmtDuration(c.end)} · ${(c.destinations || []).join(', ') || 'sem destino'}`)), badge(CLIP_STATUS_LABELS[c.status], CLIP_STATUS_BADGE[c.status]))))) : null,
    h('div', { class: 'section' }, h('div', { class: 'section-title' }, 'Ações'),
      h('div', { class: 'flex flex-wrap' },
        btn('Baixar aprovados (ZIP)', { icon: 'download', cls: 'btn-sm', onClick: () => downloadUrl(api.sessionZipUrl(s.id)), disabled: !live.some((a) => ['aprovado', 'final'].includes(a.status)) }),
        btn('Baixar todos (ZIP)', { icon: 'download', cls: 'btn-sm', onClick: () => downloadUrl(api.sessionZipUrl(s.id, 'todos')), disabled: !live.length }),
        btn('Duplicar', { icon: 'copy', cls: 'btn-sm', onClick: async () => { const c = await api.post(`/api/sessions/${s.id}/duplicate`); await refresh(); location.hash = `#/eventos/${eventId}/programacao/${c.id}`; } }),
        btn('Excluir sessão', { icon: 'trash', cls: 'btn-sm btn-danger', onClick: async () => {
          if (await confirmDialog({ title: 'Excluir sessão', message: `Excluir "${s.title}"? Os materiais continuam na biblioteca, apenas desvinculados.`, confirmLabel: 'Excluir', danger: true })) {
            await api.delete(`/api/sessions/${s.id}`); toast('Sessão excluída'); location.hash = `#/eventos/${eventId}/programacao`; refresh();
          } } }))),
  );
  drawer.body.scrollTop = scroll;
}

function assetRow(a, eventId) {
  const meta = [fmtBytes(a.size), a.meta?.slides ? `${a.meta.slides} slides` : null, a.meta?.pages ? `${a.meta.pages} pág.` : null, a.meta?.duration ? fmtDuration(a.meta.duration) : null, a.version > 1 ? `v${a.version}` : null].filter(Boolean).join(' · ');
  return h('div', { class: 'list-item' },
    kindIcon(a.kind),
    h('div', { class: 'body' }, h('a', { class: 'title', href: `#/eventos/${eventId}/materiais/${a.id}`, style: { display: 'block' } }, a.originalName), h('div', { class: 'sub' }, meta)),
    select(Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })), a.status, { cls: `select-sm input-inline status-select status-${a.status}`, onChange: async (v) => { await api.patch(`/api/assets/${a.id}`, { status: v }); refresh(); } }),
    btn('', { icon: 'external', cls: 'btn-ghost btn-icon btn-sm', title: 'Abrir arquivo', onClick: () => window.open(api.fileUrl(a.id), '_blank') }),
  );
}

function moreActions(e, s, eventId, live) {
  const menu = h('div', { class: 'card', style: { position: 'fixed', zIndex: 100, padding: '6px', minWidth: '220px', display: 'flex', flexDirection: 'column', gap: '2px' } });
  const item = (label, ic, onClick) => h('button', { class: 'btn btn-ghost', style: { justifyContent: 'flex-start' }, onClick: () => { menu.remove(); onClick(); } }, icon(ic), label);
  append(menu, 
    item('Marcar todos os materiais como aprovados', 'check', async () => { for (const a of live) if (!['aprovado', 'final'].includes(a.status)) await api.patch(`/api/assets/${a.id}`, { status: 'aprovado' }); refresh(); }),
    item('Concluir todo o checklist', 'check', async () => { for (const c of s.checklist) if (!c.done) await api.patch(`/api/sessions/${s.id}/checklist/${c.id}`, { done: true }); refresh(); }),
    item('Reabrir checklist', 'refresh', async () => { for (const c of s.checklist) if (c.done) await api.patch(`/api/sessions/${s.id}/checklist/${c.id}`, { done: false }); refresh(); }),
  );
  const rect = e.currentTarget.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 6}px`;
  menu.style.right = `${window.innerWidth - rect.right}px`;
  append(document.body, menu);
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
}
