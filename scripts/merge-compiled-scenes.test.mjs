import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeCompiledScene, groupedManifest } from './merge-compiled-scenes.mjs';

async function fixture(testContext) {
  const directory = await mkdtemp(join(tmpdir(), 'merge-compiled-test-'));
  testContext.after(() => rm(directory, { recursive: true, force: true }));
  const resources = [
    ['buffers', 'a', 'bin', Buffer.from([1, 2, 3])],
    ['shaders', 'b', 'wgsl', Buffer.from([4, 5])],
    ['buffers', 'c', 'bin', Buffer.from([6, 7, 8, 9])],
    ['metadata', 'd', 'json', Buffer.from([10, 11])],
  ];
  const manifest = { format: 'materialx-compiled-scene', version: '1.0', engineAbi: 1,
    compression: 'zstd', byteOrder: 'little-endian', generatedFrom: 'scene.usda',
    state: `metadata/${'d'.repeat(64)}.json.zst`, resources: [] };
  for (const [group, hash, extension, bytes] of resources) {
    await mkdir(join(directory, group), { recursive: true });
    const path = `${group}/${hash.repeat(64)}.${extension}.zst`;
    await writeFile(join(directory, path), bytes);
    manifest.resources.push({ path, sha256: hash.repeat(64), byteLength: 100, compressedByteLength: bytes.length });
  }
  const path = join(directory, 'scene.json');
  const original = JSON.stringify(manifest);
  await writeFile(path, original);
  return { directory, path, original, manifest };
}

test('copies exact blocks with offsets, preserves originals and skips v2 on rerun', async context => {
  const { directory, path, original, manifest } = await fixture(context);
  assert.equal(await mergeCompiledScene(path), 'converted');
  const grouped = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(grouped.version, '2.0');
  assert.deepEqual(await readFile(join(directory, 'buffers.bin.zst')), Buffer.from([1, 2, 3, 6, 7, 8, 9]));
  assert.equal(grouped.resources[2].offset, 3);
  assert.equal(await readFile(join(directory, 'scene.v1.json'), 'utf8'), original);
  for (const resource of manifest.resources) {
    const indexed = grouped.resources.find(item => item.path === resource.path);
    const bundle = await readFile(join(directory, indexed.file));
    assert.deepEqual(bundle.subarray(indexed.offset, indexed.offset + indexed.compressedByteLength), await readFile(join(directory, resource.path)));
    assert.equal(indexed.sha256, resource.sha256);
  }
  assert.equal(await mergeCompiledScene(path), 'skipped');
});

test('dry-run checks resources without modifying files', async context => {
  const { directory, path, original } = await fixture(context);
  const before = await readdir(directory);
  assert.equal(await mergeCompiledScene(path, { dryRun: true }), 'planned');
  assert.deepEqual(await readdir(directory), before);
  assert.equal(await readFile(path, 'utf8'), original);
});

test('missing resources and destination conflicts leave v1 untouched', async context => {
  const { directory, path, original, manifest } = await fixture(context);
  await writeFile(join(directory, 'buffers.bin.zst'), 'existing');
  await assert.rejects(mergeCompiledScene(path), /Destination already exists/);
  await rm(join(directory, 'buffers.bin.zst'));
  await rm(join(directory, manifest.resources[0].path));
  await assert.rejects(mergeCompiledScene(path), /ENOENT/);
  assert.equal(await readFile(path, 'utf8'), original);
  assert.deepEqual((await readdir(directory)).filter(name => name.endsWith('.zst') || name.startsWith('.merge-')), []);
});

test('explicit cleanup deletes indexed blocks only and retains the backup', async context => {
  const { directory, path } = await fixture(context);
  await writeFile(join(directory, 'buffers', 'unrelated.bin'), 'keep');
  assert.equal(await mergeCompiledScene(path, { removeOriginals: true }), 'converted');
  assert.deepEqual(await readdir(join(directory, 'buffers')), ['unrelated.bin']);
  assert.equal(await readFile(join(directory, 'buffers', 'unrelated.bin'), 'utf8'), 'keep');
  assert.ok((await readdir(directory)).includes('scene.v1.json'));
  assert.ok(!(await readdir(directory)).includes('shaders'));
});

test('cleanup can run after conversion and refuses an unmatched backup', async context => {
  const { directory, path, original, manifest } = await fixture(context);
  await mergeCompiledScene(path);
  const backup = join(directory, 'scene.v1.json');
  const changed = structuredClone(manifest);
  changed.generatedFrom = 'different.usda';
  await writeFile(backup, JSON.stringify(changed));
  await assert.rejects(mergeCompiledScene(path, { removeOriginals: true }), /backup does not match/);
  assert.deepEqual(await readFile(join(directory, manifest.resources[0].path)), Buffer.from([1, 2, 3]));
  await writeFile(backup, original);
  assert.equal(await mergeCompiledScene(path, { removeOriginals: true }), 'cleaned');
  assert.ok(!(await readdir(directory)).includes('buffers'));
  assert.equal(await readFile(backup, 'utf8'), original);
});

test('rejects traversal, duplicate resources, textures and invalid limits', async context => {
  const { manifest } = await fixture(context);
  for (const mutation of [
    value => { value.resources[0].path = '../outside.bin.zst'; },
    value => { value.resources.push(value.resources[0]); },
    value => { value.resources[0].path = value.resources[0].path.replace('buffers/', 'textures/'); },
    value => { value.resources[0].byteLength = 2 ** 40; },
    value => { value.state = 'missing'; },
  ]) {
    const modified = structuredClone(manifest);
    mutation(modified);
    assert.throws(() => groupedManifest(modified));
  }
});