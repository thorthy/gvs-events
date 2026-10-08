// Streaming ZIP writer (store method, data descriptors, ZIP64 when needed)
// and a minimal central-directory reader (used to count PPTX slides).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { once } from 'node:events';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

export function crc32Update(crc, buf) {
  let c = crc ^ -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

export function crc32(buf) {
  return crc32Update(0, buf);
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_DESCRIPTOR = 0x08074b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const MAX32 = 0xffffffff;
const MAX16 = 0xffff;

function dosDateTime(date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  const year = Math.max(1980, d.getFullYear());
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time: time & 0xffff, date: day & 0xffff };
}

function writeU64(buf, offset, value) {
  buf.writeBigUInt64LE(BigInt(value), offset);
}

export class ZipWriter {
  constructor(out, { forceZip64 = false } = {}) {
    this.out = out;
    this.entries = [];
    this.offset = 0;
    this.forceZip64 = forceZip64;
    this.finished = false;
    this.names = new Set();
  }

  async _write(buf) {
    if (!this.out.write(buf)) await once(this.out, 'drain');
    this.offset += buf.length;
  }

  _uniqueName(name) {
    let candidate = name.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!this.names.has(candidate)) { this.names.add(candidate); return candidate; }
    const dot = candidate.lastIndexOf('.');
    const stem = dot > 0 ? candidate.slice(0, dot) : candidate;
    const ext = dot > 0 ? candidate.slice(dot) : '';
    let i = 2;
    while (this.names.has(`${stem}-${i}${ext}`)) i++;
    candidate = `${stem}-${i}${ext}`;
    this.names.add(candidate);
    return candidate;
  }

  async _beginEntry(name, size, mtime) {
    const entryName = this._uniqueName(name);
    const nameBuf = Buffer.from(entryName, 'utf8');
    const zip64 = this.forceZip64 || size >= MAX32 || this.offset >= MAX32;
    const { time, date } = dosDateTime(mtime);
    const extra = zip64 ? Buffer.alloc(20) : Buffer.alloc(0);
    if (zip64) {
      extra.writeUInt16LE(0x0001, 0);
      extra.writeUInt16LE(16, 2);
      writeU64(extra, 4, 0);
      writeU64(extra, 12, 0);
    }
    const header = Buffer.alloc(30);
    header.writeUInt32LE(SIG_LOCAL, 0);
    header.writeUInt16LE(zip64 ? 45 : 20, 4);
    header.writeUInt16LE((1 << 3) | (1 << 11), 6); // data descriptor + UTF-8 names
    header.writeUInt16LE(0, 8); // store
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(0, 14); // crc (in descriptor)
    header.writeUInt32LE(zip64 ? MAX32 : 0, 18);
    header.writeUInt32LE(zip64 ? MAX32 : 0, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(extra.length, 28);
    const entry = { name: nameBuf, offset: this.offset, size, crc: 0, zip64, time, date };
    await this._write(Buffer.concat([header, nameBuf, extra]));
    return entry;
  }

  async _endEntry(entry) {
    const desc = Buffer.alloc(entry.zip64 ? 24 : 16);
    desc.writeUInt32LE(SIG_DESCRIPTOR, 0);
    desc.writeUInt32LE(entry.crc >>> 0, 4);
    if (entry.zip64) {
      writeU64(desc, 8, entry.size);
      writeU64(desc, 16, entry.size);
    } else {
      desc.writeUInt32LE(entry.size, 8);
      desc.writeUInt32LE(entry.size, 12);
    }
    await this._write(desc);
    this.entries.push(entry);
  }

  async addBuffer(name, buffer, { mtime } = {}) {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const entry = await this._beginEntry(name, buf.length, mtime);
    entry.crc = crc32(buf);
    await this._write(buf);
    await this._endEntry(entry);
  }

  async addFile(name, filePath) {
    const stat = await fsp.stat(filePath);
    const entry = await this._beginEntry(name, stat.size, stat.mtime);
    let crc = 0;
    let written = 0;
    for await (const chunk of fs.createReadStream(filePath)) {
      crc = crc32Update(crc, chunk);
      written += chunk.length;
      await this._write(chunk);
    }
    if (written !== stat.size) throw new Error(`Arquivo mudou durante a leitura: ${filePath}`);
    entry.crc = crc;
    await this._endEntry(entry);
  }

  async finish() {
    if (this.finished) return;
    this.finished = true;
    const cdStart = this.offset;
    for (const e of this.entries) {
      const needZip64 = e.zip64 || e.size >= MAX32 || e.offset >= MAX32;
      const extraFields = [];
      if (needZip64) {
        extraFields.push(e.size, e.size, e.offset);
      }
      const extra = Buffer.alloc(needZip64 ? 4 + extraFields.length * 8 : 0);
      if (needZip64) {
        extra.writeUInt16LE(0x0001, 0);
        extra.writeUInt16LE(extraFields.length * 8, 2);
        extraFields.forEach((v, i) => writeU64(extra, 4 + i * 8, v));
      }
      const h = Buffer.alloc(46);
      h.writeUInt32LE(SIG_CENTRAL, 0);
      h.writeUInt16LE((3 << 8) | 45, 4); // made by: unix, 4.5
      h.writeUInt16LE(needZip64 ? 45 : 20, 6);
      h.writeUInt16LE((1 << 3) | (1 << 11), 8);
      h.writeUInt16LE(0, 10);
      h.writeUInt16LE(e.time, 12);
      h.writeUInt16LE(e.date, 14);
      h.writeUInt32LE(e.crc >>> 0, 16);
      h.writeUInt32LE(needZip64 ? MAX32 : e.size, 20);
      h.writeUInt32LE(needZip64 ? MAX32 : e.size, 24);
      h.writeUInt16LE(e.name.length, 28);
      h.writeUInt16LE(extra.length, 30);
      h.writeUInt16LE(0, 32);
      h.writeUInt16LE(0, 34);
      h.writeUInt16LE(0, 36);
      h.writeUInt32LE((0o100644 << 16) >>> 0, 38);
      h.writeUInt32LE(needZip64 ? MAX32 : e.offset, 42);
      await this._write(Buffer.concat([h, e.name, extra]));
    }
    const cdSize = this.offset - cdStart;
    const count = this.entries.length;
    const needZip64End = this.forceZip64 || count >= MAX16 || cdSize >= MAX32 || cdStart >= MAX32 || this.entries.some((e) => e.zip64);
    if (needZip64End) {
      const z = Buffer.alloc(56);
      z.writeUInt32LE(SIG_ZIP64_EOCD, 0);
      writeU64(z, 4, 44);
      z.writeUInt16LE((3 << 8) | 45, 12);
      z.writeUInt16LE(45, 14);
      z.writeUInt32LE(0, 16);
      z.writeUInt32LE(0, 20);
      writeU64(z, 24, count);
      writeU64(z, 32, count);
      writeU64(z, 40, cdSize);
      writeU64(z, 48, cdStart);
      const zipEocdOffset = this.offset;
      await this._write(z);
      const loc = Buffer.alloc(20);
      loc.writeUInt32LE(SIG_ZIP64_LOCATOR, 0);
      loc.writeUInt32LE(0, 4);
      writeU64(loc, 8, zipEocdOffset);
      loc.writeUInt32LE(1, 16);
      await this._write(loc);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(SIG_EOCD, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(Math.min(count, MAX16), 8);
    end.writeUInt16LE(Math.min(count, MAX16), 10);
    end.writeUInt32LE(Math.min(cdSize, MAX32), 12);
    end.writeUInt32LE(Math.min(cdStart, MAX32), 16);
    end.writeUInt16LE(0, 20);
    await this._write(end);
  }
}

// ---- Reader (central directory names only) ----

export async function listZipEntryNames(filePath) {
  const handle = await fsp.open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    const tailLen = Math.min(size, 65536 + 22);
    const tail = Buffer.alloc(tailLen);
    await handle.read(tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Arquivo ZIP inválido (EOCD não encontrado)');
    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    if (count === MAX16 || cdSize === MAX32 || cdOffset === MAX32) {
      const locPos = eocd - 20;
      if (locPos >= 0 && tail.readUInt32LE(locPos) === SIG_ZIP64_LOCATOR) {
        const z64Off = Number(tail.readBigUInt64LE(locPos + 8));
        const z = Buffer.alloc(56);
        await handle.read(z, 0, 56, z64Off);
        if (z.readUInt32LE(0) !== SIG_ZIP64_EOCD) throw new Error('ZIP64 inválido');
        count = Number(z.readBigUInt64LE(32));
        cdSize = Number(z.readBigUInt64LE(40));
        cdOffset = Number(z.readBigUInt64LE(48));
      }
    }
    const cd = Buffer.alloc(cdSize);
    await handle.read(cd, 0, cdSize, cdOffset);
    const names = [];
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.length; i++) {
      if (cd.readUInt32LE(p) !== SIG_CENTRAL) break;
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      names.push(cd.toString('utf8', p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;
    }
    return names;
  } finally {
    await handle.close();
  }
}
