import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packedFiles = { buffers: 'buffers.bin.zst', shaders: 'shaders.wgsl.zst', metadata: 'metadata.json.zst' };
const maximumResource = 512 * 1024 * 1024;
const maximumTotal = 2 * 1024 * 1024 * 1024;
const maximumState = 64 * 1024 * 1024;
const isSize = (value, maximum) => Number.isSafeInteger(value) && value >= 0 && value <= maximum;

export function groupedManifest(manifest) {
  if (manifest?.format !== 'materialx-compiled-scene' || manifest.version !== '1.0' ||
      manifest.engineAbi !== 1 || manifest.compression !== 'zstd' || manifest.byteOrder !== 'little-endian' ||
      typeof manifest.generatedFrom !== 'string' || typeof manifest.state !== 'string' ||
      !Array.isArray(manifest.resources) || manifest.resources.length > 100000) {
    throw new Error('Expected a v1 compiled scene manifest (ABI 1, Zstandard).');
  }
  const lengths = new Map(Object.values(packedFiles).map(path => [path, 0]));
  const paths = new Set();
  let total = 0;
  const resources = manifest.resources.map(resource => {
    const match = typeof resource?.path === 'string'
      ? /^(buffers|shaders|metadata)\/([a-f0-9]{64})\.(bin|wgsl|json)\.zst$/.exec(resource.path) : null;
    if (!match || match[2] !== resource.sha256 || paths.has(resource.path) ||
        !isSize(resource.byteLength, maximumResource) ||
        !isSize(resource.compressedByteLength, maximumResource + 1024 * 1024)) {
      throw new Error(`Invalid or unsupported v1 resource: ${resource?.path}`);
    }
    paths.add(resource.path);
    total += resource.byteLength;
    const file = packedFiles[match[1]];
    const offset = lengths.get(file);
    lengths.set(file, offset + resource.compressedByteLength);
    return { ...resource, file, offset };
  });
  const state = resources.find(resource => resource.path === manifest.state);
  if (total > maximumTotal || !state || state.file !== packedFiles.metadata || state.byteLength > maximumState) {
    throw new Error('Invalid v1 metadata reference or uncompressed size limit.');
  }
  return { ...manifest, version: '2.0', resources, files: [...lengths].map(([path, byteLength]) => ({ path, byteLength })) };
}

async function absent(path) {
  try { await lstat(path); return false; }
  catch (error) { if (error.code === 'ENOENT') return true; throw error; }
}

