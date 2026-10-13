// OpenUSD-wasm crate reader (plan section 8, T048). Decodes a binary USD crate
// (.usdc / .usd PXR-USDC) with the OpenUSD 0.26.5 WebAssembly runtime: it writes
// the crate into the module's in-memory FS, opens the stage, flattens the
// composed stage to USDA text (ExportToString), and composes that text through
// the existing USDA importer into a SceneAsset. OpenUSD-wasm is the sole crate
// reader (docs/dependencies.md, docs/usd-import.md). The module is injected so
// this stays unit-testable; the default loader lives in openusd-loader.ts.

import type { DiagnosticSink } from '../core/diagnostics.ts';
import type { SceneAsset } from '../scene/types.ts';
import { importUsdStage, type UsdImportOptions } from './importer.ts';

/** Opaque stage handle returned by the OpenUSD-wasm module. */
export interface OpenUsdStage {
  /** Flattens the composed stage to USDA text. */
  ExportToString(): string;
  /** Composition errors collected while opening the stage. */
  GetCompositionErrors?(): string[];
}

/** Minimal surface of the OpenUSD-wasm module used by the crate reader. */
export interface OpenUsdModule {
  FS_createDataFile(
    parent: string,
    name: string,
    data: Uint8Array,
    canRead: boolean,
    canWrite: boolean,
    canOwn: boolean,
  ): unknown;
  FS_unlink(path: string): void;
  OpenStage(path: string): OpenUsdStage | Promise<OpenUsdStage>;
  ReleaseStage(stage: OpenUsdStage): boolean;
  GetBuildInfoJson(): string;
}

export interface CrateReaderOptions {
  /** Loads (and should cache) the OpenUSD-wasm module. */
  loadModule: () => Promise<OpenUsdModule>;
  sink?: DiagnosticSink;
  /** Forwarded to the USDA importer composition guard. */
  maxDepth?: number;
}

export class CrateReadError extends Error {
  override readonly name = 'CrateReadError';
}

/** Emscripten FS names cannot contain '/'; collapse the crate path to a basename. */
function sanitizeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  return base.length > 0 ? base : 'crate.usd';
}

/**
 * Flatten a binary crate to composed USDA text via OpenUSD-wasm. The returned
 * text has all composition applied and is ready for the text importer.
 */
export async function flattenCrate(
  bytes: Uint8Array,
  name: string,
  options: CrateReaderOptions,
): Promise<string> {
  const mod = await options.loadModule();
  const fsName = sanitizeName(name);
  const path = `/${fsName}`;
  mod.FS_createDataFile('/', fsName, bytes, true, true, true);
  try {
    const stage = await mod.OpenStage(path);
    if (!stage) {
      throw new CrateReadError(`OpenUSD-wasm could not open crate: ${name}`);
    }
    try {
      const errors = stage.GetCompositionErrors?.() ?? [];
      if (errors.length > 0 && options.sink) {
        for (const message of errors.slice(0, 8)) {
          options.sink({ level: 'warning', message: `Crate composition: ${message}`, detail: { crate: name } });
        }
      }
      const usda = stage.ExportToString();
      if (typeof usda !== 'string' || usda.length === 0) {
        throw new CrateReadError(`OpenUSD-wasm exported empty USDA for crate: ${name}`);
      }
      return usda;
    } finally {
      try {
        mod.ReleaseStage(stage);
      } catch {
        /* best-effort release */
      }
    }
  } finally {
    try {
      mod.FS_unlink(path);
    } catch {
      /* best-effort cleanup */
    }
  }
}

/**
 * Decode a binary crate into a SceneAsset: meshes (points, faceVertexCounts /
 * Indices, normals, primvars/UV), transforms, cameras and lights are all carried
 * by the flattened USDA and composed through the text importer.
 */
export async function importCrate(
  bytes: Uint8Array,
  name: string,
  options: CrateReaderOptions,
): Promise<SceneAsset> {
  const usda = await flattenCrate(bytes, name, options);
  const entry = sanitizeName(name);
  const reader = {
    read: async (uri: string): Promise<string> => {
      if (uri === entry) return usda;
      throw new CrateReadError(`Flattened crate exposes no layer '${uri}' (only '${entry}').`);
    },
  };
  const importOptions: UsdImportOptions = {
    reader,
    ...(options.sink ? { sink: options.sink } : {}),
    ...(options.maxDepth !== undefined ? { maxDepth: options.maxDepth } : {}),
  };
  return importUsdStage(entry, importOptions);
}
