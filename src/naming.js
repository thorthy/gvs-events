// Naming helpers: slugs, safe file names, kinds and MIME types.
import path from 'node:path';

export const KINDS = {
  apresentacao: { label: 'Apresentação', exts: ['ppt', 'pptx', 'pps', 'ppsx', 'pptm', 'key', 'odp'] },
  pdf: { label: 'PDF', exts: ['pdf'] },
  video: { label: 'Vídeo', exts: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'mts', 'm2ts', 'wmv', 'mpg', 'mpeg', 'mxf'] },
  corte: { label: 'Corte', exts: [] },
  imagem: { label: 'Imagem', exts: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'tif', 'tiff', 'heic'] },
  audio: { label: 'Áudio', exts: ['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'wma'] },
  documento: { label: 'Documento', exts: ['doc', 'docx', 'txt', 'md', 'rtf', 'odt', 'xls', 'xlsx', 'csv', 'ods'] },
  outro: { label: 'Outro', exts: [] },
};
export const KIND_IDS = Object.keys(KINDS);

// Kinds that count as "main material" of a session for readiness purposes.
export const MAIN_KINDS = ['apresentacao', 'pdf', 'video'];

export const ASSET_STATUSES = ['recebido', 'em_revisao', 'aprovado', 'final', 'rejeitado', 'substituido'];
export const APPROVED_STATUSES = ['aprovado', 'final'];
export const SESSION_TYPES = ['palestra', 'painel', 'workshop', 'abertura', 'encerramento', 'intervalo', 'outro'];
export const EVENT_STATUSES = ['planejamento', 'em_andamento', 'concluido', 'arquivado'];
export const CLIP_STATUSES = ['planejado', 'renderizando', 'revisao', 'aprovado', 'publicado', 'erro'];
export const CLIP_FORMATS = ['original', 'vertical', 'quadrado'];
export const CLIP_MODES = ['rapido', 'preciso'];

const MIME = {
  html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8', svg: 'image/svg+xml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon',
  bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic',
  pdf: 'application/pdf', txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8', csv: 'text/csv; charset=utf-8',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', webm: 'video/webm', avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv', mpg: 'video/mpeg', mpeg: 'video/mpeg', mts: 'video/mp2t', m2ts: 'video/mp2t', mxf: 'application/mxf',
  mp3: 'audio/mpeg', wav: 'audio/wav', aac: 'audio/aac', m4a: 'audio/mp4', flac: 'audio/flac', ogg: 'audio/ogg', wma: 'audio/x-ms-wma',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pps: 'application/vnd.ms-powerpoint', ppsx: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  pptm: 'application/vnd.ms-powerpoint.presentation.macroEnabled.12', key: 'application/vnd.apple.keynote',
  odp: 'application/vnd.oasis.opendocument.presentation', odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', rtf: 'application/rtf',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip', woff2: 'font/woff2',
};

export function extOf(name) {
  const ext = path.extname(String(name || '')).slice(1).toLowerCase();
  return ext;
}

export function mimeOf(name) {
  return MIME[extOf(name)] || 'application/octet-stream';
}

export function kindFromName(name) {
  const ext = extOf(name);
  for (const [id, def] of Object.entries(KINDS)) {
    if (def.exts.includes(ext)) return id;
  }
  return 'outro';
}

export function isSupportedExt(name) {
  return kindFromName(name) !== 'outro';
}

export function stripDiacritics(str) {
  return String(str).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function slugify(str, { maxLength = 60 } = {}) {
  const slug = stripDiacritics(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug || 'item';
}

// Makes a file name safe for any file system while keeping it readable.
export function safeFileName(name, { maxLength = 140 } = {}) {
  const base = path.basename(String(name || 'arquivo')).replace(/[\\/:*?"<>|\x00-\x1f]/g, '');
  const ext = path.extname(base);
  let stem = base.slice(0, base.length - ext.length);
  stem = stripDiacritics(stem).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  if (!stem) stem = 'arquivo';
  const safeExt = stripDiacritics(ext).replace(/[^A-Za-z0-9.]/g, '').toLowerCase();
  const room = Math.max(10, maxLength - safeExt.length);
  return stem.slice(0, room) + safeExt;
}

// Short, readable component for operator folder names.
export function humanComponent(str, maxLength = 48) {
  const clean = stripDiacritics(String(str || ''))
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.slice(0, maxLength).trim();
}

export function normalizeForSearch(str) {
  return stripDiacritics(String(str || '')).toLowerCase().replace(/\s+/g, ' ').trim();
}

export function timeToMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(r).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}