async function removeOriginalBlocks(directory, manifest) {
  for (const group of Object.keys(packedFiles)) {
    try {
      const info = await lstat(join(directory, group));
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Unsafe original resource directory: ${group}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  for (const resource of manifest.resources) await rm(join(directory, ...resource.path.split('/')), { force: true });
  for (const group of Object.keys(packedFiles)) {
    try { await rmdir(join(directory, group)); }
    catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; }
  }
}

export async function mergeCompiledScene(manifestPath, { dryRun = false, removeOriginals = false } = {}) {
  const directory = dirname(resolve(manifestPath));
  const original = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(original);
  const backup = join(directory, 'scene.v1.json');
  if (manifest.version === '2.0' && manifest.format === 'materialx-compiled-scene') {
    if (!removeOriginals || await absent(backup)) return 'skipped';
    const previous = JSON.parse(await readFile(backup, 'utf8'));
    const expected = groupedManifest(previous);
    if (JSON.stringify(expected) !== JSON.stringify(manifest)) throw new Error('The v1 backup does not match the current v2 manifest.');
    for (const file of expected.files) {
      const info = await lstat(join(directory, file.path));
      if (!info.isFile() || info.isSymbolicLink() || info.size !== file.byteLength) throw new Error(`Missing or truncated packed file: ${file.path}`);
    }
    if (dryRun) return 'planned';
    await removeOriginalBlocks(directory, previous);
    return 'cleaned';
  }
  const grouped = groupedManifest(manifest);
  for (const file of [...grouped.files.map(file => file.path), 'scene.v1.json']) {
    if (!await absent(join(directory, file))) throw new Error(`Destination already exists: ${join(directory, file)}`);
  }
  for (const resource of manifest.resources) {
    const path = join(directory, ...resource.path.split('/'));
    const groupInfo = await lstat(dirname(path));
    const info = await lstat(path);
    if (!groupInfo.isDirectory() || groupInfo.isSymbolicLink() || !info.isFile() || info.isSymbolicLink() ||
        info.size !== resource.compressedByteLength) throw new Error(`Missing, unsafe or truncated resource: ${path}`);
  }
  if (dryRun) return 'planned';
  const staging = join(directory, `.merge-${randomUUID()}`);
  const published = [];
  let committed = false;
  let backupCreated = false;
  await mkdir(staging);
  try {
    for (const file of grouped.files) {
      const target = join(staging, file.path);
      await writeFile(target, new Uint8Array(), { flag: 'wx' });
      for (const resource of grouped.resources.filter(resource => resource.file === file.path)) {
        await pipeline(createReadStream(join(directory, ...resource.path.split('/'))), createWriteStream(target, { flags: 'a' }));
      }
      if ((await lstat(target)).size !== file.byteLength) throw new Error(`Packed file size mismatch: ${file.path}`);
      const handle = await open(target, 'r+');
      try { await handle.sync(); } finally { await handle.close(); }
    }
    if (await readFile(manifestPath, 'utf8') !== original) throw new Error('The source manifest changed during conversion.');
    await writeFile(backup, original, { flag: 'wx' });
    backupCreated = true;
    for (const file of grouped.files) {
      const target = join(directory, file.path);
      if (!await absent(target)) throw new Error(`Destination appeared during conversion: ${target}`);
      await rename(join(staging, file.path), target);
      published.push(target);
    }
    const replacement = join(staging, 'scene.json');
    await writeFile(replacement, `${JSON.stringify(grouped, null, 2)}\n`, { flag: 'wx' });
    const handle = await open(replacement, 'r+');
    try { await handle.sync(); } finally { await handle.close(); }
    await rename(replacement, manifestPath);
    committed = true;
  } finally {
    if (!committed) {
      for (const path of published) await rm(path, { force: true });
      if (backupCreated) await rm(backup, { force: true });
    }
    await rm(staging, { recursive: true, force: true });
  }
  if (removeOriginals) {
    await removeOriginalBlocks(directory, manifest);
  }
  return 'converted';
}

async function findManifests(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.merge-')) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await findManifests(path));
    else if (entry.isFile() && entry.name === 'scene.json') found.push(path);
  }
  return found;
}

async function main() {
  const { values } = parseArgs({ options: {
    root: { type: 'string', default: join(root, 'scenes', 'compiled') },
    entry: { type: 'string' }, 'dry-run': { type: 'boolean' },
    'remove-originals': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('node scripts/merge-compiled-scenes.mjs [--root scenes/compiled | --entry path/to/scene.json] [--dry-run] [--remove-originals]\n' +
      'Copies compressed v1 blocks into three sibling files and publishes the v2 manifest last. No USD import or recompression.\n' +
      'Defaults: keep original blocks and scene.v1.json backup; skip existing v2 packages.\n' +
      '--remove-originals deletes only indexed v1 blocks after conversion, retaining scene.v1.json.');
    return;
  }
  const manifests = values.entry ? [resolve(values.entry)] : (await findManifests(resolve(values.root))).sort();
  if (!manifests.length) throw new Error('No scene.json manifests found.');
  const counts = { converted: 0, cleaned: 0, skipped: 0, planned: 0, failed: 0 };
  for (const [index, path] of manifests.entries()) {
    console.log(`[${index + 1}/${manifests.length}] ${path}`);
    try {
      const status = await mergeCompiledScene(path, { dryRun: values['dry-run'], removeOriginals: values['remove-originals'] });
      counts[status]++;
      console.log(`  ${status}`);
    } catch (error) {
      counts.failed++;
      console.error(`  Failed: ${error.message}`);
    }
  }
  console.log(`Converted: ${counts.converted}; cleaned: ${counts.cleaned}; skipped v2: ${counts.skipped}; planned: ${counts.planned}; failed: ${counts.failed}.`);
  if (counts.failed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}