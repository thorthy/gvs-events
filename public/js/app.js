// Application bootstrap: routing, layout, global search, shortcuts.
import { h, clear, icon, btn, toast, openModal, closeTopModal, promptDialog, initials, fmtDateRange, EVENT_STATUS_LABELS, JOB_TYPE_LABELS, append, replace } from './dom.js';
import { api } from './api.js';
import { state, subscribe, loadSystem, loadEvents, loadBundle, refresh } from './state.js';
import { watchJobs, stopJobs, activeJobs } from './jobs.js';
import { renderEvents } from './views/events.js';
import { renderEvent, EVENT_TABS } from './views/event.js';
import { renderLive } from './views/live.js';
import { renderSettings } from './views/settings.js';
import { openSessionDrawer, closeSessionDrawer } from './views/session.js';
import { openAssetDrawer, closeAssetDrawer } from './views/asset.js';

const content = document.getElementById('content');
const sidebar = document.getElementById('sidebar');
const topbar = document.getElementById('topbar');
let lastRouteKey = '';
let scrollMemo = new Map();

export function navigate(hash) { location.hash = hash; }

export function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean).map(decodeURIComponent);
  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  if (!parts.length) return { name: 'events', params: {}, query };
  if (parts[0] === 'config') return { name: 'settings', params: {}, query };
  if (parts[0] === 'ao-vivo' && parts[1]) return { name: 'live', params: { eventId: parts[1] }, query };
  if (parts[0] === 'eventos' && parts[1]) {
    const tab = EVENT_TABS.some((t) => t.id === parts[2]) ? parts[2] : 'visao';
    return { name: 'event', params: { eventId: parts[1], tab, sub: parts[3] || null }, query };
  }
  return { name: 'events', params: {}, query };
}

async function route() {
  const r = parseRoute();
  state.route = r;
  const key = `${r.name}:${r.params.eventId || ''}:${r.params.tab || ''}`;
  if (key !== lastRouteKey) { scrollMemo.set(lastRouteKey, content.scrollTop || window.scrollY); lastRouteKey = key; }
  document.body.classList.toggle('live-mode', r.name === 'live');
  document.getElementById('app').classList.toggle('hidden', r.name === 'live');
  try {
    if (r.name === 'event' || r.name === 'live') {
      if (state.bundleId !== r.params.eventId) await loadBundle(r.params.eventId, { silent: true });
      watchJobs(r.params.eventId);
    } else {
      stopJobs();
    }
  } catch (err) {
    stopJobs();
    renderError(err);
    return;
  }
  render();
}

function render() {
  const r = state.route;
  if (r.name === 'live') {
    let live = document.getElementById('live');
    if (!live) { live = h('div', { id: 'live' }); append(document.body, live); }
    live.classList.remove('hidden');
    renderLive(live, { bundle: state.bundle });
    return;
  }
  document.getElementById('live')?.classList.add('hidden');
  renderSidebar();
  renderTopbar();
  const scroll = window.scrollY;
  clear(content);
  try {
    if (r.name === 'events') renderEvents(content);
    else if (r.name === 'settings') renderSettings(content);
    else if (r.name === 'event') renderEvent(content, { bundle: state.bundle, tab: r.params.tab, sub: r.params.sub, query: r.query });
  } catch (err) {
    console.error(err);
    renderError(err);
  }
  window.scrollTo(0, scroll);
  syncDrawers();
}

function syncDrawers() {
  const r = state.route;
  if (r.name === 'event' && r.params.tab === 'programacao' && r.params.sub) openSessionDrawer(r.params.sub);
  else closeSessionDrawer();
  if (r.name === 'event' && r.params.tab === 'materiais' && r.params.sub) openAssetDrawer(r.params.sub);
  else closeAssetDrawer();
}

function renderError(err) {
  clear(content);
  append(content, h('div', { class: 'empty' }, icon('warning'), h('h3', null, 'Algo deu errado'), h('p', null, err.message || String(err)), btn('Voltar ao início', { onClick: () => navigate('#/') })));
}

