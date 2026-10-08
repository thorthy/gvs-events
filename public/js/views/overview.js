// Event overview: KPIs, readiness map, pending items, next sessions, recent activity.
import { h, icon, btn, badge, readinessBadge, statusBadge, kindIcon, fmtBytes, fmtDate, fmtRelative, todayIso, nowHHMM, minutesOf, pluralize, CLIP_STATUS_LABELS, CLIP_STATUS_BADGE, append, replace, clear } from '../dom.js';
import { api } from '../api.js';
import { lookups } from '../state.js';

export function renderOverview(container, { bundle }) {
  const { event, sessions, assets, clips, rooms } = bundle;
  const r = event.stats.readiness;
  const countable = sessions.filter((s) => s.type !== 'intervalo');
  const approvedAssets = assets.filter((a) => ['aprovado', 'final'].includes(a.status)).length;
  const pendingReview = assets.filter((a) => ['recebido', 'em_revisao'].includes(a.status));
  const missing = countable.filter((s) => s.readiness.level === 'pendente');
  const partial = countable.filter((s) => s.readiness.level === 'parcial');
  const clipsReview = clips.filter((c) => c.status === 'revisao');
  const today = todayIso();
  const now = minutesOf(nowHHMM());
  const upcoming = sessions.filter((s) => s.date === today && (!s.end || minutesOf(s.end) >= now - 15)).slice(0, 6);
  const total = r.pronto + r.parcial + r.pendente || 1;

  append(container, 
    h('div', { class: 'kpis' },
      kpi('Sessões', sessions.length, `${rooms.length} ${rooms.length === 1 ? 'sala' : 'salas'}`),
      kpi('Prontas', `${event.stats.readyPercent}%`, `${r.pronto} de ${countable.length}`),
      kpi('Materiais', assets.length, `${approvedAssets} aprovados`),
      kpi('Aguardando revisão', pendingReview.length, 'recebidos / em revisão'),
      kpi('Cortes', clips.length, `${clips.filter((c) => c.status === 'publicado').length} publicados`),
      kpi('Armazenamento', fmtBytes(event.stats.totalBytes), 'arquivos atuais'),
    ),
    h('div', { class: 'card mt-16' },
      h('div', { class: 'card-header' }, h('div', { class: 'card-title' }, icon('flag'), 'Prontidão das sessões'), h('div', { class: 'legend' }, legend('var(--ok)', `Prontas ${r.pronto}`), legend('var(--warn)', `Em andamento ${r.parcial}`), legend('var(--danger)', `Pendentes ${r.pendente}`))),
      h('div', { class: 'progress', style: { height: '12px' } }, h('span', { class: 'seg-pronto', style: { width: `${(r.pronto / total) * 100}%` } }), h('span', { class: 'seg-parcial', style: { width: `${(r.parcial / total) * 100}%` } }), h('span', { class: 'seg-pendente', style: { width: `${(r.pendente / total) * 100}%` } })),
      readinessByRoomDay(bundle),
    ),
    h('div', { class: 'grid-2 mt-16' },
      h('div', { class: 'card' },
        h('div', { class: 'card-header' }, h('div', { class: 'card-title' }, icon('warning'), 'Pendências'), h('span', { class: 'muted small' }, pluralize(missing.length + partial.length + pendingReview.length + clipsReview.length, 'item', 'itens'))),
        pendingList({ bundle, missing, partial, pendingReview, clipsReview })),
      h('div', { class: 'card' },
        h('div', { class: 'card-header' }, h('div', { class: 'card-title' }, icon('clock'), upcoming.length ? 'Hoje' : 'Próximas sessões'), h('a', { href: `#/eventos/${event.id}/programacao`, class: 'small' }, 'Ver programação')),
        sessionList(bundle, upcoming.length ? upcoming : sessions.filter((s) => s.date >= today).slice(0, 6))),
    ),
    h('div', { class: 'card mt-16' },
      h('div', { class: 'card-header' }, h('div', { class: 'card-title' }, icon('activity'), 'Atividade recente'), h('a', { href: `#/eventos/${event.id}/atividade`, class: 'small' }, 'Ver tudo')),
      recentActivity(event.id)),
  );
}

function kpi(label, value, sub) { return h('div', { class: 'kpi' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value, sub ? h('small', null, sub) : null)); }
function legend(color, text) { return h('span', null, h('span', { class: 'dot', style: { background: color } }), text); }

