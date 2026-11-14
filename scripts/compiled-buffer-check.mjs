import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

async function isEmptyFile(path) {
  try { return (await stat(path)).size === 0; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

/** Returns the first unexpectedly empty buffer, or undefined if none is present. */
export async function findEmptyCompiledBuffer(directory, manifestName, sharedDirectory) {
  const manifestPath = join(directory, manifestName);
  let manifest;
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }

  if (Array.isArray(manifest.files)) {
    const buffer = manifest.files.find(file => file.path === 'buffers.bin.zst');
    if (!buffer) return undefined;
    if (!Number.isSafeInteger(buffer.byteLength) || buffer.byteLength < 0) {
      throw new Error(`Invalid buffer size in ${manifestPath}`);
    }
    if (buffer.byteLength === 0) return undefined;
    const path = resolve(directory, buffer.location ?? buffer.path);
    if (buffer.location !== undefined &&
        (!sharedDirectory || path !== resolve(sharedDirectory, buffer.path))) {
      throw new Error(`Unexpected shared buffer location in ${manifestPath}: ${buffer.location}`);
    }
    if (await isEmptyFile(path)) return { path, shared: buffer.location !== undefined };
    return undefined;
  }

  for (const resource of manifest.resources ?? []) {
    if (!/^buffers\/[a-f0-9]{64}\.bin\.zst$/.test(resource.path) ||
        !Number.isSafeInteger(resource.compressedByteLength) || resource.compressedByteLength <= 0) continue;
    const path = join(directory, ...resource.path.split('/'));
    if (await isEmptyFile(path)) return { path, shared: false };
  }
  return undefined;
}
