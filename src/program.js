// Parses a schedule pasted as text or CSV into session rows.
//
// Accepted line formats (separator "|", ";" or tab; CSV with header also works):
//   09:00-09:45 | Sala A | Título da palestra | Palestrante 1, Palestrante 2 | palestra
//   2026-03-10 | 09:00 | 09:45 | Sala A | Título | Palestrantes | tipo
//   # 2026-03-10            (sets the current date for the lines below)
//   ## Sala A               (sets the current room for the lines below)
import { SESSION_TYPES, timeToMinutes, normalizeForSearch } from './naming.js';

const TYPE_ALIASES = {
  palestra: 'palestra', talk: 'palestra', keynote: 'abertura', abertura: 'abertura', encerramento: 'encerramento',
  painel: 'painel', panel: 'painel', mesa: 'painel', 'mesa redonda': 'painel', workshop: 'workshop', oficina: 'workshop',
  intervalo: 'intervalo', coffee: 'intervalo', 'coffee break': 'intervalo', almoco: 'intervalo', almoço: 'intervalo', break: 'intervalo', pausa: 'intervalo',
  outro: 'outro',
};

function parseDate(v) {
  const s = String(v || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return s;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{1,2})\/(\d{1,2})$/.exec(s);
  if (m) return `${new Date().getFullYear()}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

function parseTime(v) {
  const s = String(v || '').trim().replace(/h/i, ':').replace(/^(\d{1,2})$/, '$1:00').replace(/^(\d{1,2}):$/, '$1:00');
  return timeToMinutes(s) === null ? null : s.padStart(5, '0');
}

function parseTimeRange(v) {
  const m = /^(\d{1,2}[:h]?\d{0,2})\s*(?:-|–|—|às|as|a|até)\s*(\d{1,2}[:h]?\d{0,2})$/i.exec(String(v || '').trim());
  if (!m) return null;
  const start = parseTime(m[1]);
  const end = parseTime(m[2]);
  return start && end ? { start, end } : null;
}

function guessType(v, title) {
  const key = normalizeForSearch(v);
  if (key && TYPE_ALIASES[key]) return TYPE_ALIASES[key];
  if (key && SESSION_TYPES.includes(key)) return key;
  const t = normalizeForSearch(title);
  if (/coffee|intervalo|almoco|pausa|break/.test(t)) return 'intervalo';
  if (/abertura|keynote/.test(t)) return 'abertura';
  if (/encerramento/.test(t)) return 'encerramento';
  if (/painel|mesa redonda/.test(t)) return 'painel';
  if (/workshop|oficina/.test(t)) return 'workshop';
  return 'palestra';
}

function splitLine(line) {
  const sep = line.includes('|') ? '|' : line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',';
  return line.split(sep).map((c) => c.trim());
}

const HEADER_KEYS = {
  data: 'date', date: 'date', dia: 'date',
  inicio: 'start', início: 'start', start: 'start', hora: 'start', horario: 'start', horário: 'start',
  fim: 'end', termino: 'end', término: 'end', end: 'end',
  sala: 'room', room: 'room', palco: 'room', local: 'room',
  titulo: 'title', título: 'title', title: 'title', tema: 'title', sessao: 'title', sessão: 'title',
  palestrante: 'speakers', palestrantes: 'speakers', speaker: 'speakers', speakers: 'speakers',
  tipo: 'type', type: 'type',
  descricao: 'description', descrição: 'description', description: 'description',
};

export function parseProgram(text, { defaultDate = '' } = {}) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const rows = [];
  const errors = [];
  let currentDate = defaultDate;
  let currentRoom = '';
  let header = null;
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) return;
    const lineNo = idx + 1;
    if (line.startsWith('##')) { currentRoom = line.replace(/^#+\s*/, '').trim(); return; }
    if (line.startsWith('#')) {
      const d = parseDate(line.replace(/^#+\s*/, '').replace(/^dia\s*/i, '').trim());
      if (d) currentDate = d; else errors.push({ line: lineNo, message: 'Data inválida após "#"' });
      return;
    }
    const cells = splitLine(line);
    if (header === null) {
      const mapped = cells.map((c) => HEADER_KEYS[normalizeForSearch(c)] || null);
      if (mapped.filter(Boolean).length >= 2 && mapped.includes('title')) { header = mapped; return; }
      header = false;
    }
    let row;
    if (header) {
      row = {};
      header.forEach((key, i) => { if (key) row[key] = cells[i] || ''; });
      row.speakers = row.speakers || '';
    } else {
      row = parsePositional(cells);
      if (!row) { errors.push({ line: lineNo, message: 'Formato não reconhecido' }); return; }
    }
    const date = row.date ? parseDate(row.date) : currentDate;
    if (row.date && !date) { errors.push({ line: lineNo, message: `Data inválida: ${row.date}` }); return; }
    let start = row.start ? parseTime(row.start) : '';
    let end = row.end ? parseTime(row.end) : '';
    if (row.start && !start) {
      const range = parseTimeRange(row.start);
      if (range) { start = range.start; end = end || range.end; } else { errors.push({ line: lineNo, message: `Horário inválido: ${row.start}` }); return; }
    }
    if (row.end && !end) { errors.push({ line: lineNo, message: `Horário inválido: ${row.end}` }); return; }
    const title = (row.title || '').trim();
    if (!title) { errors.push({ line: lineNo, message: 'Título ausente' }); return; }
    rows.push({
      line: lineNo,
      date: date || '',
      start: start || '',
      end: end || '',
      room: (row.room || currentRoom || '').trim(),
      title,
      speakers: String(row.speakers || '').split(/[,;]|\s+e\s+|\s*&\s*/).map((s) => s.trim()).filter(Boolean),
      type: guessType(row.type, title),
      description: (row.description || '').trim(),
    });
  });
  return { rows, errors };
}

// Positional: [time or range] [room?] title [speakers?] [type?]
function parsePositional(cells) {
  if (!cells.length) return null;
  const row = { speakers: '' };
  let i = 0;
  const maybeDate = parseDate(cells[0]);
  if (maybeDate && cells.length > 1) { row.date = cells[0]; i++; }
  const range = parseTimeRange(cells[i]);
  if (range) { row.start = range.start; row.end = range.end; i++; }
  else if (parseTime(cells[i]) && cells.length > i + 1) {
    row.start = cells[i];
    i++;
    if (parseTime(cells[i]) && cells.length > i + 1) { row.end = cells[i]; i++; }
  }
  const rest = cells.slice(i);
  if (!rest.length) return null;
  // Remaining columns: room | title | speakers | type   OR   title | speakers | type   OR   title
  if (rest.length >= 2 && !parseTimeRange(rest[0]) && rest[0].length <= 40 && /^(sala|palco|audit|plen|room|stage|arena|tenda|track|trilha)/i.test(normalizeForSearch(rest[0]))) {
    row.room = rest.shift();
  }
  row.title = rest.shift() || '';
  if (rest.length) {
    const last = rest[rest.length - 1];
    if (TYPE_ALIASES[normalizeForSearch(last)]) { row.type = rest.pop(); }
  }
  if (rest.length) row.speakers = rest.shift();
  if (rest.length) row.description = rest.join(' | ');
  return row;
}
