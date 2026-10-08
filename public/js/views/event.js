// Event shell: header + tabs.
import { h, icon, btn, badge, select, fmtDateRange, EVENT_STATUS_LABELS, toast, append, replace, clear } from '../dom.js';
import { api } from '../api.js';
import { state, refresh } from '../state.js';
import { enqueueUploads, wireDrop } from '../uploads.js';
import { renderOverview } from './overview.js';
import { renderSchedule } from './schedule.js';
import { renderMaterials } from './materials.js';
import { renderClips } from './clips.js';
import { renderSpeakers } from './speakers.js';
import { renderRooms } from './rooms.js';
import { renderActivity } from './activity.js';
import { renderEventSettings } from './eventSettings.js';

export const EVENT_TABS = [
  { id: 'visao', label: 'Visão geral', icon: 'grid', render: renderOverview },
  { id: 'programacao', label: 'Programação', icon: 'calendar', render: renderSchedule, count: (b) => b.sessions.length },
  { id: 'materiais', label: 'Materiais', icon: 'folder', render: renderMaterials, count: (b) => b.assets.length },
  { id: 'cortes', label: 'Cortes', icon: 'scissors', render: renderClips, count: (b) => b.clips.length },
  { id: 'palestrantes', label: 'Palestrantes', icon: 'mic', render: renderSpeakers, count: (b) => b.speakers.length },
  { id: 'salas', label: 'Salas', icon: 'room', render: renderRooms, count: (b) => b.rooms.length },
  { id: 'atividade', label: 'Atividade', icon: 'activity', render: renderActivity },
  { id: 'config', label: 'Exportar & ajustes', icon: 'settings', render: renderEventSettings },
];

export function renderEvent(container, ctx) {
  const { bundle, tab } = ctx;
  if (!bundle) { append(container, h('div', { class: 'empty' }, 'Evento não encontrado.')); return; }
  const e = bundle.event;
  const fileInput = h('input', { type: 'file', multiple: true, class: 'hidden', onChange: (ev) => { enqueueUploads(ev.target.files, { eventId: e.id }); ev.target.value = ''; } });
  const statusVariant = { planejamento: 'info', em_andamento: 'ok', concluido: 'neutral', arquivado: 'outline' }[e.status];
  append(container, 
    h('div', { class: 'breadcrumb' }, h('a', { href: '#/' }, 'Eventos'), icon('chevronRight', 'kind-icon'), h('span', null, e.name)),
    h('div', { class: 'page-header' },
      h('div', { class: 'titles' },
        h('h1', null, h('span', { style: { display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: e.color, marginRight: '10px', verticalAlign: 'middle' } }), e.name),
        h('div', { class: 'sub' },
          h('span', null, icon('calendar', 'kind-icon'), ' ', fmtDateRange(e.startDate, e.endDate)),
          e.venue ? h('span', null, '· ', e.venue) : null, e.city ? h('span', null, '· ', e.city) : null, e.client ? h('span', null, '· ', e.client) : null,
          select(Object.entries(EVENT_STATUS_LABELS).map(([value, label]) => ({ value, label })), e.status, { cls: 'select-sm input-inline', onChange: async (v) => { await api.patch(`/api/events/${e.id}`, { status: v }); toast('Status atualizado', { type: 'ok' }); refresh(); } }),
        )),
      h('div', { class: 'page-actions' },
        fileInput,
        btn('Enviar arquivos', { icon: 'upload', cls: 'btn-primary', onClick: () => fileInput.click() }),
        btn('Modo ao vivo', { icon: 'live', onClick: () => { location.hash = `#/ao-vivo/${e.id}`; } }),
      )),
    h('div', { class: 'tabs' }, EVENT_TABS.map((t) => h('a', { class: `tab ${t.id === tab ? 'active' : ''}`, href: `#/eventos/${e.id}/${t.id}` }, icon(t.icon, 'kind-icon'), t.label, t.count ? h('span', { class: 'count' }, t.count(bundle)) : null))),
  );
  const body = h('div', { class: 'tab-body' });
  append(container, body);
  const def = EVENT_TABS.find((t) => t.id === tab) || EVENT_TABS[0];
  def.render(body, ctx);
  // Drop anywhere on the page uploads to the event (unassigned).
  wireDrop(container, (files) => enqueueUploads(files, { eventId: e.id }), { cls: 'drop-target' });
}
