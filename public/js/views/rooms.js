// Rooms tab.
import { h, icon, btn, formModal, confirmDialog, toast, append, replace, clear } from '../dom.js';
import { api } from '../api.js';
import { refresh } from '../state.js';

export function renderRooms(container, { bundle }) {
  const { event, rooms, sessions } = bundle;
  append(container, 
    h('div', { class: 'flex between mb-16' }, h('p', { class: 'muted' }, 'Salas, palcos ou auditórios do evento. A ordem define as colunas da grade e do modo ao vivo.'), btn('Nova sala', { icon: 'plus', cls: 'btn-primary btn-sm', onClick: () => roomForm(event.id) })),
    rooms.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', { style: { width: '80px' } }, 'Ordem'), h('th', null, 'Sala'), h('th', null, 'Capacidade'), h('th', null, 'Sessões'), h('th', null, 'Observações'), h('th', null))),
      h('tbody', null, rooms.map((r, i) => h('tr', null,
        h('td', null, h('div', { class: 'flex gap-4' }, btn('', { icon: 'chevronLeft', cls: 'btn-ghost btn-icon btn-sm', disabled: i === 0, title: 'Mover para cima', onClick: () => swap(rooms, i, i - 1) }), btn('', { icon: 'chevronRight', cls: 'btn-ghost btn-icon btn-sm', disabled: i === rooms.length - 1, title: 'Mover para baixo', onClick: () => swap(rooms, i, i + 1) }))),
        h('td', null, h('strong', null, r.name)),
        h('td', null, r.capacity ? `${r.capacity} lugares` : h('span', { class: 'muted' }, '—')),
        h('td', null, sessions.filter((s) => s.roomId === r.id).length),
        h('td', { class: 'small muted' }, r.notes),
        h('td', null, h('div', { class: 'flex gap-4' }, btn('', { icon: 'edit', cls: 'btn-ghost btn-icon btn-sm', onClick: () => roomForm(event.id, r) }), btn('', { icon: 'trash', cls: 'btn-ghost btn-icon btn-sm', onClick: async () => { if (await confirmDialog({ title: 'Excluir sala', message: `Excluir "${r.name}"? As sessões ficam sem sala.`, confirmLabel: 'Excluir', danger: true })) { await api.delete(`/api/rooms/${r.id}`); refresh(); } } }))))))))
      : h('div', { class: 'empty' }, icon('room'), h('h3', null, 'Nenhuma sala'), h('p', null, 'Crie as salas para organizar a programação por palco.')),
  );
}

async function swap(rooms, i, j) {
  const a = rooms[i]; const b = rooms[j];
  await api.patch(`/api/rooms/${a.id}`, { order: j });
  await api.patch(`/api/rooms/${b.id}`, { order: i });
  // normalize orders
  const reordered = rooms.slice(); [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
  for (let k = 0; k < reordered.length; k++) if (reordered[k].order !== k) await api.patch(`/api/rooms/${reordered[k].id}`, { order: k });
  refresh();
}

export async function roomForm(eventId, existing = null) {
  const r = await formModal({
    title: existing ? 'Editar sala' : 'Nova sala',
    fields: [
      { name: 'name', label: 'Nome', required: true, value: existing?.name || '', placeholder: 'Sala A, Auditório principal, Palco 2…', span: 2 },
      { name: 'capacity', label: 'Capacidade (lugares)', type: 'number', min: 0, value: existing?.capacity ?? '' },
      { name: 'notes', label: 'Observações', type: 'textarea', value: existing?.notes || '', span: 2, placeholder: 'Equipamento disponível, resolução do projetor, contato do técnico…' },
    ],
    onSubmit: (v) => existing ? api.patch(`/api/rooms/${existing.id}`, v) : api.post(`/api/events/${eventId}/rooms`, v),
  });
  if (r) { toast('Sala salva', { type: 'ok' }); refresh(); }
}
