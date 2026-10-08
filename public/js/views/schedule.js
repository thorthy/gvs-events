// Schedule tab: per-day list and per-room grid, session creation and program import.
import { h, icon, btn, badge, readinessBadge, kindIcon, formModal, openModal, confirmDialog, toast, fmtDate, minutesOf, nowHHMM, todayIso, SESSION_TYPE_LABELS, select, append, replace, clear } from '../dom.js';
import { api } from '../api.js';
import { state, lookups, refresh } from '../state.js';
import { enqueueUploads, wireDrop } from '../uploads.js';

let view = localStorage.getItem('gvs.scheduleView') || 'lista';
let selectedDay = null;
let roomFilter = '';

export function renderSchedule(container, { bundle, query }) {
  const { event, sessions, rooms } = bundle;
  const dates = lookups.dates();
  if (query?.get('dia')) selectedDay = query.get('dia');
  if (!selectedDay || (!dates.includes(selectedDay) && selectedDay !== 'todos')) selectedDay = dates.includes(todayIso()) ? todayIso() : (dates[0] || 'todos');
  const visible = sessions.filter((s) => (selectedDay === 'todos' || s.date === selectedDay || (!s.date && selectedDay === dates[0])) && (!roomFilter || (s.roomId || '') === roomFilter));

  append(container, 
    h('div', { class: 'flex between flex-wrap mb-16' },
      h('div', { class: 'flex flex-wrap' },
        h('button', { class: `chip ${selectedDay === 'todos' ? 'active' : ''}`, onClick: () => { selectedDay = 'todos'; rerender(container, bundle); } }, 'Todos os dias'),
        dates.map((d) => h('button', { class: `chip ${selectedDay === d ? 'active' : ''}`, onClick: () => { selectedDay = d; rerender(container, bundle); } }, fmtDate(d, { weekday: true, year: false }))),
        rooms.length > 1 ? select(rooms.map((r) => ({ value: r.id, label: r.name })), roomFilter, { cls: 'select-sm input-inline', empty: 'Todas as salas', onChange: (v) => { roomFilter = v; rerender(container, bundle); } }) : null),
      h('div', { class: 'flex flex-wrap' },
        h('div', { class: 'btn-group' },
          btn('Lista', { icon: 'list', cls: `btn-sm ${view === 'lista' ? 'active' : ''}`, onClick: () => { view = 'lista'; localStorage.setItem('gvs.scheduleView', view); rerender(container, bundle); } }),
          btn('Grade', { icon: 'grid', cls: `btn-sm ${view === 'grade' ? 'active' : ''}`, onClick: () => { view = 'grade'; localStorage.setItem('gvs.scheduleView', view); rerender(container, bundle); } })),
        btn('Importar programação', { icon: 'upload', cls: 'btn-sm', onClick: () => importProgram(bundle) }),
        btn('Nova sessão', { icon: 'plus', cls: 'btn-primary btn-sm', onClick: () => sessionForm(bundle, { date: selectedDay !== 'todos' ? selectedDay : dates[0] }) }))),
  );
  if (!sessions.length) {
    append(container, h('div', { class: 'empty' }, icon('calendar'), h('h3', null, 'Programação vazia'), h('p', null, 'Cadastre as sessões manualmente ou cole a programação inteira (texto ou CSV) para importar de uma vez.'),
      h('div', { class: 'flex', style: { justifyContent: 'center' } }, btn('Nova sessão', { icon: 'plus', cls: 'btn-primary', onClick: () => sessionForm(bundle, {}) }), btn('Importar programação', { icon: 'upload', onClick: () => importProgram(bundle) }))));
    return;
  }
  if (view === 'grade' && selectedDay !== 'todos') append(container, renderGrid(bundle, visible, selectedDay));
  else append(container, renderList(bundle, visible));
}

function rerender(container, bundle) { clear(container); renderSchedule(container, { bundle }); }

function renderList(bundle, visible) {
  const byDate = new Map();
  for (const s of visible) { const k = s.date || ''; if (!byDate.has(k)) byDate.set(k, []); byDate.get(k).push(s); }
  const rows = [];
  for (const [date, list] of byDate) {
    rows.push(h('tr', { class: 'day-row' }, h('td', { colspan: 7 }, date ? fmtDate(date, { weekday: true }) : 'Sem data', ' ', h('span', { class: 'muted small' }, `· ${list.length} sessões`))));
    for (const s of list) rows.push(sessionRow(bundle, s));
  }
  return h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    h('thead', null, h('tr', null, h('th', null, 'Horário'), h('th', null, 'Sala'), h('th', null, 'Sessão'), h('th', null, 'Tipo'), h('th', null, 'Materiais'), h('th', null, 'Checklist'), h('th', null, 'Prontidão'))),
    h('tbody', null, rows)));
}