function renderSidebar() {
  clear(sidebar);
  const r = state.route;
  const events = state.events.filter((e) => e.status !== 'arquivado').slice(0, 30);
  append(sidebar, 
    h('a', { class: 'brand', href: '#/' }, h('span', { class: 'logo' }, icon('slides')), h('span', null, 'GVS Events', h('small', null, state.system?.settings?.name || 'Materiais de eventos'))),
    h('nav', null,
      navLink('#/', 'home', 'Eventos', r.name === 'events'),
      navLink('#/config', 'settings', 'Configurações', r.name === 'settings'),
    ),
    h('div', { class: 'nav-section' }, 'Eventos recentes'),
    h('nav', { class: 'events-list' }, events.length ? events.map((e) => h('a', { class: `nav-link ${r.params.eventId === e.id ? 'active' : ''}`, href: `#/eventos/${e.id}`, title: e.name },
      h('span', { class: 'dot', style: { background: e.color } }), h('span', { class: 'label' }, e.name))) : h('div', { class: 'muted small', style: { padding: '4px 12px' } }, 'Nenhum evento ainda')),
    h('div', { class: 'sidebar-footer' },
      h('div', { class: 'flex' }, h('span', { class: 'avatar', title: state.user }, initials(state.user)), h('span', { class: 'grow ellipsis' }, state.user || 'Sem nome'), btn('', { icon: 'edit', cls: 'btn-ghost btn-icon btn-sm', title: 'Trocar nome', onClick: askUserName })),
      h('div', { class: 'flex between' },
        h('span', { class: 'ellipsis', title: state.system?.libraryPath }, `v${state.system?.version || ''}`),
        btn('', { icon: document.documentElement.dataset.theme === 'light' ? 'moon' : 'sun', cls: 'btn-ghost btn-icon btn-sm', title: 'Alternar tema', onClick: toggleTheme })),
    ),
  );
}

function navLink(href, ic, label, active) {
  return h('a', { class: `nav-link ${active ? 'active' : ''}`, href }, icon(ic), h('span', { class: 'label' }, label));
}

function renderTopbar() {
  clear(topbar);
  const jobs = activeJobs();
  append(topbar, 
    h('div', { class: 'search-trigger', onClick: openSearch }, icon('search'), h('span', null, 'Buscar sessões, materiais, palestrantes…'), h('kbd', null, 'Ctrl K')),
    h('div', { class: 'grow' }),
    jobs.length ? h('div', { class: 'jobs-indicator', onClick: showJobs }, h('span', { class: 'spinner' }), `${jobs.length} em processamento`) : (state.jobs.length ? h('div', { class: 'jobs-indicator', onClick: showJobs }, icon('activity'), 'Processamentos') : null),
    state.bundle && state.route.name === 'event' ? btn('Modo ao vivo', { icon: 'live', cls: 'btn-sm', onClick: () => navigate(`#/ao-vivo/${state.bundle.event.id}`) }) : null,
  );
}

function showJobs() {
  const list = h('div', { class: 'jobs-list' });
  const renderList = () => {
    clear(list);
    if (!state.jobs.length) append(list, h('p', { class: 'muted' }, 'Nenhum processamento recente.'));
    for (const j of state.jobs) {
      const variant = j.status === 'erro' ? 'danger' : j.status === 'concluido' ? 'ok' : 'info';
      append(list, h('div', { class: 'job-item' },
        h('div', { class: 'flex between' }, h('span', { class: 'ellipsis' }, h('strong', null, JOB_TYPE_LABELS[j.type] || j.type), ' · ', j.label), h('span', { class: `badge badge-${variant}` }, j.status.replace('_', ' '))),
        j.status === 'executando' ? h('div', { class: 'progress' }, h('span', { class: 'seg-plain', style: { width: `${Math.round(j.progress * 100)}%` } })) : null,
        j.error ? h('div', { class: 'small', style: { color: 'var(--danger)' } }, j.error) : null,
        j.result?.dest ? h('div', { class: 'small mono' }, j.result.dest) : null,
      ));
    }
  };
  renderList();
  const unsub = subscribe((topic) => { if (topic === 'jobs') renderList(); });
  openModal({ title: 'Processamentos em segundo plano', body: list, onClose: unsub, actions: [{ label: 'Fechar' }] });
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('gvs.theme', next);
  renderSidebar();
}

async function askUserName() {
  const name = await promptDialog({ title: 'Quem está usando?', label: 'Seu nome (aparece no histórico e nos checklists)', value: state.user, placeholder: 'Ex.: Ana, operador sala A' });
  if (name !== null && name.trim()) { api.store.user = name.trim(); renderSidebar(); }
}

