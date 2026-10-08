#!/usr/bin/env node
// Command line entry point.
import path from 'node:path';
import { createApp } from '../src/server.js';
import { lanAddresses } from '../src/api.js';
import { exportOperatorFolder } from '../src/exporter.js';
import { scanFolder, suggestSession } from '../src/scan.js';
import { createBackup } from '../src/backup.js';
import { formatBytes } from '../src/naming.js';
import { readFileSync } from 'node:fs';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith('--')) || 'serve';
const flags = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (!a.startsWith('--')) continue;
  const [key, inline] = a.slice(2).split('=');
  if (inline !== undefined) flags[key] = inline;
  else if (args[i + 1] && !args[i + 1].startsWith('--')) flags[key] = args[++i];
  else flags[key] = true;
}
const positional = args.filter((a) => !a.startsWith('--') && a !== command && !Object.values(flags).includes(a));

const libraryDir = flags.library || process.env.GVS_LIBRARY || 'biblioteca';
const token = flags.token || process.env.GVS_TOKEN || '';

function usage() {
  console.log(`gvs-events — organizador de materiais para eventos

Uso:
  gvs-events serve [--port 3210] [--host 0.0.0.0] [--library ./biblioteca] [--token SENHA]
  gvs-events list                               lista os eventos da biblioteca
  gvs-events scan <evento> <pasta> [--mover]    importa arquivos de uma pasta para o evento
  gvs-events export <evento> [--dest PASTA] [--todos] [--link]
                                                gera a pasta do operador
  gvs-events backup                             cria uma cópia de segurança da biblioteca

<evento> pode ser o id ou o slug do evento. Variáveis: GVS_PORT, GVS_HOST, GVS_LIBRARY, GVS_TOKEN.`);
}

async function withApp(fn) {
  const app = await createApp({ libraryDir, token, quiet: true });
  try {
    return await fn(app);
  } finally {
    await app.jobs.idle();
    await app.store.flush();
  }
}

function findEvent(app, ref) {
  const e = app.store.data.events.find((x) => x.id === ref || x.slug === ref);
  if (!e) {
    console.error(`Evento não encontrado: ${ref}`);
    process.exit(1);
  }
  return e;
}

const commands = {
  async serve() {
    const app = await createApp({ libraryDir, token });
    const port = Number(flags.port || process.env.GVS_PORT || 3210);
    const host = flags.host || process.env.GVS_HOST || '0.0.0.0';
    await app.start({ port, host });
    const tools = app.media.status();
    console.log(`\n  GVS Events v${VERSION}`);
    console.log(`  Biblioteca: ${app.root}`);
    console.log(`  Local:      http://localhost:${port}`);
    for (const a of lanAddresses()) console.log(`  Rede:       http://${a.address}:${port}  (${a.name})`);
    console.log(`  Ferramentas: ffmpeg ${tools.ffmpeg ? '✓' : '✗'} · ffprobe ${tools.ffprobe ? '✓' : '✗'} · LibreOffice ${tools.libreoffice ? '✓' : '✗'} · poppler ${tools.pdftoppm ? '✓' : '✗'}`);
    if (token) console.log('  Acesso protegido por token.');
    console.log('\n  Ctrl+C para encerrar.\n');
    const shutdown = async () => {
      console.log('\nEncerrando...');
      try { app.store.flushSync(); } catch (err) { console.error(err); }
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  },

  async list() {
    await withApp((app) => {
      const events = app.library.listEvents();
      if (!events.length) { console.log('Nenhum evento cadastrado.'); return; }
      for (const e of events) {
        console.log(`${e.slug.padEnd(40)} ${e.startDate || '----------'}  ${String(e.stats.sessions).padStart(3)} sessões  ${String(e.stats.assets).padStart(4)} materiais  ${String(e.stats.readyPercent).padStart(3)}% prontas  ${e.name}`);
      }
    });
  },

  async scan() {
    const [ref, folder] = positional;
    if (!ref || !folder) { usage(); process.exit(1); }
    await withApp(async (app) => {
      const event = findEvent(app, ref);
      const bundle = app.library.eventBundle(event.id);
      const { files } = await scanFolder(folder);
      console.log(`${files.length} arquivo(s) encontrados em ${folder}`);
      let n = 0;
      for (const f of files) {
        const suggestion = suggestSession(f.relative, bundle.sessions, bundle.speakers);
        const asset = await app.library.addAsset({ eventId: event.id, tmpPath: f.path, originalName: f.name, sessionId: suggestion?.sessionId || null, source: 'importacao', user: 'cli', move: Boolean(flags.mover) });
        n++;
        console.log(`  + ${f.relative} (${formatBytes(asset.size)})${suggestion ? ` → ${suggestion.title}` : ''}`);
      }
      console.log(`${n} arquivo(s) importados. Analisando metadados...`);
    });
  },

  async export() {
    const [ref] = positional;
    if (!ref) { usage(); process.exit(1); }
    await withApp(async (app) => {
      const event = findEvent(app, ref);
      const result = await exportOperatorFolder(app.library, event.id, { dest: flags.dest ? path.resolve(flags.dest) : undefined, include: flags.todos ? 'todos' : 'aprovados', mode: flags.link ? 'link' : 'copiar' });
      console.log(`Pasta do operador gerada em ${result.dest} (${result.files} arquivos, ${formatBytes(result.bytes)})`);
    });
  },

  async backup() {
    await withApp(async (app) => {
      const b = await createBackup(app.store, app.storage);
      console.log(`Backup criado: ${b.file}`);
    });
  },

  help() { usage(); },
};

const fn = commands[command];
if (!fn) { usage(); process.exit(1); }
fn().catch((err) => { console.error(err.message || err); process.exit(1); });
