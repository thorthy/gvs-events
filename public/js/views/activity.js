// Activity log tab.
import { h, icon, select, fmtDateTime, debounce, append, replace, clear } from '../dom.js';
import { api } from '../api.js';

export function renderActivity(container, { bundle }) {
  const list = h('div', { class: 'muted' }, 'Carregando…');
  let items = [];
  const userSel = select([], '', { cls: 'select-sm input-inline', empty: 'Todos os usuários' });
  const entitySel = select([{ value: 'evento', label: 'Evento' }, { value: 'sessao', label: 'Sessões' }, { value: 'material', label: 'Materiais' }, { value: 'corte', label: 'Cortes' }, { value: 'palestrante', label: 'Palestrantes' }, { value: 'sala', label: 'Salas' }], '', { cls: 'select-sm input-inline', empty: 'Tudo' });
  const search = h('input', { class: 'input input-sm', placeholder: 'Filtrar…', style: { width: '220px' } });
  const draw = () => {
    const q = search.value.toLowerCase();
    const filtered = items.filter((a) => (!userSel.value || a.user === userSel.value) && (!entitySel.value || a.entity === entitySel.value) && (!q || `${a.user} ${a.action} ${a.entity} ${a.detail}`.toLowerCase().includes(q)));
    clear(list);
    list.className = '';
    if (!filtered.length) { append(list, h('p', { class: 'muted' }, 'Nenhum registro.')); return; }
    for (const a of filtered) append(list, h('div', { class: 'activity-item' }, h('div', { class: 'when' }, fmtDateTime(a.ts)), h('div', null, h('span', { class: 'who' }, a.user), ` ${a.action} `, h('span', { class: 'muted' }, a.entity), a.detail ? `: ${a.detail}` : '')));
  };
  [userSel, entitySel].forEach((s) => s.addEventListener('change', draw));
  search.addEventListener('input', debounce(draw, 200));
  api.get(`/api/events/${bundle.event.id}/activity?limit=1000`).then((data) => {
    items = data;
    const users = [...new Set(items.map((a) => a.user))].sort();
    for (const u of users) append(userSel, h('option', { value: u }, u));
    draw();
  });
  append(container, h('div', { class: 'flex flex-wrap mb-16' }, search, userSel, entitySel), h('div', { class: 'card' }, list));
}
