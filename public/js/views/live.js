// Live / operator mode: now & next per room with quick access to files.
import { h, clear, icon, btn, badge, select, statusBadge, kindIcon, fmtDate, nowHHMM, minutesOf, todayIso, fmtDuration, append, replace } from '../dom.js';
import { api } from '../api.js';
import { state, lookups, refresh } from '../state.js';

let timer = null;
let selectedDay = null;
let override = ''; // HH:MM for rehearsal

export function renderLive(container, { bundle }) {
  clearInterval(timer);
  if (!bundle) { replace(container, h('div', { class: 'live' }, 'Evento não encontrado.')); return; }
  const dates = lookups.dates();
  if (!selectedDay || !dates.includes(selectedDay)) selectedDay = dates.includes(todayIso()) ? todayIso() : (dates[0] || todayIso());
  draw(container, bundle);
  timer = setInterval(() => { if (!container.isConnected || container.classList.contains('hidden')) { clearInterval(timer); return; } draw(container, bundle); }, 1000);
  // refresh data every 30s
  let n = 0;
  const dataTimer = setInterval(() => { if (!container.isConnected || container.classList.contains('hidden')) { clearInterval(dataTimer); return; } if (++n % 30 === 0) refresh().catch(() => {}); }, 1000);
}

function currentTime() {
  if (override) { const d = new Date(); const [hh, mm] = override.split(':').map(Number); d.setHours(hh, mm, d.getSeconds()); return d; }
  return new Date();
}

function draw(container, bundle) {
  const now = currentTime();
  const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const { event, rooms, sessions, assets } = bundle;
  const daySessions = sessions.filter((s) => s.date === selectedDay);
  const roomList = rooms.length ? [...rooms] : [];
  if (daySessions.some((s) => !s.roomId)) roomList.push({ id: null, name: 'Sem sala' });
  const dates = lookups.dates();

  const clock = h('div', { class: 'live-clock' }, `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, h('span', { style: { fontSize: '24px', color: '#8a92a6' } }, `:${String(now.getSeconds()).padStart(2, '0')}`));
  const existing = container.querySelector('.live-clock');
  if (existing && container.dataset.day === selectedDay && container.dataset.minute === String(Math.floor(nowMin)) && container.dataset.stamp === bundle.event.updatedAt + assets.length + sessions.map((s) => s.updatedAt).join('')) {
    existing.replaceWith(clock);
    return;
  }
  container.dataset.day = selectedDay;
  container.dataset.minute = String(Math.floor(nowMin));
  container.dataset.stamp = bundle.event.updatedAt + assets.length + sessions.map((s) => s.updatedAt).join('');

  const roomsEl = roomList.length ? h('div', { class: 'live-rooms' }, roomList.map((room) => {
    const list = daySessions.filter((s) => (s.roomId || null) === room.id && s.start).sort((a, b) => a.start.localeCompare(b.start));
    const current = list.find((s) => minutesOf(s.start) <= nowMin && (s.end ? minutesOf(s.end) : minutesOf(s.start) + 60) > nowMin);
    const next = list.find((s) => minutesOf(s.start) > nowMin);
    return h('div', { class: 'live-room' },
      h('h2', null, room.name),
      h('div', { class: 'live-now' }, h('div', { class: 'label' }, 'Agora'), current ? sessionBlock(current, nowMin, true, event.id) : h('div', { class: 'nothing' }, list.length ? 'Nada acontecendo nesta sala agora' : 'Sem sessões nesta sala hoje')),
      h('div', { class: 'live-next' }, h('div', { class: 'label' }, 'A seguir'), next ? sessionBlock(next, nowMin, false, event.id) : h('div', { class: 'nothing' }, 'Nenhuma sessão a seguir')),
    );
  })) : h('div', { class: 'nothing' }, 'Nenhuma sessão com horário cadastrada para este dia.');

  clear(container);
  append(container, h('div', { class: 'live' },
    h('div', { class: 'live-header' },
      h('div', null, clock, h('div', { class: 'live-date' }, `${fmtDate(selectedDay, { weekday: true })} · ${event.name}`)),
      h('div', { class: 'flex flex-wrap' },
        select(dates.map((d) => ({ value: d, label: fmtDate(d, { weekday: true }) })), selectedDay, { cls: 'select-sm input-inline', onChange: (v) => { selectedDay = v; draw(container, bundle); } }),
        h('input', { class: 'input input-sm', type: 'time', value: override, title: 'Simular horário (ensaio)', style: { width: '120px' }, onChange: (e) => { override = e.target.value; draw(container, bundle); } }),
        override ? btn('Voltar ao horário real', { cls: 'btn-sm', onClick: () => { override = ''; draw(container, bundle); } }) : null,
        btn('Sair do modo ao vivo', { icon: 'x', cls: 'btn-sm', onClick: () => { location.hash = `#/eventos/${event.id}`; } }))),
    roomsEl));
}

function sessionBlock(s, nowMin, isCurrent, eventId) {
  const start = minutesOf(s.start); const end = s.end ? minutesOf(s.end) : start + 60;
  const pct = Math.max(0, Math.min(100, ((nowMin - start) / (end - start)) * 100));
  const remaining = Math.max(0, end - nowMin);
  const startsIn = Math.max(0, start - nowMin);
  const mains = lookups.sessionAssets(s.id).filter((a) => !['substituido', 'rejeitado'].includes(a.status)).sort((a, b) => (['aprovado', 'final'].includes(b.status) ? 1 : 0) - (['aprovado', 'final'].includes(a.status) ? 1 : 0));
  const pendingChecklist = (s.checklist || []).filter((c) => !c.done).length;
  return h('div', null,
    h('div', { class: 'title' }, s.title),
    h('div', { class: 'speakers' }, lookups.speakerNames(s.speakerIds).join(', ')),
    h('div', { class: 'time' }, `${s.start}${s.end ? ' – ' + s.end : ''}`, ' · ', isCurrent ? h('span', { class: 'remaining' }, `faltam ${Math.ceil(remaining)} min`) : h('span', { class: 'remaining' }, `começa em ${Math.ceil(startsIn)} min`)),
    isCurrent ? h('div', { class: 'progress' }, h('span', { class: 'seg-plain', style: { width: `${pct}%` } })) : null,
    pendingChecklist ? h('div', { class: 'small mt-8', style: { color: 'var(--warn)' } }, icon('warning', 'kind-icon'), ` ${pendingChecklist} item(ns) do checklist pendente(s)`) : null,
    h('div', { class: 'files' }, mains.length ? mains.map((a) => h('div', { class: 'file' }, kindIcon(a.kind), h('span', { class: 'ellipsis', title: a.originalName }, a.originalName), statusBadge(a.status), btn('Abrir', { icon: 'external', cls: 'btn-sm', onClick: () => window.open(api.fileUrl(a.id), '_blank') }))) : (s.noMaterial || s.type === 'intervalo' ? null : h('div', { class: 'file', style: { color: 'var(--danger)' } }, icon('warning', 'kind-icon'), 'Sem material cadastrado'))),
  );
}
