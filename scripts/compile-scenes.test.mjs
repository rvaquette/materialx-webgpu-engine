import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const scripts = dirname(fileURLToPath(import.meta.url));

async function fixture(context) {
  const root = await mkdtemp(join(tmpdir(), 'compile-scenes-test-'));
  context.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  await mkdir(join(root, 'scripts'));
  await mkdir(join(root, 'src', 'scene'), { recursive: true });
  for (const name of ['compile-scenes.mjs', 'compiled-buffer-check.mjs', 'rename-with-retry.mjs']) {
    await copyFile(join(scripts, name), join(root, 'scripts', name));
  }
  await copyFile(join(scripts, '..', 'src', 'scene', 'compiled-paths.ts'), join(root, 'src', 'scene', 'compiled-paths.ts'));
  await writeFile(join(root, 'scripts', 'shared-buffers.mjs'),
    `export async function shareSceneBuffers() { throw new Error('unexpected pooling'); }
export async function sharedPackSize() { return 0; }\n`);
  await writeFile(join(root, 'scripts', 'export-browser-session.mjs'), `
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function openExportSession() {
  return {
    alive: true, url: path => path,
    async call(name) {
      if (name === 'listSources') return { scenes: ['scenes/test.usda'], materials: ['scenes/mtlx-library/test.mtlx'] };
      return { files: [] };
    },
    async writePackage(result, out, manifest, generatedFrom) {
      await mkdir(out, { recursive: true });
      await writeFile(join(out, 'buffers.bin.zst'), 'ok');
      await writeFile(join(out, manifest), JSON.stringify({ generatedFrom, files: [{ path: 'buffers.bin.zst', byteLength: 2 }] }));
    },
    async close() {},
  };
}\n`);
  await mkdir(join(root, 'scenes', 'mtlx-library'), { recursive: true });
  await writeFile(join(root, 'scenes', 'mtlx-library', 'test.mtlx'), '<surfacematerial name="test"/>');
  return root;
}

async function writeCompiled(directory, manifestName, expectedSize) {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'buffers.bin.zst'), '');
  await writeFile(join(directory, manifestName), JSON.stringify({
    files: [{ path: 'buffers.bin.zst', byteLength: expectedSize }],
  }));
}

test('recompiles an unexpectedly empty material buffer, then skips the repaired material', async context => {
  const root = await fixture(context);
  const directory = join(root, 'scenes', 'compiled', 'mtlx-library', 'test');
  await writeCompiled(directory, 'material.json', 2);
  const script = join(root, 'scripts', 'compile-scenes.mjs');
  const args = ['--materials-only'];
  const dryRun = await exec(process.execPath, [script, ...args, '--dry-run']);
  assert.match(dryRun.stdout, /would compile \[material 1\/1\]/);
  const compiled = await exec(process.execPath, [script, ...args]);
  assert.match(compiled.stdout, /Compiled 0 scenes and 1 materials/);
  assert.equal(await readFile(join(directory, 'buffers.bin.zst'), 'utf8'), 'ok');
  const rerun = await exec(process.execPath, [script, ...args]);
  assert.match(rerun.stdout, /1 already compiled/);
});

test('keeps expected empty scene buffers and reports empty shared packs', async context => {
  const root = await fixture(context);
  const directory = join(root, 'scenes', 'compiled', 'test');
  await writeCompiled(directory, 'scene.json', 0);
  const script = join(root, 'scripts', 'compile-scenes.mjs');
  const expectedEmpty = await exec(process.execPath, [script, '--scenes-only', '--dry-run']);
  assert.match(expectedEmpty.stdout, /1 already compiled/);
  await writeCompiled(directory, 'scene.json', 2);
  const compiled = await exec(process.execPath, [script, '--scenes-only']);
  assert.match(compiled.stdout, /Compiled 1 scenes and 0 materials/);
  assert.equal(await readFile(join(directory, 'buffers.bin.zst'), 'utf8'), 'ok');

  const shared = join(root, 'scenes', 'compiled', 'lama', '_shared');
  const lama = join(root, 'scenes', 'compiled', 'lama', 'test');
  await mkdir(shared, { recursive: true });
  await mkdir(lama, { recursive: true });
  await writeFile(join(shared, 'buffers.bin.zst'), '');
  const location = `${relative(lama, shared).replaceAll('\\', '/')}/buffers.bin.zst`;
  await writeFile(join(lama, 'scene.json'), JSON.stringify({ files: [{ path: 'buffers.bin.zst', byteLength: 2, location }] }));
  const session = join(root, 'scripts', 'export-browser-session.mjs');
  await writeFile(session, (await readFile(session, 'utf8')).replace('scenes/test.usda', 'scenes/lama/test.usda'));
  await assert.rejects(exec(process.execPath, [script, '--scenes-only', '--dry-run']), error =>
    error.code === 1 && /Shared buffer is empty/.test(error.stderr));
});
