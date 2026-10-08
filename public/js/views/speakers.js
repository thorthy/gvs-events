// Speakers tab.
import { h, icon, btn, badge, formModal, openModal, confirmDialog, toast, statusBadge, kindIcon, fmtDate, initials, append, replace, clear } from '../dom.js';
import { api } from '../api.js';
import { lookups, refresh } from '../state.js';

let q = '';

export function renderSpeakers(container, { bundle }) {
  const { event, speakers, sessions, assets } = bundle;
  const list = speakers.filter((s) => !q || [s.name, s.company, s.role, s.email].join(' ').toLowerCase().includes(q.toLowerCase()));
  const rerender = () => { clear(container); renderSpeakers(container, { bundle }); };
  append(container, 
    h('div', { class: 'flex between flex-wrap mb-16' },
      h('input', { class: 'input input-sm', placeholder: 'Buscar palestrante…', value: q, style: { width: '260px' }, onInput: (e) => { q = e.target.value; rerender(); setTimeout(() => { const i = container.querySelector('input'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 0); } }),
      btn('Novo palestrante', { icon: 'plus', cls: 'btn-primary btn-sm', onClick: () => speakerForm(event.id) })),
    list.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, 'Nome'), h('th', null, 'Empresa / cargo'), h('th', null, 'Contato'), h('th', null, 'Sessões'), h('th', null, 'Materiais'), h('th', null))),
      h('tbody', null, list.map((sp) => {
        const mySessions = sessions.filter((s) => (s.speakerIds || []).includes(sp.id));
        const myAssets = assets.filter((a) => a.speakerId === sp.id || mySessions.some((s) => s.id === a.sessionId));
        const approved = myAssets.filter((a) => ['aprovado', 'final'].includes(a.status)).length;
        return h('tr', { class: 'clickable', onClick: () => speakerDetail(bundle, sp, mySessions, myAssets) },
          h('td', null, h('div', { class: 'flex' }, h('span', { class: 'avatar' }, initials(sp.name)), h('strong', null, sp.name))),
          h('td', null, sp.company, sp.role ? h('div', { class: 'muted small' }, sp.role) : null),
          h('td', { class: 'small' }, sp.email ? h('a', { href: `mailto:${sp.email}`, onClick: (e) => e.stopPropagation() }, sp.email) : null, sp.phone ? h('div', { class: 'muted' }, sp.phone) : null),
          h('td', null, mySessions.length ? mySessions.map((s) => h('div', { class: 'small' }, `${fmtDate(s.date, { year: false })} ${s.start || ''} · ${s.title}`)) : h('span', { class: 'muted' }, '—')),
          h('td', null, myAssets.length ? badge(`${approved}/${myAssets.length} aprovados`, approved === myAssets.length ? 'ok' : 'warn') : h('span', { class: 'muted small' }, 'nenhum')),
          h('td', { onClick: (e) => e.stopPropagation() }, h('div', { class: 'flex gap-4' }, btn('', { icon: 'edit', cls: 'btn-ghost btn-icon btn-sm', title: 'Editar', onClick: () => speakerForm(event.id, sp) }), btn('', { icon: 'trash', cls: 'btn-ghost btn-icon btn-sm', title: 'Excluir', onClick: async () => { if (await confirmDialog({ title: 'Excluir palestrante', message: `Excluir ${sp.name}? As sessões continuam, apenas sem o vínculo.`, confirmLabel: 'Excluir', danger: true })) { await api.delete(`/api/speakers/${sp.id}`); refresh(); } } }))));
      })))) : h('div', { class: 'empty' }, icon('mic'), h('h3', null, speakers.length ? 'Nenhum resultado' : 'Nenhum palestrante'), h('p', null, 'Palestrantes também são criados automaticamente ao importar a programação.')),
  );
}

export async function speakerForm(eventId, existing = null) {
  const r = await formModal({
    title: existing ? 'Editar palestrante' : 'Novo palestrante',
    fields: [
      { name: 'name', label: 'Nome', required: true, value: existing?.name || '', span: 2 },
      { name: 'company', label: 'Empresa', value: existing?.company || '' },
      { name: 'role', label: 'Cargo', value: existing?.role || '' },
      { name: 'email', label: 'E-mail', type: 'email', value: existing?.email || '' },
      { name: 'phone', label: 'Telefone / WhatsApp', value: existing?.phone || '' },
      { name: 'bio', label: 'Mini bio', type: 'textarea', value: existing?.bio || '', span: 2 },
      { name: 'notes', label: 'Observações internas', type: 'textarea', value: existing?.notes || '', span: 2, rows: 2 },
    ],
    onSubmit: (v) => existing ? api.patch(`/api/speakers/${existing.id}`, v) : api.post(`/api/events/${eventId}/speakers`, v),
  });
  if (r) { toast('Palestrante salvo', { type: 'ok' }); refresh(); }
}

function speakerDetail(bundle, sp, mySessions, myAssets) {
  openModal({
    title: sp.name, size: 'wide',
    body: h('div', { class: 'col gap-12' },
      h('div', { class: 'muted' }, [sp.company, sp.role].filter(Boolean).join(' · ')),
      sp.email || sp.phone ? h('div', { class: 'flex gap-12 small' }, sp.email ? h('a', { href: `mailto:${sp.email}` }, sp.email) : null, sp.phone) : null,
      sp.bio ? h('p', null, sp.bio) : null,
      sp.notes ? h('div', { class: 'warning-box' }, sp.notes) : null,
      h('div', { class: 'section-title' }, 'Sessões'),
      mySessions.length ? h('div', { class: 'list' }, mySessions.map((s) => h('a', { class: 'list-item clickable', href: `#/eventos/${bundle.event.id}/programacao/${s.id}` }, h('div', { class: 'body' }, h('div', { class: 'title' }, s.title), h('div', { class: 'sub' }, `${fmtDate(s.date)} ${s.start || ''} · ${lookups.room(s.roomId)?.name || 'sem sala'}`))))) : h('p', { class: 'muted small' }, 'Nenhuma sessão.'),
      h('div', { class: 'section-title' }, 'Materiais'),
      myAssets.length ? h('div', { class: 'list' }, myAssets.map((a) => h('a', { class: 'list-item clickable', href: `#/eventos/${bundle.event.id}/materiais/${a.id}` }, kindIcon(a.kind), h('div', { class: 'body' }, h('div', { class: 'title' }, a.originalName)), statusBadge(a.status)))) : h('p', { class: 'muted small' }, 'Nenhum material.')),
    actions: [{ label: 'Fechar' }],
  });
}
