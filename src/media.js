// Media helpers backed by external tools (ffmpeg/ffprobe, LibreOffice, poppler).
// Every function degrades gracefully when the tool is missing.
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { listZipEntryNames } from './zip.js';
import { extOf } from './naming.js';

const SOFFICE_CANDIDATES = process.platform === 'win32'
  ? ['soffice', 'C:\\Program Files\\LibreOffice\\program\\soffice.exe', 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe']
  : process.platform === 'darwin'
    ? ['soffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice']
    : ['soffice', 'libreoffice'];

function run(cmd, args, { timeoutMs = 10 * 60 * 1000, onStdout, onStderr, cwd } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd, windowsHide: true });
    } catch (err) {
      reject(err);
      return;
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${cmd} excedeu o tempo limite`)); }, timeoutMs);
    child.stdout.on('data', (d) => { const s = d.toString(); stdout += s.length < 200000 ? s : ''; onStdout?.(s); });
    child.stderr.on('data', (d) => { const s = d.toString(); if (stderr.length < 200000) stderr += s; onStderr?.(s); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function canRun(cmd, args = ['-version']) {
  try {
    const r = await run(cmd, args, { timeoutMs: 20000 });
    return r.code === 0 || r.stdout.length > 0 || r.stderr.length > 0;
  } catch {
    return false;
  }
}

export class Media {
  constructor() {
    this.tools = { ffmpeg: false, ffprobe: false, soffice: null, pdftoppm: false, pdfinfo: false };
    this.ready = this.detect();
  }

  async detect() {
    const [ffmpeg, ffprobe, pdftoppm, pdfinfo] = await Promise.all([
      canRun('ffmpeg'), canRun('ffprobe'), canRun('pdftoppm', ['-v']), canRun('pdfinfo', ['-v']),
    ]);
    let soffice = null;
    for (const candidate of SOFFICE_CANDIDATES) {
      if (await canRun(candidate, ['--version'])) { soffice = candidate; break; }
    }
    this.tools = { ffmpeg, ffprobe, soffice, pdftoppm, pdfinfo };
    return this.tools;
  }

  status() {
    return {
      ffmpeg: this.tools.ffmpeg,
      ffprobe: this.tools.ffprobe,
      libreoffice: Boolean(this.tools.soffice),
      pdftoppm: this.tools.pdftoppm,
      pdfinfo: this.tools.pdfinfo,
    };
  }

  async probe(filePath) {
    await this.ready;
    if (!this.tools.ffprobe) return null;
    const r = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath], { timeoutMs: 60000 });
    if (r.code !== 0) return null;
    let info;
    try { info = JSON.parse(r.stdout); } catch { return null; }
    const video = (info.streams || []).find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
    const audio = (info.streams || []).find((s) => s.codec_type === 'audio');
    const meta = {};
    const duration = Number(info.format?.duration || video?.duration || audio?.duration);
    if (Number.isFinite(duration) && duration > 0) meta.duration = Math.round(duration * 100) / 100;
    if (info.format?.bit_rate) meta.bitrate = Number(info.format.bit_rate);
    if (video) {
      meta.width = video.width;
      meta.height = video.height;
      meta.videoCodec = video.codec_name;
      const fr = String(video.r_frame_rate || video.avg_frame_rate || '');
      const [num, den] = fr.split('/').map(Number);
      if (num && den) meta.fps = Math.round((num / den) * 100) / 100;
    }
    if (audio) {
      meta.audioCodec = audio.codec_name;
      meta.audioChannels = audio.channels;
      meta.sampleRate = Number(audio.sample_rate) || undefined;
    }
    return meta;
  }

  async videoThumbnail(src, dest, { at = 2, width = 480 } = {}) {
    await this.ready;
    if (!this.tools.ffmpeg) return false;
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    let r = await run('ffmpeg', ['-y', '-v', 'error', '-ss', String(at), '-i', src, '-frames:v', '1', '-vf', `scale=${width}:-2`, dest], { timeoutMs: 120000 });
    if (r.code !== 0 || !fs.existsSync(dest)) {
      r = await run('ffmpeg', ['-y', '-v', 'error', '-i', src, '-frames:v', '1', '-vf', `scale=${width}:-2`, dest], { timeoutMs: 120000 });
    }
    return r.code === 0 && fs.existsSync(dest);
  }

  async imageThumbnail(src, dest, { width = 480 } = {}) {
    await this.ready;
    if (!this.tools.ffmpeg) return false;
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const r = await run('ffmpeg', ['-y', '-v', 'error', '-i', src, '-frames:v', '1', '-vf', `scale='min(${width},iw)':-2`, dest], { timeoutMs: 60000 });
    return r.code === 0 && fs.existsSync(dest);
  }

  async pdfThumbnail(src, dest, { width = 480 } = {}) {
    await this.ready;
    if (!this.tools.pdftoppm) return false;
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const prefix = dest.replace(/\.jpe?g$/i, '');
    const r = await run('pdftoppm', ['-jpeg', '-f', '1', '-l', '1', '-singlefile', '-scale-to', String(width), src, prefix], { timeoutMs: 60000 });
    const produced = `${prefix}.jpg`;
    if (r.code === 0 && fs.existsSync(produced)) {
      if (produced !== dest) await fsp.rename(produced, dest);
      return true;
    }
    return false;
  }

  async pdfPages(src) {
    await this.ready;
    if (this.tools.pdfinfo) {
      const r = await run('pdfinfo', [src], { timeoutMs: 60000 });
      const m = /^Pages:\s+(\d+)/m.exec(r.stdout);
      if (m) return Number(m[1]);
    }
    // Fallback: count page objects in the raw file (good enough for most PDFs).
    try {
      const stat = await fsp.stat(src);
      if (stat.size > 200 * 1024 * 1024) return null;
      const raw = await fsp.readFile(src, 'latin1');
      const matches = raw.match(/\/Type\s*\/Page(?!s)/g);
      return matches ? matches.length : null;
    } catch {
      return null;
    }
  }

  async presentationSlides(src) {
    const ext = extOf(src);
    if (!['pptx', 'ppsx', 'pptm'].includes(ext)) return null;
    try {
      const names = await listZipEntryNames(src);
      return names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length;
    } catch {
      return null;
    }
  }

  // Converts an office document to PDF with LibreOffice. Returns the output path.
  async convertToPdf(src, outDir) {
    await this.ready;
    if (!this.tools.soffice) throw new Error('LibreOffice não encontrado para converter em PDF');
    await fsp.mkdir(outDir, { recursive: true });
    const profile = path.join(os.tmpdir(), `gvs-soffice-${process.pid}`);
    const r = await run(this.tools.soffice, [
      '--headless', '--norestore', '--nologo', `-env:UserInstallation=file://${profile.replace(/\\/g, '/')}`,
      '--convert-to', 'pdf', '--outdir', outDir, src,
    ], { timeoutMs: 15 * 60 * 1000 });
    const expected = path.join(outDir, `${path.basename(src, path.extname(src))}.pdf`);
    if (!fs.existsSync(expected)) {
      throw new Error(`Conversão falhou: ${(r.stderr || r.stdout || '').trim().slice(0, 300) || 'sem saída do LibreOffice'}`);
    }
    return expected;
  }

  // Builds a web-friendly proxy (H.264/AAC MP4) for previewing in the browser.
  async makeProxy(src, dest, { height = 720, duration, onProgress } = {}) {
    await this.ready;
    if (!this.tools.ffmpeg) throw new Error('ffmpeg não encontrado');
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const args = [
      '-y', '-v', 'error', '-nostats', '-progress', 'pipe:1', '-i', src,
      '-vf', `scale=-2:'min(${height},ih)'`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-movflags', '+faststart', dest,
    ];
    const r = await run('ffmpeg', args, { timeoutMs: 6 * 60 * 60 * 1000, onStdout: progressParser(duration, onProgress) });
    if (r.code !== 0 || !fs.existsSync(dest)) throw new Error(`ffmpeg falhou: ${r.stderr.trim().slice(0, 400)}`);
    return dest;
  }

  async renderClip(src, dest, { start, end, mode = 'preciso', format = 'original', onProgress } = {}) {
    await this.ready;
    if (!this.tools.ffmpeg) throw new Error('ffmpeg não encontrado para renderizar o corte');
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const duration = Math.max(0.1, end - start);
    const needsEncode = mode === 'preciso' || format !== 'original';
    const args = ['-y', '-v', 'error', '-nostats', '-progress', 'pipe:1', '-ss', String(start), '-i', src, '-t', String(duration)];
    if (needsEncode) {
      const filters = [];
      if (format === 'vertical') filters.push("crop='trunc(min(iw,ih*9/16)/2)*2':ih", 'scale=1080:1920');
      if (format === 'quadrado') filters.push("crop='trunc(min(iw,ih)/2)*2':'trunc(min(iw,ih)/2)*2'", 'scale=1080:1080');
      if (filters.length) args.push('-vf', filters.join(','));
      args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k');
    } else {
      args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero');
    }
    args.push('-movflags', '+faststart', dest);
    const r = await run('ffmpeg', args, { timeoutMs: 6 * 60 * 60 * 1000, onStdout: progressParser(duration, onProgress) });
    if (r.code !== 0 || !fs.existsSync(dest)) throw new Error(`ffmpeg falhou: ${r.stderr.trim().slice(0, 400)}`);
    return dest;
  }
}

function progressParser(duration, onProgress) {
  if (!onProgress || !duration) return undefined;
  let buffer = '';
  return (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const m = /^out_time_(?:ms|us)=(\d+)/.exec(line.trim());
      if (m) onProgress(Math.min(1, Number(m[1]) / 1e6 / duration));
    }
  };
}
