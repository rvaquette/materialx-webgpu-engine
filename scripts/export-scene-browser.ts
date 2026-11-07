import { loadUsdScene } from '../src/render/usd-scene-assets.ts';
import { exportCompiledScene } from '../src/scene/compiled-scene.ts';
import type { CompiledScenePackage } from '../src/scene/compiled-scene-codec.ts';
import type { DiagnosticSink } from '../src/core/diagnostics.ts';

let scenePackage: CompiledScenePackage | undefined;

export async function compileScene(entry: string, compressionLevel = 22) {
  const sink: DiagnosticSink = diagnostic => {
    if (diagnostic.level === 'error') console.error(diagnostic.message, diagnostic.detail ?? '');
    else if (diagnostic.level === 'warning') console.warn(diagnostic.message, diagnostic.detail ?? '');
  };
  console.log('Loading USD scene...');
  const loaded = await loadUsdScene(entry, sink, message => console.log(message), new Map(), { editableParameters: true });
  try {
    console.log('Preparing and compressing compiled scene...');
    scenePackage = await exportCompiledScene(loaded, { compressionLevel, onProgress: message => console.log(message) });
    console.log(`Compiled scene ready: ${scenePackage.files.size} payloads.`);
    return {
      manifest: scenePackage.manifest,
      files: [...scenePackage.files].map(([path, bytes]) => ({ path, byteLength: bytes.byteLength })),
    };
  } finally {
    loaded.mtlx.documents?.delete();
  }
}

export function readChunk(path: string, offset: number, length: number): string {
  const bytes = scenePackage?.files.get(path);
  if (!bytes) throw new Error(`Unknown compiled payload: ${path}`);
  const chunk = bytes.subarray(offset, offset + length);
  let binary = '';
  for (let i = 0; i < chunk.length; i += 8192) binary += String.fromCharCode(...chunk.subarray(i, i + 8192));
  return btoa(binary);
}
