import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ZipWriter, listZipEntryNames, crc32 } from '../src/zip.js';

const hasPython = (() => { try { execFileSync('python3', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

async function writeZip(dest, build, opts) {
  const out = fs.createWriteStream(dest);
  const zip = new ZipWriter(out, opts);
  await build(zip);
  await zip.finish();
  await new Promise((r) => out.end(r));
}

test('crc32 conhece o valor de "123456789"', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

for (const forceZip64 of [false, true]) {
  test(`zip ${forceZip64 ? 'zip64' : 'clássico'}: escreve e lê de volta`, async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'gvs-zip-'));
    const big = path.join(dir, 'grande.bin');
    await fsp.writeFile(big, Buffer.alloc(300000, 7));
    const dest = path.join(dir, 'saida.zip');
    await writeZip(dest, async (zip) => {
      await zip.addBuffer('pasta/olá mundo.txt', 'conteúdo com acento');
      await zip.addFile('pasta/grande.bin', big);
      await zip.addBuffer('pasta/olá mundo.txt', 'duplicado');
    }, { forceZip64 });
    const names = await listZipEntryNames(dest);
    assert.deepEqual(names, ['pasta/olá mundo.txt', 'pasta/grande.bin', 'pasta/olá mundo-2.txt']);
    if (hasPython) {
      const script = `
import zipfile, sys
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None, 'crc invalido'
print(z.read('pasta/olá mundo.txt').decode('utf-8'))
print(len(z.read('pasta/grande.bin')))
print(z.read('pasta/olá mundo-2.txt').decode('utf-8'))
`;
      const out = execFileSync('python3', ['-I', '-c', script, dest], { encoding: 'utf8' }).trim().split('\n');
      assert.deepEqual(out, ['conteúdo com acento', '300000', 'duplicado']);
    }
    await fsp.rm(dir, { recursive: true, force: true });
  });
}
