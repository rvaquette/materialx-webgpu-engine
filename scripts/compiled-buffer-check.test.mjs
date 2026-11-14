import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { findEmptyCompiledBuffer } from './compiled-buffer-check.mjs';

async function fixture(context) {
  const root = await mkdtemp(join(tmpdir(), 'compiled-buffer-check-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const scene = join(root, 'scene');
  await mkdir(scene);
  return { root, scene };
}

async function manifest(directory, file) {
  await writeFile(join(directory, 'scene.json'), JSON.stringify({ files: [file] }));
}

test('identifies only unexpectedly empty local buffers', async context => {
  const { scene } = await fixture(context);
  const path = join(scene, 'buffers.bin.zst');
  await writeFile(path, '');
  await manifest(scene, { path: 'buffers.bin.zst', byteLength: 3 });
  assert.deepEqual(await findEmptyCompiledBuffer(scene, 'scene.json'), { path, shared: false });
  await manifest(scene, { path: 'buffers.bin.zst', byteLength: 0 });
  assert.equal(await findEmptyCompiledBuffer(scene, 'scene.json'), undefined);
  await manifest(scene, { path: 'buffers.bin.zst', byteLength: 3 });
  await writeFile(path, 'abc');
  assert.equal(await findEmptyCompiledBuffer(scene, 'scene.json'), undefined);
  await rm(path);
  assert.equal(await findEmptyCompiledBuffer(scene, 'scene.json'), undefined);
});

test('identifies an empty shared pack without treating it as a local buffer', async context => {
  const { root, scene } = await fixture(context);
  const shared = join(root, '_shared');
  await mkdir(shared);
  const path = join(shared, 'buffers.bin.zst');
  await writeFile(path, '');
  await manifest(scene, { path: 'buffers.bin.zst', byteLength: 3,
    location: `${relative(scene, shared).replaceAll('\\', '/')}/buffers.bin.zst` });
  assert.deepEqual(await findEmptyCompiledBuffer(scene, 'scene.json', shared), { path, shared: true });
  await assert.rejects(findEmptyCompiledBuffer(scene, 'scene.json', join(root, 'other')), /Unexpected shared buffer location/);
});

test('detects an empty legacy individual buffer', async context => {
  const { scene } = await fixture(context);
  await mkdir(join(scene, 'buffers'));
  const name = `${'a'.repeat(64)}.bin.zst`;
  const path = join(scene, 'buffers', name);
  await writeFile(path, '');
  await writeFile(join(scene, 'scene.json'), JSON.stringify({
    resources: [{ path: `buffers/${name}`, compressedByteLength: 3 }],
  }));
  assert.deepEqual(await findEmptyCompiledBuffer(scene, 'scene.json'), { path, shared: false });
});
