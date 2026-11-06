import { loadUsdScene } from '../src/render/usd-scene-assets.ts';
import { exportCompiledScene } from '../src/scene/compiled-scene.ts';
import type { CompiledScenePackage } from '../src/scene/compiled-scene-codec.ts';
import type { DiagnosticSink } from '../src/core/diagnostics.ts';

let scenePackage: CompiledScenePackage | undefined;

export async function compileScene(entry: string) {
  const sink: DiagnosticSink = diagnostic => {
    if (diagnostic.level === 'error') console.error(diagnostic.message, diagnostic.detail ?? '');
    else if (diagnostic.level === 'warning') console.warn(diagnostic.message, diagnostic.detail ?? '');
  };
  const loaded = await loadUsdScene(entry, sink, () => {}, new Map(), { editableParameters: true });
  try {
    scenePackage = await exportCompiledScene(loaded);
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