function readinessByRoomDay(bundle) {
  const { sessions, rooms, event } = bundle;
  const dates = [...new Set(sessions.map((s) => s.date).filter(Boolean))].sort();
  if (!dates.length || !sessions.length) return h('p', { class: 'muted small mt-8' }, 'Cadastre sessões na programação para ver o mapa de prontidão por sala e dia.');
  const roomRows = [...rooms, { id: null, name: 'Sem sala' }].filter((room) => sessions.some((s) => (s.roomId || null) === room.id));
  const cell = (room, date) => {
    const list = sessions.filter((s) => (s.roomId || null) === room.id && s.date === date && s.type !== 'intervalo');
    if (!list.length) return h('td', { class: 'muted center' }, '–');
    const pronto = list.filter((s) => s.readiness.level === 'pronto').length;
    const pend = list.filter((s) => s.readiness.level === 'pendente').length;
    const variant = pronto === list.length ? 'ok' : pend === list.length ? 'danger' : 'warn';
    return h('td', { class: 'center' }, h('a', { href: `#/eventos/${event.id}/programacao?dia=${date}` }, badge(`${pronto}/${list.length}`, variant, { title: `${pronto} prontas, ${pend} pendentes` })));
  };
  return h('div', { class: 'table-wrap mt-16' }, h('table', { class: 'table' },
    h('thead', null, h('tr', null, h('th', null, 'Sala'), dates.map((d) => h('th', { class: 'center' }, fmtDate(d, { year: false }))))),
    h('tbody', null, roomRows.map((room) => h('tr', null, h('td', null, h('strong', null, room.name)), dates.map((d) => cell(room, d)))))));
}

function pendingList({ bundle, missing, partial, pendingReview, clipsReview }) {
  const items = [];
  const link = (s) => `#/eventos/${bundle.event.id}/programacao/${s.id}`;
  for (const s of missing.slice(0, 5)) items.push(h('a', { class: 'list-item clickable', href: link(s) }, badge('Sem material', 'danger'), h('div', { class: 'body' }, h('div', { class: 'title' }, s.title), h('div', { class: 'sub' }, [fmtDate(s.date, { year: false }), s.start, lookups.room(s.roomId)?.name, lookups.speakerNames(s.speakerIds).join(', ')].filter(Boolean).join(' · ')))));
  if (missing.length > 5) items.push(h('div', { class: 'muted small' }, `+ ${missing.length - 5} sessões sem material`));
  for (const a of pendingReview.slice(0, 5)) items.push(h('a', { class: 'list-item clickable', href: `#/eventos/${bundle.event.id}/materiais/${a.id}` }, statusBadge(a.status), kindIcon(a.kind), h('div', { class: 'body' }, h('div', { class: 'title' }, a.originalName), h('div', { class: 'sub' }, [lookups.sessionLabel(a.sessionId) || 'Sem sessão', `enviado ${fmtRelative(a.uploadedAt)} por ${a.uploadedBy}`].join(' · ')))));
  if (pendingReview.length > 5) items.push(h('div', { class: 'muted small' }, `+ ${pendingReview.length - 5} materiais aguardando revisão`));
  for (const s of partial.slice(0, 3)) items.push(h('a', { class: 'list-item clickable', href: link(s) }, badge(`Checklist ${s.readiness.checklistDone}/${s.readiness.checklistTotal}`, 'warn'), h('div', { class: 'body' }, h('div', { class: 'title' }, s.title), h('div', { class: 'sub' }, `${s.readiness.approved} aprovado(s) de ${s.readiness.main} material(is) principal(is)`))));
  for (const c of clipsReview.slice(0, 3)) items.push(h('a', { class: 'list-item clickable', href: `#/eventos/${bundle.event.id}/cortes/${c.id}` }, badge(CLIP_STATUS_LABELS[c.status], CLIP_STATUS_BADGE[c.status]), icon('scissors', 'kind-icon kind-corte'), h('div', { class: 'body' }, h('div', { class: 'title' }, c.title), h('div', { class: 'sub' }, 'Corte renderizado aguardando revisão'))));
  if (!items.length) return h('div', { class: 'muted', style: { padding: '12px 0' } }, icon('check', 'kind-icon'), ' Tudo em dia por aqui.');
  return h('div', { class: 'list' }, items);
}

function sessionList(bundle, list) {
  if (!list.length) return h('p', { class: 'muted' }, 'Nenhuma sessão futura cadastrada.');
  return h('div', { class: 'list' }, list.map((s) => h('a', { class: 'list-item clickable', href: `#/eventos/${bundle.event.id}/programacao/${s.id}` },
    h('div', { class: 'mono small nowrap' }, s.start || '--:--'),
    h('div', { class: 'body' }, h('div', { class: 'title' }, s.title), h('div', { class: 'sub' }, [fmtDate(s.date, { year: false }), lookups.room(s.roomId)?.name, lookups.speakerNames(s.speakerIds).join(', ')].filter(Boolean).join(' · '))),
    readinessBadge(s.readiness))));
}

function recentActivity(eventId) {
  const wrap = h('div', { class: 'muted small' }, 'Carregando…');
  api.get(`/api/events/${eventId}/activity?limit=8`).then((items) => {
    clear(wrap);
    wrap.className = '';
    if (!items.length) { append(wrap, h('p', { class: 'muted' }, 'Sem atividade ainda.')); return; }
    for (const a of items) append(wrap, h('div', { class: 'activity-item' }, h('div', { class: 'when' }, fmtRelative(a.ts)), h('div', null, h('span', { class: 'who' }, a.user), ` ${a.action} `, h('span', { class: 'muted' }, a.entity), a.detail ? `: ${a.detail}` : '')));
  }).catch(() => { wrap.textContent = 'Não foi possível carregar a atividade.'; });
  return wrap;
}