function sessionRow(bundle, s) {
  const assets = lookups.sessionAssets(s.id).filter((a) => !['substituido', 'rejeitado'].includes(a.status));
  const tr = h('tr', { class: 'clickable', onClick: () => { location.hash = `#/eventos/${bundle.event.id}/programacao/${s.id}`; } },
    h('td', { class: 'mono nowrap' }, s.start || '--:--', s.end ? h('span', { class: 'muted' }, ` – ${s.end}`) : null),
    h('td', null, lookups.room(s.roomId)?.name || h('span', { class: 'muted' }, '—')),
    h('td', null, h('div', { style: { fontWeight: 600 } }, s.title), h('div', { class: 'muted small' }, lookups.speakerNames(s.speakerIds).join(', ') || (s.type === 'intervalo' ? '' : 'Sem palestrante'))),
    h('td', null, h('span', { class: 'badge badge-outline' }, SESSION_TYPE_LABELS[s.type] || s.type)),
    h('td', null, s.type === 'intervalo' ? h('span', { class: 'muted' }, '—') : s.noMaterial ? h('span', { class: 'muted small' }, 'Não precisa') : assets.length ? h('div', { class: 'flex gap-4' }, assets.slice(0, 6).map((a) => h('span', { title: `${a.originalName} · ${a.status}`, class: `status-${a.status}` }, kindIcon(a.kind))), assets.length > 6 ? h('span', { class: 'muted small' }, `+${assets.length - 6}`) : null) : h('span', { class: 'muted small' }, 'nenhum')),
    h('td', null, s.readiness.checklistTotal ? h('span', { class: `small ${s.readiness.checklistDone === s.readiness.checklistTotal ? 'readiness-pronto' : 'muted'}` }, `${s.readiness.checklistDone}/${s.readiness.checklistTotal}`) : h('span', { class: 'muted' }, '—')),
    h('td', null, readinessBadge(s.readiness)));
  if (s.type !== 'intervalo') wireDrop(tr, (files) => { enqueueUploads(files, { eventId: bundle.event.id, sessionId: s.id }); toast(`Enviando para "${s.title}"`); }, { cls: 'drop-target' });
  return tr;
}

function renderGrid(bundle, visible, day) {
  const rooms = [...bundle.rooms.filter((r) => !roomFilter || r.id === roomFilter)];
  if (visible.some((s) => !s.roomId)) rooms.push({ id: null, name: 'Sem sala' });
  if (!rooms.length) rooms.push({ id: null, name: 'Sem sala' });
  const timed = visible.filter((s) => s.start);
  const minStart = Math.min(...timed.map((s) => minutesOf(s.start)), 8 * 60);
  const maxEnd = Math.max(...timed.map((s) => minutesOf(s.end || s.start) + (s.end ? 0 : 60)), 18 * 60);
  const startHour = Math.floor(minStart / 60);
  const endHour = Math.ceil(maxEnd / 60);
  const pxPerMin = 1.6;
  const hourPx = 60 * pxPerMin;
  const height = (endHour - startHour) * hourPx;
  const axis = h('div', { class: 'axis', style: { height: `${height}px` } });
  for (let hh = startHour; hh <= endHour; hh++) append(axis, h('div', { class: 'tick', style: { top: `${(hh - startHour) * hourPx}px` } }, `${String(hh).padStart(2, '0')}:00`));
  const cols = rooms.map((room) => {
    const col = h('div', { class: 'col', style: { height: `${height}px` } });
    const list = visible.filter((s) => (s.roomId || null) === room.id);
    for (const s of list) {
      const start = s.start ? minutesOf(s.start) : startHour * 60;
      const end = s.end ? minutesOf(s.end) : start + 45;
      const top = (start - startHour * 60) * pxPerMin;
      const hgt = Math.max(26, (end - start) * pxPerMin - 2);
      append(col, h('div', { class: `block r-${s.readiness.level}`, style: { top: `${top}px`, height: `${hgt}px` }, title: `${s.start || ''}–${s.end || ''} ${s.title}`, onClick: () => { location.hash = `#/eventos/${bundle.event.id}/programacao/${s.id}`; } },
        h('div', { class: 't' }, s.title), h('div', { class: 's' }, [s.start && `${s.start}${s.end ? '–' + s.end : ''}`, lookups.speakerNames(s.speakerIds).join(', ')].filter(Boolean).join(' · '))));
    }
    if (day === todayIso()) {
      const nowMin = minutesOf(nowHHMM());
      if (nowMin >= startHour * 60 && nowMin <= endHour * 60) append(col, h('div', { class: 'now-line', style: { top: `${(nowMin - startHour * 60) * pxPerMin}px` } }));
    }
    return col;
  });
  return h('div', { class: 'schedule-grid', style: { '--cols': rooms.length, '--hour-px': `${hourPx}px` } },
    h('div', { class: 'head' }, ''), rooms.map((r) => h('div', { class: 'head' }, r.name)),
    axis, cols);
}

