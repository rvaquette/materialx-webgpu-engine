import { loadUsdScene } from '../src/render/usd-scene-assets.ts';
import { exportCompiledMaterial, exportCompiledScene } from '../src/scene/compiled-scene.ts';
import { SOURCE_SCENE_CATALOG } from '../src/scene/scene-catalog.ts';
import type { CompiledScenePackage } from '../src/scene/compiled-scene-codec.ts';
import type { DiagnosticSink } from '../src/core/diagnostics.ts';

let scenePackage: CompiledScenePackage | undefined;

const sink: DiagnosticSink = diagnostic => {
  if (diagnostic.level === 'error') console.error(diagnostic.message, diagnostic.detail ?? '');
  else if (diagnostic.level === 'warning') console.warn(diagnostic.message, diagnostic.detail ?? '');
};

const packageSummary = (compiled: CompiledScenePackage) => ({
  manifest: compiled.manifest,
  files: [...compiled.files].map(([path, bytes]) => ({ path, byteLength: bytes.byteLength })),
});

/** Project-relative scene sources (UI catalog) and MaterialX library documents. */
export function listSources(): { scenes: string[]; materials: string[] } {
  return {
    scenes: SOURCE_SCENE_CATALOG.map(scene => scene.entry.replace(/^\.\//, '')),
    materials: Object.keys(import.meta.glob('/scenes/mtlx-library/**/*.mtlx', { query: '?url', import: 'default' }))
      .map(path => path.slice(1)).sort(),
  };
}

export async function compileScene(entry: string, compressionLevel = 22) {
  scenePackage = undefined;
  console.log('Loading USD scene...');
  const loaded = await loadUsdScene(entry, sink, message => console.log(message), new Map(), { editableParameters: true });
  try {
    console.log('Preparing and compressing compiled scene...');
    scenePackage = await exportCompiledScene(loaded, { compressionLevel, onProgress: message => console.log(message) });
    console.log(`Compiled scene ready: ${scenePackage.files.size} payloads.`);
    return packageSummary(scenePackage);
  } finally {
    loaded.mtlx.documents?.delete();
  }
}

/** Compiles the first surfacematerial of a MaterialX document, bound to a probe quad; undefined if it has none. */
export async function compileMaterial(mtlxUrl: string, probeUrl: string, compressionLevel = 22) {
  scenePackage = undefined;
  const response = await fetch(mtlxUrl);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${mtlxUrl}`);
  const materialName = /<surfacematerial\b[^>]*\bname\s*=\s*"([^"]+)"/.exec(await response.text())?.[1];
  if (!materialName) return undefined;
  const primPath = '/Probe/Mesh';
  const loaded = await loadUsdScene(probeUrl, sink, () => {},
    new Map([[primPath, { assetPath: mtlxUrl, materialName }]]), { editableParameters: true });
  try {
    scenePackage = await exportCompiledMaterial(loaded, primPath, { compressionLevel });
    return { materialName, ...packageSummary(scenePackage) };
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