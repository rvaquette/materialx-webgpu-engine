import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeCompiledScene, encodeCompiledScene } from '../src/scene/compiled-scene-codec.ts';
import { shareSceneBuffers } from './shared-buffers.mjs';

async function writeScene(directory, value) {
  const scene = await encodeCompiledScene(value, 'scene.usda', { compressionLevel: 3 });
  await mkdir(directory, { recursive: true });
  for (const [path, bytes] of scene.files) await writeFile(join(directory, path), bytes);
  await writeFile(join(directory, 'scene.json'), JSON.stringify(scene.manifest));
}

/** Reads packed files the way the browser loader does: `location` first, then byte ranges. */
function reader(directory, manifest, ranges) {
  return async (path, range) => {
    const location = manifest.files.find(file => file.path === path)?.location ?? path;
    const bytes = new Uint8Array(await readFile(join(directory, location)));
    if (!range) return bytes;
    ranges.push(range);
    return bytes.slice(range.offset, range.offset + range.length);
  };
}

test('pools identical buffers once and decodes each scene from ranges of the shared pack', async context => {
  const root = await mkdtemp(join(tmpdir(), 'shared-buffers-test-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const geometry = Float32Array.from({ length: 200000 }, (_, i) => Math.sin(i));
  // Incompressible per-scene payloads larger than the range-coalescing gap.
  const noise = seed => Uint32Array.from({ length: 150000 }, (_, i) => Math.imul(i + seed, 2654435761) ^ (i * seed));
  const scenes = {
    a: { geometry, material: noise(1) },
    b: { geometry, material: noise(7) },
  };
  const shared = join(root, 'lama', '_shared');
  const statuses = [];
  for (const [name, value] of Object.entries(scenes)) {
    const directory = join(root, 'lama', 'group', name);
    await writeScene(directory, value);
    statuses.push(await shareSceneBuffers(directory, shared));
    assert.equal(existsSync(join(directory, 'buffers.bin.zst')), false);
    assert.equal(await shareSceneBuffers(directory, shared), 'already');
  }
  assert.deepEqual(statuses, ['shared', 'shared']);
  const index = JSON.parse(await readFile(join(shared, 'buffers.json'), 'utf8'));
  assert.equal(Object.keys(index.resources).length, 3);
  assert.equal((await stat(join(shared, 'buffers.bin.zst'))).size, index.byteLength);

  for (const [name, value] of Object.entries(scenes)) {
    const directory = join(root, 'lama', 'group', name);
    const manifest = JSON.parse(await readFile(join(directory, 'scene.json'), 'utf8'));
    assert.equal(manifest.files.find(file => file.path === 'buffers.bin.zst').location, '../../_shared/buffers.bin.zst');
    const ranges = [];
    assert.deepEqual(await decodeCompiledScene(manifest, reader(directory, manifest, ranges)), value);
    assert.ok(ranges.reduce((sum, range) => sum + range.length, 0) < index.byteLength, 'reads only its own payloads');
  }
});

test('reuses pooled payloads and truncates an interrupted append before writing', async context => {
  const root = await mkdtemp(join(tmpdir(), 'shared-buffers-test-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const shared = join(root, '_shared');
  const value = { geometry: Float32Array.from({ length: 1000 }, (_, i) => i) };
  await writeScene(join(root, 'a'), value);
  await writeScene(join(root, 'b'), value);
  assert.equal(await shareSceneBuffers(join(root, 'a'), shared), 'shared');
  const { byteLength } = JSON.parse(await readFile(join(shared, 'buffers.json'), 'utf8'));
  await appendFile(join(shared, 'buffers.bin.zst'), new Uint8Array(17));
  assert.equal(await shareSceneBuffers(join(root, 'b'), shared), 'reused');
  assert.equal((await stat(join(shared, 'buffers.bin.zst'))).size, byteLength);
  const manifest = JSON.parse(await readFile(join(root, 'b', 'scene.json'), 'utf8'));
  assert.deepEqual(await decodeCompiledScene(manifest, reader(join(root, 'b'), manifest, [])), value);
});