export async function sessionForm(bundle, defaults = {}, existing = null) {
  const roomOptions = bundle.rooms.map((r) => ({ value: r.id, label: r.name }));
  const speakerOptions = bundle.speakers.map((s) => ({ value: s.id, label: s.name }));
  const result = await formModal({
    title: existing ? 'Editar sessão' : 'Nova sessão',
    size: 'wide',
    submitLabel: existing ? 'Salvar' : 'Criar sessão',
    fields: [
      { name: 'title', label: 'Título', required: true, span: 2, value: existing?.title || '' },
      { name: 'type', label: 'Tipo', type: 'select', options: Object.entries(SESSION_TYPE_LABELS).map(([value, label]) => ({ value, label })), value: existing?.type || defaults.type || 'palestra' },
      { name: 'roomId', label: 'Sala', type: 'select', options: roomOptions, empty: 'Sem sala', value: existing?.roomId || defaults.roomId || '', hint: roomOptions.length ? '' : 'Cadastre salas na aba Salas' },
      { name: 'date', label: 'Data', type: 'date', value: existing?.date || defaults.date || bundle.event.startDate || '' },
      { name: 'start', label: 'Início', type: 'time', value: existing?.start || defaults.start || '' },
      { name: 'end', label: 'Término', type: 'time', value: existing?.end || defaults.end || '' },
      { name: 'speakerIds', label: 'Palestrantes', type: 'checkboxes', options: speakerOptions, value: existing?.speakerIds || [], span: 2, hint: speakerOptions.length ? 'Clique para selecionar' : 'Cadastre palestrantes na aba Palestrantes' },
      { name: 'newSpeakers', label: 'Novos palestrantes', placeholder: 'Nomes separados por vírgula (serão cadastrados)', span: 2 },
      { name: 'noMaterial', label: 'Esta sessão não precisa de material (painel sem slides, etc.)', type: 'checkbox', value: existing?.noMaterial || false, span: 2 },
      { name: 'description', label: 'Descrição', type: 'textarea', value: existing?.description || '', span: 2 },
      { name: 'notes', label: 'Observações internas', type: 'textarea', value: existing?.notes || '', span: 2, rows: 2 },
    ],
    onSubmit: async (values) => {
      const extra = String(values.newSpeakers || '').split(',').map((s) => s.trim()).filter(Boolean);
      for (const name of extra) {
        const sp = await api.post(`/api/events/${bundle.event.id}/speakers`, { name });
        values.speakerIds.push(sp.id);
      }
      delete values.newSpeakers;
      if (existing) return api.patch(`/api/sessions/${existing.id}`, values);
      return api.post(`/api/events/${bundle.event.id}/sessions`, values);
    },
  });
  if (result) {
    toast(existing ? 'Sessão atualizada' : 'Sessão criada', { type: 'ok' });
    await refresh();
    if (!existing) location.hash = `#/eventos/${bundle.event.id}/programacao/${result.id}`;
  }
  return result;
}

async function importProgram(bundle) {
  const textarea = h('textarea', { class: 'textarea mono', rows: 12, placeholder: `# ${bundle.event.startDate || '2026-03-10'}
## Sala A
09:00-09:45 | Abertura oficial | Maria Silva | abertura
09:45-10:30 | Inteligência artificial na prática | João Souza, Ana Lima
10:30-11:00 | Coffee break
## Auditório
11:00-12:00 | Painel: o futuro do setor | Carlos Melo; Beatriz Dias | painel

Também aceita CSV com cabeçalho: data;inicio;fim;sala;titulo;palestrantes;tipo` });
  const preview = h('div');
  let rows = [];
  const update = async () => {
    const text = textarea.value;
    if (!text.trim()) { clear(preview); rows = []; return; }
    const res = await api.post(`/api/events/${bundle.event.id}/program/preview`, { text });
    rows = res.rows;
    replace(preview, 
      res.errors.length ? h('div', { class: 'warning-box' }, `${res.errors.length} linha(s) ignorada(s): `, res.errors.map((e) => `linha ${e.line} (${e.message})`).join('; ')) : null,
      rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, h('th', null, 'Data'), h('th', null, 'Horário'), h('th', null, 'Sala'), h('th', null, 'Título'), h('th', null, 'Palestrantes'), h('th', null, 'Tipo'))),
        h('tbody', null, rows.map((r) => h('tr', null, h('td', null, fmtDate(r.date)), h('td', { class: 'mono' }, [r.start, r.end].filter(Boolean).join('–')), h('td', null, r.room || '—'), h('td', null, r.title), h('td', null, r.speakers.join(', ')), h('td', null, SESSION_TYPE_LABELS[r.type])))))) : h('p', { class: 'muted' }, 'Nenhuma sessão reconhecida ainda.'));
  };
  let timer;
  textarea.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(update, 300); });
  openModal({
    title: 'Importar programação',
    size: 'xwide',
    body: h('div', { class: 'col gap-12' },
      h('div', { class: 'info-box' }, 'Cole a programação abaixo. Linhas com ', h('code', null, '# data'), ' definem o dia e linhas com ', h('code', null, '## nome'), ' definem a sala das linhas seguintes. Salas e palestrantes novos são criados automaticamente. O checklist padrão é aplicado a cada sessão.'),
      textarea, preview),
    actions: [{ label: 'Cancelar' }, { label: 'Importar sessões', primary: true, onClick: async () => {
      if (!rows.length) throw new Error('Nenhuma sessão para importar');
      const res = await api.post(`/api/events/${bundle.event.id}/program/import`, { rows });
      toast(`${res.created} sessões importadas`, { type: 'ok' });
      await refresh();
    } }],
  });
}
