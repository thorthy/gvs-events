// Polls background jobs and notifies on completion.
import { api } from './api.js';
import { state, refresh, emit } from './state.js';
import { toast, JOB_TYPE_LABELS } from './dom.js';

const seen = new Map();
let timer = null;
let currentEventId = null;

export function watchJobs(eventId) {
  currentEventId = eventId;
  schedule(0);
}

export function stopJobs() { currentEventId = null; clearTimeout(timer); timer = null; }

function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(tick, ms);
}

async function tick() {
  if (!currentEventId) return;
  try {
    const jobs = await api.get(`/api/jobs?eventId=${currentEventId}&limit=60`);
    state.jobs = jobs;
    let changed = false;
    for (const job of jobs) {
      const prev = seen.get(job.id);
      if (prev && prev !== job.status && (job.status === 'concluido' || job.status === 'erro')) {
        changed = true;
        const label = JOB_TYPE_LABELS[job.type] || job.type;
        if (job.status === 'erro') toast(`${label} falhou: ${job.error}`, { type: 'error', timeout: 8000 });
        else if (job.type !== 'analisar') toast(`Concluído: ${job.label}`, { type: 'ok' });
      }
      if (prev === undefined && (job.status === 'concluido' || job.status === 'erro')) { /* already finished before we started watching */ }
      seen.set(job.id, job.status);
    }
    emit('jobs');
    if (changed) await refresh();
  } catch { /* ignore polling errors */ }
  const active = state.jobs.some((j) => j.status === 'na_fila' || j.status === 'executando');
  schedule(active ? 1500 : 10000);
}

export function activeJobs() { return state.jobs.filter((j) => j.status === 'na_fila' || j.status === 'executando'); }
