// Domain layer: all operations over the library data.
import path from 'node:path';
import fsp from 'node:fs/promises';
import { newId, nowIso } from './ids.js';
import { HttpError, notFound, badRequest } from './errors.js';
import {
  KINDS, KIND_IDS, MAIN_KINDS, ASSET_STATUSES, APPROVED_STATUSES, SESSION_TYPES, EVENT_STATUSES,
  CLIP_STATUSES, CLIP_FORMATS, CLIP_MODES, slugify, safeFileName, kindFromName, extOf, mimeOf,
  normalizeForSearch, timeToMinutes,
} from './naming.js';
import { exists } from './files.js';

const MAX_ACTIVITY_PER_EVENT = 2000;

function str(v, { max = 2000, required = false, field = 'campo' } = {}) {
  if (v === undefined || v === null) {
    if (required) throw badRequest(`O campo "${field}" é obrigatório`);
    return '';
  }
  const s = String(v).trim().slice(0, max);
  if (required && !s) throw badRequest(`O campo "${field}" é obrigatório`);
  return s;
}

function oneOf(v, options, { field = 'campo', fallback } = {}) {
  if (v === undefined || v === null || v === '') return fallback;
  if (!options.includes(v)) throw badRequest(`Valor inválido para "${field}": ${v}`);
  return v;
}

