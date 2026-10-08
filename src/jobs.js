// Background job queue with progress tracking.
import { newId, nowIso } from './ids.js';

export class JobQueue {
  constructor({ concurrency = 2, keep = 300 } = {}) {
    this.concurrency = concurrency;
    this.keep = keep;
    this.jobs = [];
    this.running = 0;
    this.listeners = new Set();
  }

  add({ type, eventId = null, label, run, meta = {} }) {
    const job = {
      id: newId('job'), type, eventId, label, meta,
      status: 'na_fila', progress: 0, error: null, result: null,
      createdAt: nowIso(), startedAt: null, finishedAt: null,
    };
    Object.defineProperty(job, '_run', { value: run, enumerable: false });
    this.jobs.push(job);
    if (this.jobs.length > this.keep) {
      const idx = this.jobs.findIndex((j) => j.status === 'concluido' || j.status === 'erro');
      if (idx >= 0) this.jobs.splice(idx, 1);
    }
    this._emit(job);
    queueMicrotask(() => this._pump());
    return job;
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit(job) { for (const fn of this.listeners) { try { fn(job); } catch { /* ignore */ } } }

  _pump() {
    while (this.running < this.concurrency) {
      const next = this.jobs.find((j) => j.status === 'na_fila');
      if (!next) return;
      this.running++;
      next.status = 'executando';
      next.startedAt = nowIso();
      this._emit(next);
      const update = (progress, extra) => {
        next.progress = Math.max(0, Math.min(1, Number(progress) || 0));
        if (extra) Object.assign(next.meta, extra);
        this._emit(next);
      };
      Promise.resolve()
        .then(() => next._run(update, next))
        .then((result) => {
          next.result = result ?? null;
          next.status = 'concluido';
          next.progress = 1;
        })
        .catch((err) => {
          next.status = 'erro';
          next.error = err?.message || String(err);
          console.error(`[job ${next.type}] falhou:`, err);
        })
        .finally(() => {
          next.finishedAt = nowIso();
          this.running--;
          this._emit(next);
          this._pump();
        });
    }
  }

  list({ eventId, limit = 100 } = {}) {
    const all = eventId ? this.jobs.filter((j) => j.eventId === eventId || j.eventId === null) : this.jobs;
    return all.slice(-limit).reverse();
  }

  get(id) { return this.jobs.find((j) => j.id === id) || null; }

  active() { return this.jobs.filter((j) => j.status === 'na_fila' || j.status === 'executando'); }

  async idle() {
    while (this.active().length) await new Promise((r) => setTimeout(r, 25));
  }
}
