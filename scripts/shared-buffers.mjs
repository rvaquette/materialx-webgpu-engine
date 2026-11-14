// Moves a compiled scene's buffers.bin.zst into a group-wide, append-only pack whose payloads are
// deduplicated by SHA-256, and rewrites scene.json to reference the pack's offsets through a
// `location` (see CompiledPackedFile in src/scene/compiled-scene-codec.ts).
// The pack never rewrites existing bytes, so manifests written earlier stay valid; the index
// (buffers.json) is published after the pack is synced, and a pack longer than its index (an
// interrupted append) is truncated back before the next append.
import { open, readFile, rename, rm, mkdir, stat, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

export const BUFFERS_FILE = 'buffers.bin.zst';
export const BUFFERS_INDEX = 'buffers.json';

async function readIndex(sharedDirectory) {
  try {
    const index = JSON.parse(await readFile(join(sharedDirectory, BUFFERS_INDEX), 'utf8'));
    if (index?.format !== 'materialx-shared-buffers' || !Number.isSafeInteger(index.byteLength) ||
        typeof index.resources !== 'object' || index.resources === null) {
      throw new Error(`Invalid shared buffer index in ${sharedDirectory}`);
    }
    return index;
  } catch (error) {
    if (error.code === 'ENOENT') return { format: 'materialx-shared-buffers', byteLength: 0, resources: {} };
    throw error;
  }
}

async function writeJsonAtomically(path, value) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

/**
 * Pools the buffers of the compiled scene in `sceneDirectory` into `sharedDirectory`.
 * Returns 'shared' (pack updated), 'reused' (all payloads already pooled) or 'already'.
 */
export async function shareSceneBuffers(sceneDirectory, sharedDirectory) {
  const manifestPath = join(sceneDirectory, 'scene.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const entry = manifest.files?.find(file => file.path === BUFFERS_FILE);
  if (!entry) throw new Error(`No ${BUFFERS_FILE} in ${manifestPath}`);
  const location = relative(sceneDirectory, join(sharedDirectory, BUFFERS_FILE)).split(sep).join('/');
  if (entry.location !== undefined) {
    if (entry.location !== location) throw new Error(`${manifestPath} already references another pack: ${entry.location}`);
    return 'already';
  }
  const local = await readFile(join(sceneDirectory, BUFFERS_FILE));
  if (local.byteLength !== entry.byteLength) throw new Error(`Truncated ${BUFFERS_FILE} in ${sceneDirectory}`);

  await mkdir(sharedDirectory, { recursive: true });
  const index = await readIndex(sharedDirectory);
  const packPath = join(sharedDirectory, BUFFERS_FILE);
  await writeFile(packPath, new Uint8Array(), { flag: 'a' });
  const handle = await open(packPath, 'r+');
  let appended = 0;
  try {
    const { size } = await handle.stat();
    if (size < index.byteLength) throw new Error(`${packPath} is shorter than its index (${size} < ${index.byteLength}).`);
    if (size > index.byteLength) await handle.truncate(index.byteLength);
    const resources = manifest.resources.map(resource => {
      if (resource.file !== BUFFERS_FILE) return resource;
      let pooled = index.resources[resource.sha256];
      if (pooled && pooled.byteLength !== resource.byteLength) throw new Error(`Inconsistent pooled payload ${resource.sha256}`);
      if (!pooled) {
        pooled = { offset: index.byteLength, byteLength: resource.byteLength, compressedByteLength: resource.compressedByteLength };
        pooled.bytes = local.subarray(resource.offset, resource.offset + resource.compressedByteLength);
        if (pooled.bytes.byteLength !== resource.compressedByteLength) throw new Error(`Resource exceeds ${BUFFERS_FILE}: ${resource.path}`);
        index.resources[resource.sha256] = pooled;
        index.byteLength += resource.compressedByteLength;
      }
      return { ...resource, offset: pooled.offset, compressedByteLength: pooled.compressedByteLength };
    });
    for (const pooled of Object.values(index.resources)) {
      if (!pooled.bytes) continue;
      await handle.write(pooled.bytes, 0, pooled.bytes.byteLength, pooled.offset);
      appended += pooled.bytes.byteLength;
      delete pooled.bytes;
    }
    await handle.sync();
    if ((await handle.stat()).size !== index.byteLength) throw new Error(`Unexpected size after appending to ${packPath}`);
    if (appended) await writeJsonAtomically(join(sharedDirectory, BUFFERS_INDEX), index);
    manifest.resources = resources;
    manifest.files = manifest.files.map(file => file.path === BUFFERS_FILE
      ? { path: BUFFERS_FILE, byteLength: index.byteLength, location } : file);
  } finally {
    await handle.close();
  }
  await writeJsonAtomically(manifestPath, manifest);
  await rm(join(sceneDirectory, BUFFERS_FILE), { force: true });
  return appended ? 'shared' : 'reused';
}

/** Size of the pooled pack, for reporting. */
export async function sharedPackSize(sharedDirectory) {
  try { return (await stat(join(sharedDirectory, BUFFERS_FILE))).size; }
  catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
}