function isoDate(v, { field = 'data', required = false } = {}) {
  if (!v) {
    if (required) throw badRequest(`O campo "${field}" é obrigatório`);
    return '';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw badRequest(`Data inválida em "${field}" (use AAAA-MM-DD)`);
  return v;
}

function hhmm(v, { field = 'horário', required = false } = {}) {
  if (!v) {
    if (required) throw badRequest(`O campo "${field}" é obrigatório`);
    return '';
  }
  const mins = timeToMinutes(v);
  if (mins === null) throw badRequest(`Horário inválido em "${field}" (use HH:MM)`);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function tags(v) {
  if (!v) return [];
  const list = Array.isArray(v) ? v : String(v).split(',');
  return [...new Set(list.map((t) => String(t).trim().slice(0, 40)).filter(Boolean))].slice(0, 30);
}

function num(v, { min = -Infinity, max = Infinity, field = 'número', required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw badRequest(`O campo "${field}" é obrigatório`);
    return null;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw badRequest(`Valor inválido em "${field}"`);
  return n;
}

export function sessionSortKey(s) {
  return `${s.date || '9999-99-99'} ${s.start || '99:99'} ${String(s.order ?? 0).padStart(5, '0')}`;
}

export function computeReadiness(session, assets) {
  if (session.type === 'intervalo') return { level: 'na', label: 'Sem material', approved: 0, main: 0, checklistDone: 0, checklistTotal: 0 };
  const live = assets.filter((a) => a.sessionId === session.id && !['substituido', 'rejeitado'].includes(a.status));
  const main = live.filter((a) => MAIN_KINDS.includes(a.kind));
  const approved = main.filter((a) => APPROVED_STATUSES.includes(a.status));
  const checklist = session.checklist || [];
  const checklistDone = checklist.filter((c) => c.done).length;
  const checklistOk = checklistDone === checklist.length;
  let level;
  if (session.noMaterial) level = checklistOk ? 'pronto' : 'parcial';
  else if (approved.length && checklistOk) level = 'pronto';
  else if (main.length || live.length || checklistDone) level = 'parcial';
  else level = 'pendente';
  const labels = { pronto: 'Pronto', parcial: 'Em andamento', pendente: 'Pendente' };
  return { level, label: labels[level], approved: approved.length, main: main.length, files: live.length, checklistDone, checklistTotal: checklist.length };
}

export class Library {
  constructor({ store, storage, media, jobs }) {
    this.store = store;
    this.storage = storage;
    this.media = media;
    this.jobs = jobs;
  }

  get data() { return this.store.data; }
  save() { this.store.markDirty(); }

  // ---------- activity ----------
  log(eventId, user, action, entity, entityId, detail = '') {
    const entry = { id: newId('act'), eventId, ts: nowIso(), user: user || 'anônimo', action, entity, entityId, detail: String(detail).slice(0, 500) };
    this.data.activity.push(entry);
    const forEvent = this.data.activity.filter((a) => a.eventId === eventId);
    if (forEvent.length > MAX_ACTIVITY_PER_EVENT) {
      const toDrop = new Set(forEvent.slice(0, forEvent.length - MAX_ACTIVITY_PER_EVENT).map((a) => a.id));
      this.data.activity = this.data.activity.filter((a) => !toDrop.has(a.id));
    }
    this.save();
    return entry;
  }

  activity(eventId, { limit = 200 } = {}) {
    return this.data.activity.filter((a) => a.eventId === eventId).slice(-limit).reverse();
  }

  // ---------- settings ----------
  getSettings() { return this.data.settings; }

  updateSettings(patch) {
    const s = this.data.settings;
    if (patch.name !== undefined) s.name = str(patch.name, { max: 120 }) || s.name;
    if (patch.autoConvertPdf !== undefined) s.autoConvertPdf = Boolean(patch.autoConvertPdf);
    if (patch.autoThumbnails !== undefined) s.autoThumbnails = Boolean(patch.autoThumbnails);
    if (patch.destinations !== undefined) s.destinations = tags(patch.destinations);
    if (patch.checklistTemplate !== undefined) s.checklistTemplate = tags(patch.checklistTemplate).map((t) => t.slice(0, 120));
    this.save();
    return s;
  }

  // ---------- events ----------
  listEvents() {
    return this.data.events
      .map((e) => this.eventSummary(e))
      .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || '') || a.name.localeCompare(b.name));
  }

  eventSummary(e) {
    const sessions = this.data.sessions.filter((s) => s.eventId === e.id);
    const assets = this.data.assets.filter((a) => a.eventId === e.id);
    const clips = this.data.clips.filter((c) => c.eventId === e.id);
    const levels = { pronto: 0, parcial: 0, pendente: 0, na: 0 };
    for (const s of sessions) levels[computeReadiness(s, assets).level]++;
    const countable = sessions.length - levels.na;
    return {
      ...e,
      stats: {
        sessions: sessions.length,
        rooms: this.data.rooms.filter((r) => r.eventId === e.id).length,
        speakers: this.data.speakers.filter((s) => s.eventId === e.id).length,
        assets: assets.length,
        clips: clips.length,
        totalBytes: assets.reduce((n, a) => n + (a.size || 0), 0),
        readiness: levels,
        readyPercent: countable ? Math.round((levels.pronto / countable) * 100) : 100,
      },
    };
  }

  getEvent(id) {
    const e = this.data.events.find((x) => x.id === id);
    if (!e) throw notFound('Evento');
    return e;
  }

  _uniqueSlug(base, ignoreId) {
    let slug = base;
    let i = 2;
    while (this.data.events.some((e) => e.slug === slug && e.id !== ignoreId)) slug = `${base}-${i++}`;
    return slug;
  }

  async createEvent(input, user) {
    const name = str(input.name, { max: 160, required: true, field: 'nome' });
    const startDate = isoDate(input.startDate, { field: 'data inicial' });
    const endDate = isoDate(input.endDate, { field: 'data final' }) || startDate;
    if (startDate && endDate < startDate) throw badRequest('A data final não pode ser anterior à inicial');
    const event = {
      id: newId('ev'),
      slug: this._uniqueSlug(slugify(`${name}${startDate ? '-' + startDate.slice(0, 4) : ''}`)),
      name,
      description: str(input.description, { max: 4000 }),
      venue: str(input.venue, { max: 200 }),
      city: str(input.city, { max: 120 }),
      client: str(input.client, { max: 160 }),
      startDate,
      endDate,
      status: oneOf(input.status, EVENT_STATUSES, { field: 'status', fallback: 'planejamento' }),
      color: str(input.color, { max: 20 }) || pickColor(this.data.events.length),
      checklistTemplate: input.checklistTemplate !== undefined ? tags(input.checklistTemplate) : null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.data.events.push(event);
    await this.storage.ensureEvent(event.slug);
    this.log(event.id, user, 'criou', 'evento', event.id, event.name);
    return event;
  }

  updateEvent(id, patch, user) {
    const e = this.getEvent(id);
    if (patch.name !== undefined) e.name = str(patch.name, { max: 160, required: true, field: 'nome' });
    if (patch.description !== undefined) e.description = str(patch.description, { max: 4000 });
    if (patch.venue !== undefined) e.venue = str(patch.venue, { max: 200 });
    if (patch.city !== undefined) e.city = str(patch.city, { max: 120 });
    if (patch.client !== undefined) e.client = str(patch.client, { max: 160 });
    if (patch.startDate !== undefined) e.startDate = isoDate(patch.startDate, { field: 'data inicial' });
    if (patch.endDate !== undefined) e.endDate = isoDate(patch.endDate, { field: 'data final' });
    if (e.startDate && e.endDate && e.endDate < e.startDate) throw badRequest('A data final não pode ser anterior à inicial');
    if (!e.endDate) e.endDate = e.startDate;
    if (patch.status !== undefined) e.status = oneOf(patch.status, EVENT_STATUSES, { field: 'status', fallback: e.status });
    if (patch.color !== undefined) e.color = str(patch.color, { max: 20 }) || e.color;
    if (patch.checklistTemplate !== undefined) e.checklistTemplate = patch.checklistTemplate === null ? null : tags(patch.checklistTemplate);
    e.updatedAt = nowIso();
    this.log(e.id, user, 'editou', 'evento', e.id, e.name);
    return e;
  }

  async deleteEvent(id, user) {
    const e = this.getEvent(id);
    const d = this.data;
    d.events = d.events.filter((x) => x.id !== id);
    d.rooms = d.rooms.filter((x) => x.eventId !== id);
    d.speakers = d.speakers.filter((x) => x.eventId !== id);
    d.sessions = d.sessions.filter((x) => x.eventId !== id);
    d.assets = d.assets.filter((x) => x.eventId !== id);
    d.clips = d.clips.filter((x) => x.eventId !== id);
    d.activity = d.activity.filter((x) => x.eventId !== id);
    this.save();
    const dir = this.storage.eventDir(e.slug);
    const archived = path.join(this.storage.root, 'eventos-excluidos', `${e.slug}-${Date.now()}`);
    if (await exists(dir)) {
      await fsp.mkdir(path.dirname(archived), { recursive: true });
      await fsp.rename(dir, archived).catch(() => fsp.rm(dir, { recursive: true, force: true }));
    }
    return { ok: true, archivedTo: archived };
  }

  eventChecklistTemplate(event) {
    return event.checklistTemplate && event.checklistTemplate.length ? event.checklistTemplate : this.data.settings.checklistTemplate;
  }

  eventBundle(id) {
    const event = this.eventSummary(this.getEvent(id));
    const assets = this.data.assets.filter((a) => a.eventId === id);
    const sessions = this.data.sessions
      .filter((s) => s.eventId === id)
      .map((s) => ({ ...s, readiness: computeReadiness(s, assets) }))
      .sort((a, b) => sessionSortKey(a).localeCompare(sessionSortKey(b)));
    return {
      event,
      rooms: this.data.rooms.filter((r) => r.eventId === id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name)),
      speakers: this.data.speakers.filter((s) => s.eventId === id).sort((a, b) => a.name.localeCompare(b.name)),
      sessions,
      assets: assets.slice().sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || '')),
      clips: this.data.clips.filter((c) => c.eventId === id).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
      checklistTemplate: this.eventChecklistTemplate(event),
      destinations: this.data.settings.destinations,
      jobs: this.jobs ? this.jobs.list({ eventId: id, limit: 50 }) : [],
    };
  }

  // ---------- rooms ----------
  getRoom(id) {
    const r = this.data.rooms.find((x) => x.id === id);
    if (!r) throw notFound('Sala');
    return r;
  }

  createRoom(eventId, input, user) {
    this.getEvent(eventId);
    const room = {
      id: newId('rm'), eventId,
      name: str(input.name, { max: 80, required: true, field: 'nome' }),
      capacity: num(input.capacity, { min: 0, max: 1000000, field: 'capacidade' }),
      notes: str(input.notes, { max: 2000 }),
      order: num(input.order, { min: 0, max: 10000 }) ?? this.data.rooms.filter((r) => r.eventId === eventId).length,
      createdAt: nowIso(),
    };
    this.data.rooms.push(room);
    this.log(eventId, user, 'criou', 'sala', room.id, room.name);
    return room;
  }

  updateRoom(id, patch, user) {
    const r = this.getRoom(id);
    if (patch.name !== undefined) r.name = str(patch.name, { max: 80, required: true, field: 'nome' });
    if (patch.capacity !== undefined) r.capacity = num(patch.capacity, { min: 0, max: 1000000, field: 'capacidade' });
    if (patch.notes !== undefined) r.notes = str(patch.notes, { max: 2000 });
    if (patch.order !== undefined) r.order = num(patch.order, { min: 0, max: 10000 }) ?? r.order;
    this.log(r.eventId, user, 'editou', 'sala', r.id, r.name);
    return r;
  }

  deleteRoom(id, user) {
    const r = this.getRoom(id);
    this.data.rooms = this.data.rooms.filter((x) => x.id !== id);
    for (const s of this.data.sessions) if (s.roomId === id) s.roomId = null;
    this.log(r.eventId, user, 'excluiu', 'sala', r.id, r.name);
    return { ok: true };
  }

  // ---------- speakers ----------
  getSpeaker(id) {
    const s = this.data.speakers.find((x) => x.id === id);
    if (!s) throw notFound('Palestrante');
    return s;
  }

  createSpeaker(eventId, input, user) {
    this.getEvent(eventId);
    const sp = {
      id: newId('sp'), eventId,
      name: str(input.name, { max: 120, required: true, field: 'nome' }),
      company: str(input.company, { max: 120 }),
      role: str(input.role, { max: 120 }),
      email: str(input.email, { max: 160 }),
      phone: str(input.phone, { max: 60 }),
      bio: str(input.bio, { max: 4000 }),
      notes: str(input.notes, { max: 2000 }),
      createdAt: nowIso(),
    };
    this.data.speakers.push(sp);
    this.log(eventId, user, 'criou', 'palestrante', sp.id, sp.name);
    return sp;
  }

  updateSpeaker(id, patch, user) {
    const sp = this.getSpeaker(id);
    for (const [field, max] of [['name', 120], ['company', 120], ['role', 120], ['email', 160], ['phone', 60], ['bio', 4000], ['notes', 2000]]) {
      if (patch[field] !== undefined) sp[field] = str(patch[field], { max, required: field === 'name', field: 'nome' });
    }
    this.log(sp.eventId, user, 'editou', 'palestrante', sp.id, sp.name);
    return sp;
  }

  deleteSpeaker(id, user) {
    const sp = this.getSpeaker(id);
    this.data.speakers = this.data.speakers.filter((x) => x.id !== id);
    for (const s of this.data.sessions) s.speakerIds = (s.speakerIds || []).filter((x) => x !== id);
    for (const a of this.data.assets) if (a.speakerId === id) a.speakerId = null;
    this.log(sp.eventId, user, 'excluiu', 'palestrante', sp.id, sp.name);
    return { ok: true };
  }

  findOrCreateSpeaker(eventId, name, user) {
    const key = normalizeForSearch(name);
    if (!key) return null;
    const found = this.data.speakers.find((s) => s.eventId === eventId && normalizeForSearch(s.name) === key);
    return found || this.createSpeaker(eventId, { name }, user);
  }

  findOrCreateRoom(eventId, name, user) {
    const key = normalizeForSearch(name);
    if (!key) return null;
    const found = this.data.rooms.find((r) => r.eventId === eventId && normalizeForSearch(r.name) === key);
    return found || this.createRoom(eventId, { name }, user);
  }

  // ---------- sessions ----------
  getSession(id) {
    const s = this.data.sessions.find((x) => x.id === id);
    if (!s) throw notFound('Sessão');
    return s;
  }

  _validateSessionRefs(eventId, { roomId, speakerIds }) {
    if (roomId) {
      const r = this.data.rooms.find((x) => x.id === roomId && x.eventId === eventId);
      if (!r) throw badRequest('Sala inválida para este evento');
    }
    if (speakerIds) {
      for (const id of speakerIds) {
        if (!this.data.speakers.some((x) => x.id === id && x.eventId === eventId)) throw badRequest('Palestrante inválido para este evento');
      }
    }
  }

  createSession(eventId, input, user) {
    const event = this.getEvent(eventId);
    const speakerIds = Array.isArray(input.speakerIds) ? [...new Set(input.speakerIds)] : [];
    const roomId = input.roomId || null;
    this._validateSessionRefs(eventId, { roomId, speakerIds });
    const start = hhmm(input.start, { field: 'início' });
    const end = hhmm(input.end, { field: 'término' });
    if (start && end && timeToMinutes(end) < timeToMinutes(start)) throw badRequest('O término não pode ser antes do início');
    const template = Array.isArray(input.checklist) ? input.checklist : this.eventChecklistTemplate(event);
    const session = {
      id: newId('ss'), eventId, roomId,
      title: str(input.title, { max: 200, required: true, field: 'título' }),
      type: oneOf(input.type, SESSION_TYPES, { field: 'tipo', fallback: 'palestra' }),
      date: isoDate(input.date, { field: 'data' }) || event.startDate || '',
      start, end,
      speakerIds,
      description: str(input.description, { max: 4000 }),
      notes: str(input.notes, { max: 4000 }),
      noMaterial: Boolean(input.noMaterial),
      tags: tags(input.tags),
      checklist: template.map((t) => (typeof t === 'string' ? { id: newId('ck'), text: t, done: false, doneBy: null, doneAt: null } : { id: newId('ck'), text: str(t.text, { max: 200 }), done: Boolean(t.done), doneBy: null, doneAt: null })),
      order: num(input.order, { min: 0, max: 100000 }) ?? this.data.sessions.filter((s) => s.eventId === eventId).length,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    if (session.type === 'intervalo') session.checklist = [];
    this.data.sessions.push(session);
    this.log(eventId, user, 'criou', 'sessao', session.id, session.title);
    return session;
  }

  updateSession(id, patch, user) {
    const s = this.getSession(id);
    if (patch.title !== undefined) s.title = str(patch.title, { max: 200, required: true, field: 'título' });
    if (patch.type !== undefined) s.type = oneOf(patch.type, SESSION_TYPES, { field: 'tipo', fallback: s.type });
    if (patch.date !== undefined) s.date = isoDate(patch.date, { field: 'data' });
    if (patch.start !== undefined) s.start = hhmm(patch.start, { field: 'início' });
    if (patch.end !== undefined) s.end = hhmm(patch.end, { field: 'término' });
    if (s.start && s.end && timeToMinutes(s.end) < timeToMinutes(s.start)) throw badRequest('O término não pode ser antes do início');
    if (patch.roomId !== undefined) {
      this._validateSessionRefs(s.eventId, { roomId: patch.roomId || null });
      s.roomId = patch.roomId || null;
    }
    if (patch.speakerIds !== undefined) {
      const ids = Array.isArray(patch.speakerIds) ? [...new Set(patch.speakerIds)] : [];
      this._validateSessionRefs(s.eventId, { speakerIds: ids });
      s.speakerIds = ids;
    }
    if (patch.description !== undefined) s.description = str(patch.description, { max: 4000 });
    if (patch.notes !== undefined) s.notes = str(patch.notes, { max: 4000 });
    if (patch.noMaterial !== undefined) s.noMaterial = Boolean(patch.noMaterial);
    if (patch.tags !== undefined) s.tags = tags(patch.tags);
    if (patch.order !== undefined) s.order = num(patch.order, { min: 0, max: 100000 }) ?? s.order;
    s.updatedAt = nowIso();
    this.log(s.eventId, user, 'editou', 'sessao', s.id, s.title);
    return s;
  }

  deleteSession(id, user) {
    const s = this.getSession(id);
    this.data.sessions = this.data.sessions.filter((x) => x.id !== id);
    for (const a of this.data.assets) if (a.sessionId === id) a.sessionId = null;
    for (const c of this.data.clips) if (c.sessionId === id) c.sessionId = null;
    this.log(s.eventId, user, 'excluiu', 'sessao', s.id, s.title);
    return { ok: true };
  }

  duplicateSession(id, user) {
    const s = this.getSession(id);
    const copy = this.createSession(s.eventId, {
      ...s, title: `${s.title} (cópia)`, checklist: s.checklist.map((c) => ({ text: c.text })), order: (s.order ?? 0) + 1,
    }, user);
    return copy;
  }

  // checklist items
  addChecklistItem(sessionId, text, user) {
    const s = this.getSession(sessionId);
    const item = { id: newId('ck'), text: str(text, { max: 200, required: true, field: 'texto' }), done: false, doneBy: null, doneAt: null };
    s.checklist.push(item);
    s.updatedAt = nowIso();
    this.save();
    return item;
  }

  updateChecklistItem(sessionId, itemId, patch, user) {
    const s = this.getSession(sessionId);
    const item = s.checklist.find((c) => c.id === itemId);
    if (!item) throw notFound('Item do checklist');
    if (patch.text !== undefined) item.text = str(patch.text, { max: 200, required: true, field: 'texto' });
    if (patch.done !== undefined) {
      item.done = Boolean(patch.done);
      item.doneBy = item.done ? user || 'anônimo' : null;
      item.doneAt = item.done ? nowIso() : null;
      this.log(s.eventId, user, item.done ? 'concluiu item' : 'reabriu item', 'sessao', s.id, `${item.text} — ${s.title}`);
    }
    s.updatedAt = nowIso();
    this.save();
    return item;
  }

  deleteChecklistItem(sessionId, itemId) {
    const s = this.getSession(sessionId);
    s.checklist = s.checklist.filter((c) => c.id !== itemId);
    s.updatedAt = nowIso();
    this.save();
    return { ok: true };
  }

  applyChecklistTemplate(eventId, { onlyEmpty = true } = {}, user) {
    const event = this.getEvent(eventId);
    const template = this.eventChecklistTemplate(event);
    let touched = 0;
    for (const s of this.data.sessions) {
      if (s.eventId !== eventId || s.type === 'intervalo') continue;
      if (onlyEmpty && s.checklist.length) continue;
      const existing = new Set(s.checklist.map((c) => normalizeForSearch(c.text)));
      for (const t of template) {
        if (!existing.has(normalizeForSearch(t))) s.checklist.push({ id: newId('ck'), text: t, done: false, doneBy: null, doneAt: null });
      }
      touched++;
    }
    this.log(eventId, user, 'aplicou checklist', 'evento', eventId, `${touched} sessões`);
    return { touched };
  }

  // ---------- assets ----------
  getAsset(id) {
    const a = this.data.assets.find((x) => x.id === id);
    if (!a) throw notFound('Material');
    return a;
  }

  assetPath(asset) {
    const event = this.getEvent(asset.eventId);
    return path.join(this.storage.filesDir(event.slug), asset.fileName);
  }

  assetThumbPath(asset) {
    const event = this.getEvent(asset.eventId);
    return path.join(this.storage.thumbsDir(event.slug), `${asset.id}.jpg`);
  }

  assetDerivedPath(asset, name) {
    const event = this.getEvent(asset.eventId);
    return path.join(this.storage.derivedDir(event.slug), name);
  }

  versionPath(asset, version) {
    const event = this.getEvent(asset.eventId);
    return path.join(this.storage.versionsDir(event.slug), version.fileName);
  }

  _validateAssetRefs(eventId, { sessionId, speakerId }) {
    if (sessionId && !this.data.sessions.some((s) => s.id === sessionId && s.eventId === eventId)) throw badRequest('Sessão inválida para este evento');
    if (speakerId && !this.data.speakers.some((s) => s.id === speakerId && s.eventId === eventId)) throw badRequest('Palestrante inválido para este evento');
  }

  // Registers an uploaded/imported file (already on disk at tmpPath) as an asset.
  async addAsset({ eventId, tmpPath, originalName, size, sha256, sessionId = null, speakerId = null, kind, status, notes, tags: tagList, source = 'upload', clipId = null, derivedFrom = null, user, move = true }) {
    const event = this.getEvent(eventId);
    this._validateAssetRefs(eventId, { sessionId, speakerId });
    const cleanName = safeFileName(originalName);
    const id = newId('as');
    const fileName = `${id}__${cleanName}`;
    const dest = path.join(this.storage.filesDir(event.slug), fileName);
    await this.storage.ensureEvent(event.slug);
    if (move) await this.storage.moveFile(tmpPath, dest);
    else await this.storage.copyFile(tmpPath, dest);
    if (!sha256 || !size) {
      const h = await this.storage.hashFile(dest);
      sha256 = h.sha256;
      size = h.size;
    }
    const duplicateOf = this.data.assets.find((a) => a.eventId === eventId && a.sha256 === sha256);
    const asset = {
      id, eventId, sessionId, speakerId,
      kind: oneOf(kind, KIND_IDS, { field: 'tipo', fallback: kindFromName(originalName) }),
      name: path.basename(originalName, path.extname(originalName)).trim().slice(0, 160) || cleanName,
      fileName,
      originalName: String(originalName).slice(0, 255),
      ext: extOf(originalName),
      mime: mimeOf(originalName),
      size, sha256,
      status: oneOf(status, ASSET_STATUSES, { field: 'status', fallback: 'recebido' }),
      version: 1,
      versions: [],
      meta: {},
      thumb: false,
      derived: {},
      tags: tags(tagList),
      notes: str(notes, { max: 4000 }),
      source, clipId, derivedFrom,
      duplicateOf: duplicateOf ? duplicateOf.id : null,
      uploadedBy: user || 'anônimo',
      uploadedAt: nowIso(),
      updatedAt: nowIso(),
      analyzed: false,
    };
    this.data.assets.push(asset);
    this.log(eventId, user, 'adicionou', 'material', asset.id, asset.originalName);
    this.scheduleAnalysis(asset);
    return asset;
  }

  scheduleAnalysis(asset) {
    if (!this.jobs) return null;
    return this.jobs.add({
      type: 'analisar', eventId: asset.eventId, label: `Analisar ${asset.originalName}`, meta: { assetId: asset.id },
      run: () => this.analyzeAsset(asset.id),
    });
  }

  async analyzeAsset(id) {
    const asset = this.getAsset(id);
    const file = this.assetPath(asset);
    const settings = this.data.settings;
    const meta = { ...asset.meta };
    const thumb = this.assetThumbPath(asset);
    try {
      if (['video', 'corte', 'audio'].includes(asset.kind)) {
        Object.assign(meta, (await this.media.probe(file)) || {});
        if (settings.autoThumbnails && asset.kind !== 'audio') {
          const at = meta.duration ? Math.min(Math.max(1, meta.duration * 0.1), 30) : 1;
          asset.thumb = await this.media.videoThumbnail(file, thumb, { at });
        }
      } else if (asset.kind === 'pdf') {
        const pages = await this.media.pdfPages(file);
        if (pages) meta.pages = pages;
        if (settings.autoThumbnails) asset.thumb = await this.media.pdfThumbnail(file, thumb);
      } else if (asset.kind === 'imagem') {
        Object.assign(meta, pick((await this.media.probe(file)) || {}, ['width', 'height']));
        if (settings.autoThumbnails) asset.thumb = await this.media.imageThumbnail(file, thumb);
      } else if (asset.kind === 'apresentacao') {
        const slides = await this.media.presentationSlides(file);
        if (slides) meta.slides = slides;
        if (settings.autoConvertPdf && this.media.tools.soffice && !asset.derived.pdf) {
          this.jobs?.add({
            type: 'converter', eventId: asset.eventId, label: `Gerar prévia em PDF de ${asset.originalName}`, meta: { assetId: asset.id },
            run: () => this.convertAssetToPdf(asset.id),
          });
        }
      }
    } finally {
      asset.meta = meta;
      asset.analyzed = true;
      asset.updatedAt = nowIso();
      this.save();
    }
    return { meta };
  }

  async convertAssetToPdf(id) {
    const asset = this.getAsset(id);
    if (asset.kind !== 'apresentacao' && asset.kind !== 'documento') throw badRequest('Só apresentações e documentos podem ser convertidos em PDF');
    const outDir = this.assetDerivedPath(asset, `${asset.id}-conv`);
    const produced = await this.media.convertToPdf(this.assetPath(asset), outDir);
    const dest = this.assetDerivedPath(asset, `${asset.id}.pdf`);
    await this.storage.moveFile(produced, dest);
    await fsp.rm(outDir, { recursive: true, force: true });
    asset.derived.pdf = path.basename(dest);
    const pages = await this.media.pdfPages(dest);
    if (pages) asset.meta.slides = asset.meta.slides || pages;
    if (this.data.settings.autoThumbnails) asset.thumb = await this.media.pdfThumbnail(dest, this.assetThumbPath(asset));
    asset.updatedAt = nowIso();
    this.save();
    return { pdf: asset.derived.pdf };
  }

  requestConversion(id, user) {
    const asset = this.getAsset(id);
    if (!this.media.tools.soffice) throw new HttpError(409, 'LibreOffice não está instalado; não é possível converter para PDF');
    const job = this.jobs.add({
      type: 'converter', eventId: asset.eventId, label: `Gerar prévia em PDF de ${asset.originalName}`, meta: { assetId: asset.id },
      run: () => this.convertAssetToPdf(asset.id),
    });
    this.log(asset.eventId, user, 'solicitou PDF', 'material', asset.id, asset.originalName);
    return job;
  }

  // Creates a real PDF asset (backup) from the derived PDF of a presentation.
  async promotePdfBackup(id, user) {
    const asset = this.getAsset(id);
    if (!asset.derived.pdf) throw new HttpError(409, 'Gere a prévia em PDF primeiro');
    const src = this.assetDerivedPath(asset, asset.derived.pdf);
    const pdfName = `${path.basename(asset.originalName, path.extname(asset.originalName))}.pdf`;
    const created = await this.addAsset({
      eventId: asset.eventId, tmpPath: src, originalName: pdfName, sessionId: asset.sessionId, speakerId: asset.speakerId,
      kind: 'pdf', status: asset.status === 'final' || asset.status === 'aprovado' ? asset.status : 'recebido',
      notes: `Backup em PDF gerado a partir de ${asset.originalName}`, tags: ['backup-pdf'], source: 'conversao', derivedFrom: asset.id, user, move: false,
    });
    return created;
  }

  requestProxy(id, user) {
    const asset = this.getAsset(id);
    if (!['video', 'corte'].includes(asset.kind)) throw badRequest('Só vídeos podem gerar prévia');
    if (!this.media.tools.ffmpeg) throw new HttpError(409, 'ffmpeg não está instalado');
    const job = this.jobs.add({
      type: 'previa', eventId: asset.eventId, label: `Gerar prévia MP4 de ${asset.originalName}`, meta: { assetId: asset.id },
      run: async (update) => {
        const dest = this.assetDerivedPath(asset, `${asset.id}-proxy.mp4`);
        await this.media.makeProxy(this.assetPath(asset), dest, { duration: asset.meta.duration, onProgress: update });
        asset.derived.proxy = path.basename(dest);
        asset.updatedAt = nowIso();
        this.save();
        return { proxy: asset.derived.proxy };
      },
    });
    this.log(asset.eventId, user, 'solicitou prévia', 'material', asset.id, asset.originalName);
    return job;
  }

  updateAsset(id, patch, user) {
    const a = this.getAsset(id);
    if (patch.name !== undefined) a.name = str(patch.name, { max: 160, required: true, field: 'nome' });
    if (patch.kind !== undefined) a.kind = oneOf(patch.kind, KIND_IDS, { field: 'tipo', fallback: a.kind });
    if (patch.status !== undefined) {
      const newStatus = oneOf(patch.status, ASSET_STATUSES, { field: 'status', fallback: a.status });
      if (newStatus !== a.status) {
        a.status = newStatus;
        a.statusBy = user || 'anônimo';
        a.statusAt = nowIso();
        this.log(a.eventId, user, `marcou como ${newStatus.replace('_', ' ')}`, 'material', a.id, a.originalName);
      }
    }
    if (patch.sessionId !== undefined || patch.speakerId !== undefined) {
      const sessionId = patch.sessionId !== undefined ? patch.sessionId || null : a.sessionId;
      const speakerId = patch.speakerId !== undefined ? patch.speakerId || null : a.speakerId;
      this._validateAssetRefs(a.eventId, { sessionId, speakerId });
      a.sessionId = sessionId;
      a.speakerId = speakerId;
    }
    if (patch.notes !== undefined) a.notes = str(patch.notes, { max: 4000 });
    if (patch.tags !== undefined) a.tags = tags(patch.tags);
    a.updatedAt = nowIso();
    this.save();
    return a;
  }

  async addAssetVersion(id, { tmpPath, originalName, size, sha256, note, user }) {
    const a = this.getAsset(id);
    const event = this.getEvent(a.eventId);
    const current = this.assetPath(a);
    const archivedName = `${a.id}__v${a.version}__${safeFileName(a.originalName)}`;
    if (await exists(current)) await this.storage.moveFile(current, path.join(this.storage.versionsDir(event.slug), archivedName));
    a.versions.push({
      id: newId('ver'), version: a.version, fileName: archivedName, originalName: a.originalName, size: a.size, sha256: a.sha256,
      uploadedAt: a.uploadedAt, uploadedBy: a.uploadedBy, meta: a.meta, status: a.status,
    });
    const cleanName = safeFileName(originalName);
    a.fileName = `${a.id}__${cleanName}`;
    await this.storage.moveFile(tmpPath, path.join(this.storage.filesDir(event.slug), a.fileName));
    a.originalName = String(originalName).slice(0, 255);
    a.ext = extOf(originalName);
    a.mime = mimeOf(originalName);
    a.size = size;
    a.sha256 = sha256;
    a.version += 1;
    a.status = 'recebido';
    a.meta = {};
    a.analyzed = false;
    a.thumb = false;
    for (const derived of Object.values(a.derived)) await this.storage.removeQuiet(this.assetDerivedPath(a, derived));
    a.derived = {};
    a.uploadedBy = user || 'anônimo';
    a.uploadedAt = nowIso();
    a.updatedAt = nowIso();
    if (note) a.notes = `${a.notes ? a.notes + '\n' : ''}v${a.version}: ${str(note, { max: 500 })}`;
    this.log(a.eventId, user, `enviou versão ${a.version}`, 'material', a.id, a.originalName);
    this.scheduleAnalysis(a);
    return a;
  }

  async deleteAsset(id, user) {
    const a = this.getAsset(id);
    const event = this.getEvent(a.eventId);
    await this.storage.moveToTrash(event.slug, this.assetPath(a));
    for (const v of a.versions) await this.storage.moveToTrash(event.slug, this.versionPath(a, v));
    for (const derived of Object.values(a.derived)) await this.storage.removeQuiet(this.assetDerivedPath(a, derived));
    await this.storage.removeQuiet(this.assetThumbPath(a));
    this.data.assets = this.data.assets.filter((x) => x.id !== id);
    for (const c of this.data.clips) if (c.outputAssetId === id) c.outputAssetId = null;
    for (const x of this.data.assets) if (x.duplicateOf === id) x.duplicateOf = null;
    this.log(a.eventId, user, 'excluiu', 'material', a.id, `${a.originalName} (enviado à lixeira)`);
    return { ok: true };
  }

  // ---------- clips ----------
  getClip(id) {
    const c = this.data.clips.find((x) => x.id === id);
    if (!c) throw notFound('Corte');
    return c;
  }

  createClip(eventId, input, user) {
    this.getEvent(eventId);
    const source = this.getAsset(str(input.sourceAssetId, { required: true, field: 'vídeo de origem' }));
    if (source.eventId !== eventId) throw badRequest('O vídeo de origem pertence a outro evento');
    if (!['video', 'corte'].includes(source.kind)) throw badRequest('O material de origem precisa ser um vídeo');
    const start = num(input.start, { min: 0, field: 'início', required: true });
    const end = num(input.end, { min: 0, field: 'fim', required: true });
    if (end <= start) throw badRequest('O fim do corte precisa ser depois do início');
    const clip = {
      id: newId('cl'), eventId,
      sourceAssetId: source.id,
      sessionId: input.sessionId || source.sessionId || null,
      title: str(input.title, { max: 200, required: true, field: 'título' }),
      description: str(input.description, { max: 4000 }),
      start: Math.round(start * 100) / 100,
      end: Math.round(end * 100) / 100,
      destinations: tags(input.destinations),
      format: oneOf(input.format, CLIP_FORMATS, { field: 'formato', fallback: 'original' }),
      mode: oneOf(input.mode, CLIP_MODES, { field: 'modo', fallback: 'preciso' }),
      status: oneOf(input.status, CLIP_STATUSES, { field: 'status', fallback: 'planejado' }),
      outputAssetId: null,
      notes: str(input.notes, { max: 4000 }),
      tags: tags(input.tags),
      createdBy: user || 'anônimo',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      error: null,
    };
    this._validateAssetRefs(eventId, { sessionId: clip.sessionId });
    this.data.clips.push(clip);
    this.log(eventId, user, 'criou', 'corte', clip.id, clip.title);
    return clip;
  }

  updateClip(id, patch, user) {
    const c = this.getClip(id);
    if (patch.title !== undefined) c.title = str(patch.title, { max: 200, required: true, field: 'título' });
    if (patch.description !== undefined) c.description = str(patch.description, { max: 4000 });
    if (patch.start !== undefined) c.start = Math.round(num(patch.start, { min: 0, field: 'início', required: true }) * 100) / 100;
    if (patch.end !== undefined) c.end = Math.round(num(patch.end, { min: 0, field: 'fim', required: true }) * 100) / 100;
    if (c.end <= c.start) throw badRequest('O fim do corte precisa ser depois do início');
    if (patch.destinations !== undefined) c.destinations = tags(patch.destinations);
    if (patch.format !== undefined) c.format = oneOf(patch.format, CLIP_FORMATS, { field: 'formato', fallback: c.format });
    if (patch.mode !== undefined) c.mode = oneOf(patch.mode, CLIP_MODES, { field: 'modo', fallback: c.mode });
    if (patch.status !== undefined) {
      const s = oneOf(patch.status, CLIP_STATUSES, { field: 'status', fallback: c.status });
      if (s !== c.status) { c.status = s; this.log(c.eventId, user, `marcou corte como ${s}`, 'corte', c.id, c.title); }
    }
    if (patch.sessionId !== undefined) {
      this._validateAssetRefs(c.eventId, { sessionId: patch.sessionId || null });
      c.sessionId = patch.sessionId || null;
    }
    if (patch.notes !== undefined) c.notes = str(patch.notes, { max: 4000 });
    if (patch.tags !== undefined) c.tags = tags(patch.tags);
    c.updatedAt = nowIso();
    this.save();
    return c;
  }

  async deleteClip(id, { deleteOutput = false } = {}, user) {
    const c = this.getClip(id);
    if (deleteOutput && c.outputAssetId && this.data.assets.some((a) => a.id === c.outputAssetId)) await this.deleteAsset(c.outputAssetId, user);
    this.data.clips = this.data.clips.filter((x) => x.id !== id);
    this.log(c.eventId, user, 'excluiu', 'corte', c.id, c.title);
    return { ok: true };
  }

  renderClip(id, user) {
    const clip = this.getClip(id);
    const source = this.getAsset(clip.sourceAssetId);
    const event = this.getEvent(clip.eventId);
    if (!this.media.tools.ffmpeg) throw new HttpError(409, 'ffmpeg não está instalado; não é possível renderizar cortes');
    if (clip.status === 'renderizando') throw new HttpError(409, 'Este corte já está sendo renderizado');
    clip.status = 'renderizando';
    clip.error = null;
    clip.updatedAt = nowIso();
    this.save();
    const job = this.jobs.add({
      type: 'renderizar', eventId: clip.eventId, label: `Renderizar corte "${clip.title}"`, meta: { clipId: clip.id },
      run: async (update) => {
        const outName = `${clip.id}-${slugify(clip.title, { maxLength: 40 })}.mp4`;
        const tmpOut = path.join(this.storage.clipsDir(event.slug), outName);
        try {
          await this.media.renderClip(this.assetPath(source), tmpOut, { start: clip.start, end: clip.end, mode: clip.mode, format: clip.format, onProgress: update });
          if (clip.outputAssetId && this.data.assets.some((a) => a.id === clip.outputAssetId)) await this.deleteAsset(clip.outputAssetId, user);
          const displayName = `${clip.title}${clip.format !== 'original' ? ` (${clip.format})` : ''}.mp4`;
          const asset = await this.addAsset({
            eventId: clip.eventId, tmpPath: tmpOut, originalName: displayName, sessionId: clip.sessionId, speakerId: source.speakerId,
            kind: 'corte', status: 'em_revisao', tags: [...clip.destinations, ...clip.tags], notes: `Corte de ${source.originalName} (${clip.start}s → ${clip.end}s)`,
            source: 'corte', clipId: clip.id, derivedFrom: source.id, user,
          });
          clip.outputAssetId = asset.id;
          clip.status = 'revisao';
          clip.updatedAt = nowIso();
          this.save();
          this.log(clip.eventId, user, 'renderizou', 'corte', clip.id, clip.title);
          return { assetId: asset.id };
        } catch (err) {
          clip.status = 'erro';
          clip.error = err.message;
          clip.updatedAt = nowIso();
          this.save();
          throw err;
        }
      },
    });
    return job;
  }

  // ---------- search ----------
  search(q, { limit = 50 } = {}) {
    const needle = normalizeForSearch(q);
    if (!needle) return [];
    const hits = [];
    const eventName = (id) => this.data.events.find((e) => e.id === id)?.name || '';
    const match = (...fields) => fields.some((f) => normalizeForSearch(f).includes(needle));
    for (const e of this.data.events) if (match(e.name, e.venue, e.city, e.client, e.description)) hits.push({ type: 'evento', id: e.id, eventId: e.id, title: e.name, subtitle: [e.startDate, e.venue].filter(Boolean).join(' · ') });
    for (const s of this.data.sessions) {
      const speakers = (s.speakerIds || []).map((id) => this.data.speakers.find((x) => x.id === id)?.name || '');
      if (match(s.title, s.description, s.notes, ...speakers, ...(s.tags || []))) hits.push({ type: 'sessao', id: s.id, eventId: s.eventId, title: s.title, subtitle: `${eventName(s.eventId)} · ${s.date || ''} ${s.start || ''}`.trim() });
    }
    for (const sp of this.data.speakers) if (match(sp.name, sp.company, sp.role, sp.email)) hits.push({ type: 'palestrante', id: sp.id, eventId: sp.eventId, title: sp.name, subtitle: `${eventName(sp.eventId)} · ${sp.company || ''}`.trim() });
    for (const a of this.data.assets) if (match(a.name, a.originalName, a.notes, ...(a.tags || []))) hits.push({ type: 'material', id: a.id, eventId: a.eventId, title: a.originalName, subtitle: `${eventName(a.eventId)} · ${KINDS[a.kind]?.label || a.kind} · ${a.status}` });
    for (const c of this.data.clips) if (match(c.title, c.description, c.notes, ...(c.destinations || []), ...(c.tags || []))) hits.push({ type: 'corte', id: c.id, eventId: c.eventId, title: c.title, subtitle: `${eventName(c.eventId)} · ${c.status}` });
    return hits.slice(0, limit);
  }
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

const COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
function pickColor(i) { return COLORS[i % COLORS.length]; }
