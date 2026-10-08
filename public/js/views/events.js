// Events list.
import { h, icon, btn, badge, formModal, fmtDateRange, fmtBytes, EVENT_STATUS_LABELS, pluralize, todayIso, append, replace, clear } from '../dom.js';
import { api } from '../api.js';
import { state, loadEvents } from '../state.js';

let filter = 'ativos';

export function renderEvents(container) {
  const events = state.events;
  const filtered = events.filter((e) => filter === 'todos' ? true : filter === 'ativos' ? !['concluido', 'arquivado'].includes(e.status) : e.status === filter);
  append(container, 
    h('div', { class: 'page-header' },
      h('div', { class: 'titles' }, h('h1', null, 'Eventos'), h('div', { class: 'sub' }, `${pluralize(events.length, 'evento', 'eventos')} na biblioteca`)),
      h('div', { class: 'page-actions' }, btn('Novo evento', { icon: 'plus', cls: 'btn-primary', onClick: () => createEvent() }))),
    h('div', { class: 'flex flex-wrap mb-16' }, [['ativos', 'Ativos'], ['planejamento', 'Planejamento'], ['em_andamento', 'Em andamento'], ['concluido', 'Concluídos'], ['todos', 'Todos']].map(([id, label]) =>
      h('button', { class: `chip ${filter === id ? 'active' : ''}`, onClick: () => { filter = id; clear(container); renderEvents(container); } }, label))),
    filtered.length ? h('div', { class: 'grid-cards' }, filtered.map(eventCard)) : h('div', { class: 'empty' }, icon('calendar'), h('h3', null, events.length ? 'Nenhum evento neste filtro' : 'Nenhum evento cadastrado'),
      h('p', null, events.length ? 'Troque o filtro acima.' : 'Crie o primeiro evento para começar a organizar apresentações, PDFs, vídeos e cortes.'),
      events.length ? null : btn('Criar evento', { icon: 'plus', cls: 'btn-primary mt-8', onClick: () => createEvent() })),
  );
}

function eventCard(e) {
  const s = e.stats;
  const total = s.readiness.pronto + s.readiness.parcial + s.readiness.pendente || 1;
  const pct = (n) => `${(n / total) * 100}%`;
  const statusVariant = { planejamento: 'info', em_andamento: 'ok', concluido: 'neutral', arquivado: 'outline' }[e.status];
  return h('a', { class: 'card clickable', href: `#/eventos/${e.id}`, style: { borderTop: `3px solid ${e.color}`, display: 'block', color: 'inherit', textDecoration: 'none' } },
    h('div', { class: 'flex between mb-8' }, h('h2', { class: 'ellipsis', title: e.name }, e.name), badge(EVENT_STATUS_LABELS[e.status] || e.status, statusVariant)),
    h('div', { class: 'muted small' }, icon('calendar', 'kind-icon'), ' ', fmtDateRange(e.startDate, e.endDate), e.venue ? ` · ${e.venue}` : '', e.city ? ` · ${e.city}` : ''),
    h('div', { class: 'flex gap-12 mt-16 small' },
      h('span', null, h('strong', null, s.sessions), ' sessões'),
      h('span', null, h('strong', null, s.assets), ' materiais'),
      h('span', null, h('strong', null, s.clips), ' cortes'),
      h('span', { class: 'muted' }, fmtBytes(s.totalBytes))),
    h('div', { class: 'mt-16' },
      h('div', { class: 'flex between small mb-8' }, h('span', { class: 'muted' }, 'Prontidão das sessões'), h('strong', null, `${s.readyPercent}%`)),
      h('div', { class: 'progress' }, h('span', { class: 'seg-pronto', style: { width: pct(s.readiness.pronto) } }), h('span', { class: 'seg-parcial', style: { width: pct(s.readiness.parcial) } }), h('span', { class: 'seg-pendente', style: { width: pct(s.readiness.pendente) } }))),
  );
}

export async function createEvent() {
  const created = await formModal({
    title: 'Novo evento',
    submitLabel: 'Criar evento',
    fields: [
      { name: 'name', label: 'Nome do evento', required: true, span: 2, placeholder: 'Ex.: Congresso Nacional de Marketing 2026' },
      { name: 'startDate', label: 'Data inicial', type: 'date', value: todayIso() },
      { name: 'endDate', label: 'Data final', type: 'date', hint: 'Deixe igual à inicial para eventos de um dia' },
      { name: 'venue', label: 'Local', placeholder: 'Centro de convenções…' },
      { name: 'city', label: 'Cidade' },
      { name: 'client', label: 'Cliente / organizador' },
      { name: 'status', label: 'Status', type: 'select', options: Object.entries(EVENT_STATUS_LABELS).map(([value, label]) => ({ value, label })), value: 'planejamento' },
      { name: 'description', label: 'Descrição', type: 'textarea', span: 2 },
    ],
    onSubmit: (values) => api.post('/api/events', values),
  });
  if (created) {
    await loadEvents();
    location.hash = `#/eventos/${created.id}/programacao`;
  }
}
