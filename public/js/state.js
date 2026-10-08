// Global application state with a tiny pub/sub.
import { api } from './api.js';

const listeners = new Set();

export const state = {
  system: null,
  events: [],
  bundle: null,       // currently open event bundle
  bundleId: null,
  route: { name: 'events', params: {} },
  loading: false,
  jobs: [],
  get user() { return api.store.user; },
};

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit(topic = 'change', detail) { for (const fn of listeners) fn(topic, detail); }

export async function loadSystem() {
  state.system = await api.get('/api/system');
  return state.system;
}

export async function loadEvents() {
  state.events = await api.get('/api/events');
  emit('events');
  return state.events;
}

export async function loadBundle(eventId, { silent = false } = {}) {
  if (!eventId) { state.bundle = null; state.bundleId = null; return null; }
  const bundle = await api.get(`/api/events/${eventId}`);
  state.bundle = bundle;
  state.bundleId = eventId;
  state.jobs = bundle.jobs || [];
  if (!silent) emit('bundle');
  return bundle;
}

// Refreshes everything relevant to the current screen.
export async function refresh() {
  await Promise.all([loadEvents(), state.bundleId ? loadBundle(state.bundleId, { silent: true }) : null]);
  emit('refresh');
}

export const lookups = {
  room: (id) => state.bundle?.rooms.find((r) => r.id === id) || null,
  speaker: (id) => state.bundle?.speakers.find((s) => s.id === id) || null,
  session: (id) => state.bundle?.sessions.find((s) => s.id === id) || null,
  asset: (id) => state.bundle?.assets.find((a) => a.id === id) || null,
  clip: (id) => state.bundle?.clips.find((c) => c.id === id) || null,
  speakerNames: (ids = []) => ids.map((id) => lookups.speaker(id)?.name).filter(Boolean),
  sessionAssets: (sessionId) => (state.bundle?.assets || []).filter((a) => a.sessionId === sessionId),
  sessionLabel: (id) => { const s = lookups.session(id); return s ? `${s.start ? s.start + ' · ' : ''}${s.title}` : ''; },
  dates: () => {
    const b = state.bundle; if (!b) return [];
    const set = new Set(b.sessions.map((s) => s.date).filter(Boolean));
    if (b.event.startDate) {
      const start = new Date(b.event.startDate + 'T00:00:00');
      const end = new Date((b.event.endDate || b.event.startDate) + 'T00:00:00');
      const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      for (let d = new Date(start); d <= end && set.size < 60; d.setDate(d.getDate() + 1)) set.add(iso(d));
    }
    return [...set].sort();
  },
};