// ---------- global search ----------
let searchOpen = false;
function openSearch() {
  if (searchOpen) return;
  searchOpen = true;
  const input = h('input', { placeholder: 'Buscar em todos os eventos…', autofocus: true });
  const results = h('div', { class: 'results' });
  let items = []; let activeIdx = 0;
  const go = (hit) => {
    close();
    const base = `#/eventos/${hit.eventId}`;
    if (hit.type === 'evento') navigate(base);
    else if (hit.type === 'sessao') navigate(`${base}/programacao/${hit.id}`);
    else if (hit.type === 'material') navigate(`${base}/materiais/${hit.id}`);
    else if (hit.type === 'corte') navigate(`${base}/cortes/${hit.id}`);
    else if (hit.type === 'palestrante') navigate(`${base}/palestrantes`);
  };
  const draw = () => {
    clear(results);
    if (!items.length) { append(results, h('div', { class: 'muted', style: { padding: '14px' } }, input.value ? 'Nada encontrado.' : 'Digite para buscar.')); return; }
    items.forEach((hit, i) => append(results, h('div', { class: `result ${i === activeIdx ? 'active' : ''}`, onClick: () => go(hit) },
      h('span', { class: 'type' }, hit.type), h('div', { class: 'grow' }, h('div', { class: 'ellipsis' }, hit.title), h('div', { class: 'muted small ellipsis' }, hit.subtitle)))));
  };
  let seq = 0;
  input.addEventListener('input', async () => {
    const q = input.value.trim();
    const my = ++seq;
    if (!q) { items = []; draw(); return; }
    const hits = await api.get(`/api/search?q=${encodeURIComponent(q)}`).catch(() => []);
    if (my !== seq) return;
    items = hits; activeIdx = 0; draw();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { activeIdx = Math.min(items.length - 1, activeIdx + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { activeIdx = Math.max(0, activeIdx - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter' && items[activeIdx]) go(items[activeIdx]);
  });
  const overlay = h('div', { class: 'overlay', onMousedown: (e) => { if (e.target === overlay) close(); } }, h('div', { class: 'palette' }, input, results));
  const close = () => { overlay.remove(); searchOpen = false; window.removeEventListener('hashchange', close); };
  window.addEventListener('hashchange', close);
  append(document.body, overlay);
  draw();
  setTimeout(() => input.focus(), 20);
}

// ---------- shortcuts ----------
document.addEventListener('keydown', (e) => {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); return; }
  if (e.key === 'Escape') {
    if (closeTopModal()) return;
    if (state.route.name === 'event' && state.route.params.sub && ['programacao', 'materiais'].includes(state.route.params.tab)) { navigate(`#/eventos/${state.route.params.eventId}/${state.route.params.tab}`); return; }
  }
  if (typing) return;
  if (e.key === '/' ) { e.preventDefault(); openSearch(); }
});

// ---------- auth ----------
let askingToken = false;
async function ensureAuth() {
  const status = await fetch('/api/auth/status', { headers: api.store.token ? { Authorization: `Bearer ${api.store.token}` } : {} }).then((r) => r.json()).catch(() => ({ required: false, ok: true }));
  if (!status.required || status.ok) {
    if (status.required) await api.post('/api/auth/login', { token: api.store.token }).catch(() => {});
    return true;
  }
  return askToken();
}

async function askToken() {
  if (askingToken) return false;
  askingToken = true;
  const token = await promptDialog({ title: 'Acesso protegido', label: 'Informe o token de acesso configurado no servidor', confirmLabel: 'Entrar' });
  askingToken = false;
  if (token === null) return false;
  api.store.token = token.trim();
  const ok = await fetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ token: api.store.token }) }).then((r) => r.ok).catch(() => false);
  if (!ok) { toast('Token inválido', { type: 'error' }); return askToken(); }
  return true;
}
window.addEventListener('gvs:unauthorized', () => { askToken().then((ok) => { if (ok) boot(); }); });

// ---------- boot ----------
async function boot() {
  try {
    if (!(await ensureAuth())) return;
    await Promise.all([loadSystem(), loadEvents()]);
    if (!state.user) await askUserName();
    await route();
  } catch (err) {
    renderError(err);
  }
}

window.addEventListener('hashchange', () => route().catch(renderError));
subscribe((topic) => { if (topic === 'refresh' || topic === 'bundle' || topic === 'events' || topic === 'jobs') { if (topic === 'jobs') renderTopbar(); else render(); } });
window.addEventListener('focus', () => { if (document.visibilityState === 'visible') refresh().catch(() => {}); });
boot();
