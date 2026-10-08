// DOM helpers, formatters, icons, modals, toasts.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') { for (const [prop, val] of Object.entries(v)) { if (val === null || val === undefined) continue; if (prop.startsWith('--')) el.style.setProperty(prop, val); else el.style[prop] = val; } }
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'html') el.innerHTML = v;
      else if (['value', 'checked', 'selected', 'disabled', 'multiple', 'readOnly', 'indeterminate', 'open'].includes(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

export function append(el, ...children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

// Null-safe replacement for Element.replaceChildren.
export function replace(el, ...children) { clear(el); return append(el, children); }

export function frag(...children) { const f = document.createDocumentFragment(); append(f, children); return f; }

// ---------- formatters ----------
export function fmtBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024; let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

export function fmtDuration(seconds, { ms = false } = {}) {
  const total = Math.max(0, Number(seconds) || 0);
  const s = Math.floor(total);
  const hh = Math.floor(s / 3600); const mm = Math.floor((s % 3600) / 60); const ss = s % 60;
  const base = hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
  return ms ? `${base}.${String(Math.floor((total - s) * 10))}` : base;
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export function parseDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function fmtDate(iso, { weekday = false, year = true } = {}) {
  const d = parseDate(iso);
  if (!d) return '';
  const base = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}${year ? '/' + d.getFullYear() : ''}`;
  return weekday ? `${WEEKDAYS[d.getDay()]}, ${base}` : base;
}

export function fmtDateLong(iso) {
  const d = parseDate(iso);
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '';
}

export function fmtDateRange(start, end) {
  if (!start) return 'Sem data';
  if (!end || end === start) return fmtDateLong(start);
  const a = parseDate(start); const b = parseDate(end);
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return `${a.getDate()}–${b.getDate()} ${MONTHS[a.getMonth()]} ${a.getFullYear()}`;
  return `${fmtDateLong(start)} – ${fmtDateLong(end)}`;
}

export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fmtRelative(iso) {
  if (!iso) return '';
  const diff = (Date.now() - Date.parse(iso)) / 1000;
  if (diff < 60) return 'agora há pouco';
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 7) return `há ${Math.floor(diff / 86400)} d`;
  return fmtDateTime(iso);
}

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function nowHHMM(d = new Date()) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function minutesOf(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// ---------- labels ----------
export const STATUS_LABELS = { recebido: 'Recebido', em_revisao: 'Em revisão', aprovado: 'Aprovado', final: 'Final', rejeitado: 'Rejeitado', substituido: 'Substituído' };
export const STATUS_BADGE = { recebido: 'neutral', em_revisao: 'info', aprovado: 'ok', final: 'ok', rejeitado: 'danger', substituido: 'outline' };
export const KIND_LABELS = { apresentacao: 'Apresentação', pdf: 'PDF', video: 'Vídeo', corte: 'Corte', imagem: 'Imagem', audio: 'Áudio', documento: 'Documento', outro: 'Outro' };
export const SESSION_TYPE_LABELS = { palestra: 'Palestra', painel: 'Painel', workshop: 'Workshop', abertura: 'Abertura', encerramento: 'Encerramento', intervalo: 'Intervalo', outro: 'Outro' };
export const EVENT_STATUS_LABELS = { planejamento: 'Planejamento', em_andamento: 'Em andamento', concluido: 'Concluído', arquivado: 'Arquivado' };
export const CLIP_STATUS_LABELS = { planejado: 'Planejado', renderizando: 'Renderizando', revisao: 'Em revisão', aprovado: 'Aprovado', publicado: 'Publicado', erro: 'Erro' };
export const CLIP_STATUS_BADGE = { planejado: 'neutral', renderizando: 'info', revisao: 'warn', aprovado: 'ok', publicado: 'purple', erro: 'danger' };
export const CLIP_FORMAT_LABELS = { original: 'Original (16:9)', vertical: 'Vertical 9:16 (Reels/Shorts)', quadrado: 'Quadrado 1:1' };
export const CLIP_MODE_LABELS = { preciso: 'Preciso (reencoda, cortes exatos)', rapido: 'Rápido (sem reencodar, corta em keyframes)' };
export const READINESS_BADGE = { pronto: 'ok', parcial: 'warn', pendente: 'danger', na: 'outline' };
export const JOB_TYPE_LABELS = { analisar: 'Análise', converter: 'Conversão PDF', previa: 'Prévia MP4', renderizar: 'Renderização', importar: 'Importação', exportar: 'Exportação' };

// ---------- icons ----------
const ICONS = {
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  slides: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  pdf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>',
  video: '<rect x="2" y="5" width="15" height="14" rx="2"/><path d="m17 10 5-3v10l-5-3z"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8M8 9h2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/>',
  play: '<path d="m5 3 14 9-14 9z"/>',
  pause: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10a7 7 0 0 1-14 0M12 17v5M8 22h8"/>',
  live: '<circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19.1 4.9a10 10 0 0 1 0 14.2M4.9 19.1a10 10 0 0 1 0-14.2"/>',
  warning: '<path d="m10.3 3.9-8.5 14.2A2 2 0 0 0 3.5 21h17a2 2 0 0 0 1.7-2.9L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  room: '<path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9v.01M9 12v.01M9 15v.01M9 18v.01"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  filter: '<path d="M22 3H2l8 9.5V19l4 2v-8.5z"/>',
  skipBack: '<path d="M19 20 9 12l10-8zM5 19V5"/>',
  skipForward: '<path d="m5 4 10 8-10 8zM19 5v14"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.5-1.5"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
};

export function icon(name, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', cls ? `icon ${cls}` : 'icon');
  svg.innerHTML = ICONS[name] || ICONS.file;
  return svg;
}

export const KIND_ICON = { apresentacao: 'slides', pdf: 'pdf', video: 'video', corte: 'scissors', imagem: 'image', audio: 'audio', documento: 'doc', outro: 'file' };
export function kindIcon(kind, cls = 'kind-icon') { return icon(KIND_ICON[kind] || 'file', `${cls} kind-${kind}`); }

export function badge(text, variant = 'neutral', extra = {}) { return h('span', { class: `badge badge-${variant}`, ...extra }, text); }
export function statusBadge(status) { return badge(STATUS_LABELS[status] || status, STATUS_BADGE[status] || 'neutral'); }
export function readinessBadge(r) { return badge([h('span', { class: 'dot' }), r.label], READINESS_BADGE[r.level] || 'neutral', { title: `${r.approved} aprovado(s) de ${r.main} principal(is) · checklist ${r.checklistDone}/${r.checklistTotal}` }); }

export function btn(label, { icon: ic, onClick, cls = '', title, type = 'button', disabled } = {}) {
  return h('button', { class: `btn ${cls}`, type, title, onClick, disabled }, ic ? icon(ic) : null, label);
}

export function select(options, value, { onChange, cls = '', empty } = {}) {
  const sel = h('select', { class: `select ${cls}`, onChange: onChange ? (e) => onChange(e.target.value, e) : undefined });
  if (empty !== undefined) sel.append(h('option', { value: '' }, empty));
  for (const o of options) {
    const opt = typeof o === 'string' ? { value: o, label: o } : o;
    sel.append(h('option', { value: opt.value, selected: String(opt.value) === String(value ?? '') }, opt.label));
  }
  if (value !== undefined && value !== null) sel.value = String(value);
  return sel;
}

// ---------- toasts ----------
let toastsEl;
export function toast(message, { type = 'info', timeout = 4000 } = {}) {
  if (!toastsEl) { toastsEl = h('div', { class: 'toasts' }); document.body.append(toastsEl); }
  const el = h('div', { class: `toast ${type}` }, message);
  toastsEl.append(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, timeout);
  return el;
}

// ---------- modals ----------
const modalStack = [];

export function openModal({ title, body, actions = [], size = '', onClose, closeOnOverlay = true }) {
  const close = () => {
    if (!overlay.isConnected) return;
    overlay.remove();
    const idx = modalStack.indexOf(close);
    if (idx >= 0) modalStack.splice(idx, 1);
    onClose?.();
  };
  const footer = actions.length ? h('div', { class: 'modal-footer' }, actions.map((a) => {
    const b = btn(a.label, { icon: a.icon, cls: `${a.primary ? 'btn-primary' : ''} ${a.danger ? 'btn-danger' : ''} ${a.left ? 'left' : ''}`, onClick: async () => {
      if (a.onClick) {
        b.disabled = true;
        try { const r = await a.onClick({ close }); if (r !== false && a.closeAfter !== false) close(); } catch (err) { showFormError(bodyEl, err); } finally { b.disabled = false; }
      } else close();
    } });
    return b;
  })) : null;
  const bodyEl = h('div', { class: 'modal-body' }, body);
  const overlay = h('div', { class: 'overlay', onMousedown: (e) => { if (closeOnOverlay && e.target === overlay) close(); } },
    h('div', { class: `modal ${size}`, role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'modal-header' }, h('h2', null, title), btn('', { icon: 'x', cls: 'btn-ghost btn-icon', onClick: close, title: 'Fechar' })),
      bodyEl, footer));
  document.body.append(overlay);
  modalStack.push(close);
  const first = bodyEl.querySelector('input, select, textarea, button');
  if (first) setTimeout(() => first.focus(), 30);
  return { close, body: bodyEl, overlay };
}

export function closeTopModal() {
  const close = modalStack[modalStack.length - 1];
  if (close) { close(); return true; }
  return false;
}

export function showFormError(container, err) {
  container.querySelectorAll('.form-error').forEach((e) => e.remove());
  container.prepend(h('div', { class: 'form-error' }, err?.message || String(err)));
}

export function confirmDialog({ title = 'Confirmar', message, confirmLabel = 'Confirmar', danger = false }) {
  return new Promise((resolve) => {
    openModal({
      title,
      body: typeof message === 'string' ? h('p', null, message) : message,
      onClose: () => resolve(false),
      actions: [
        { label: 'Cancelar' },
        { label: confirmLabel, primary: !danger, danger, onClick: ({ close }) => { resolve(true); } },
      ],
    });
  });
}

export function promptDialog({ title, label, value = '', placeholder = '', multiline = false, confirmLabel = 'Salvar' }) {
  return new Promise((resolve) => {
    const input = multiline ? h('textarea', { class: 'textarea', placeholder, value }) : h('input', { class: 'input', placeholder, value });
    const { close } = openModal({
      title,
      body: h('label', { class: 'field' }, label, input),
      onClose: () => resolve(null),
      actions: [{ label: 'Cancelar' }, { label: confirmLabel, primary: true, onClick: () => { resolve(input.value); } }],
    });
    if (!multiline) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { resolve(input.value); close(); } });
  });
}

// Generic form modal. fields: {name,label,type,options,value,required,placeholder,hint,span,rows,min,max,step}
export function formModal({ title, fields, submitLabel = 'Salvar', size = '', onSubmit, extraActions = [] }) {
  return new Promise((resolve) => {
    const inputs = {};
    const grid = h('div', { class: 'form-grid' });
    for (const f of fields) {
      let input;
      const common = { name: f.name, placeholder: f.placeholder, required: f.required };
      if (f.type === 'select') input = select(f.options, f.value, { empty: f.empty });
      else if (f.type === 'textarea') input = h('textarea', { class: 'textarea', rows: f.rows || 3, ...common }, f.value || '');
      else if (f.type === 'checkbox') input = h('input', { type: 'checkbox', checked: Boolean(f.value) });
      else if (f.type === 'multiselect') input = h('select', { class: 'select', multiple: true, size: Math.min(6, Math.max(3, f.options.length)) }, f.options.map((o) => h('option', { value: o.value, selected: (f.value || []).includes(o.value) }, o.label)));
      else if (f.type === 'checkboxes') {
        input = h('div', { class: 'flex flex-wrap gap-4' }, f.options.map((o) => h('label', { class: 'chip' }, h('input', { type: 'checkbox', value: o.value, checked: (f.value || []).includes(o.value), style: { display: 'none' } }), o.label)));
        input.querySelectorAll('label').forEach((l) => { const cb = l.querySelector('input'); const sync = () => l.classList.toggle('active', cb.checked); sync(); cb.addEventListener('change', sync); });
      } else input = h('input', { class: 'input', type: f.type || 'text', value: f.value ?? '', min: f.min, max: f.max, step: f.step, ...common });
      inputs[f.name] = input;
      const wrapper = f.type === 'checkbox'
        ? h('label', { class: `checkbox ${f.span === 2 ? 'span-2' : ''}` }, input, f.label)
        : h('label', { class: `field ${f.span === 2 || fields.length === 1 ? 'span-2' : ''}` }, f.label, f.hint ? h('span', { class: 'hint' }, f.hint) : null, input);
      grid.append(wrapper);
    }
    const form = h('form', { onSubmit: (e) => { e.preventDefault(); submit(); } }, grid, h('button', { type: 'submit', class: 'hidden' }));
    const values = () => {
      const out = {};
      for (const f of fields) {
        const input = inputs[f.name];
        if (f.type === 'checkbox') out[f.name] = input.checked;
        else if (f.type === 'multiselect') out[f.name] = [...input.selectedOptions].map((o) => o.value);
        else if (f.type === 'checkboxes') out[f.name] = [...input.querySelectorAll('input:checked')].map((i) => i.value);
        else if (f.type === 'number') out[f.name] = input.value === '' ? null : Number(input.value);
        else out[f.name] = input.value;
      }
      return out;
    };
    let modal;
    let done = false;
    const submit = async () => {
      try {
        const result = await onSubmit(values());
        done = true;
        resolve(result ?? true);
        modal.close();
      } catch (err) {
        showFormError(modal.body, err);
      }
    };
    modal = openModal({
      title, body: form, size, onClose: () => { if (!done) resolve(null); },
      actions: [...extraActions, { label: 'Cancelar' }, { label: submitLabel, primary: true, onClick: async () => { await submit(); return false; } }],
    });
  });
}

export function copyText(text) {
  return navigator.clipboard?.writeText(text).then(() => toast('Copiado para a área de transferência', { type: 'ok' })).catch(() => toast('Não foi possível copiar', { type: 'error' }));
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function downloadUrl(url) {
  const a = h('a', { href: url, download: '' });
  document.body.append(a);
  a.click();
  a.remove();
}

export function pluralize(n, singular, plural) { return `${n} ${n === 1 ? singular : plural}`; }

export function initials(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
}
