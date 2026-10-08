// JSON-file backed store with atomic, debounced writes.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export const CURRENT_VERSION = 1;

export function defaultSettings() {
  return {
    name: 'Minha biblioteca de eventos',
    autoConvertPdf: true,
    autoThumbnails: true,
    destinations: ['Instagram Reels', 'YouTube Shorts', 'TikTok', 'LinkedIn', 'YouTube', 'Site'],
    checklistTemplate: [
      'Apresentação recebida',
      'Testada no computador da sala',
      'Vídeos e áudios embutidos funcionam',
      'Fontes conferidas',
      'Formato 16:9 conferido',
      'Backup em PDF gerado',
    ],
  };
}

export function emptyLibrary() {
  return {
    version: CURRENT_VERSION,
    settings: defaultSettings(),
    events: [],
    rooms: [],
    speakers: [],
    sessions: [],
    assets: [],
    clips: [],
    activity: [],
  };
}

export function migrate(data) {
  const base = emptyLibrary();
  const out = { ...base, ...data };
  out.settings = { ...base.settings, ...(data.settings || {}) };
  for (const key of ['events', 'rooms', 'speakers', 'sessions', 'assets', 'clips', 'activity']) {
    if (!Array.isArray(out[key])) out[key] = [];
  }
  out.version = CURRENT_VERSION;
  return out;
}

export class Store {
  constructor(filePath, { debounceMs = 200 } = {}) {
    this.filePath = filePath;
    this.debounceMs = debounceMs;
    this.data = null;
    this._timer = null;
    this._writing = null;
    this._dirty = false;
  }

  load() {
    if (fs.existsSync(this.filePath)) {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        throw new Error(`Não foi possível ler ${this.filePath}: ${err.message}`);
      }
      this.data = migrate(parsed);
    } else {
      this.data = emptyLibrary();
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      this.flushSync();
    }
    return this.data;
  }

  markDirty() {
    this._dirty = true;
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this.flush().catch((err) => console.error('[store] erro ao salvar:', err));
    }, this.debounceMs);
    if (typeof this._timer.unref === 'function') this._timer.unref();
  }

  async flush() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (this._writing) await this._writing;
    if (!this._dirty) return;
    this._dirty = false;
    const json = JSON.stringify(this.data, null, 2);
    const tmp = `${this.filePath}.tmp`;
    this._writing = (async () => {
      await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
      await fsp.writeFile(tmp, json, 'utf8');
      await fsp.rename(tmp, this.filePath);
    })();
    try {
      await this._writing;
    } finally {
      this._writing = null;
    }
    if (this._dirty) await this.flush();
  }

  flushSync() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._dirty = false;
    const tmp = `${this.filePath}.tmp`;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }
}
