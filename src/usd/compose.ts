// Unified stage composition (plan section 8, T049). Composes a single SceneAsset
// from a text USDA entry plus any binary-crate subLayers, payloads and
// references: every asset path is resolved through the AssetResolver under an
// explicit asset-root policy (HTTP(S) root or local file map) with no silent
// `D:\` remap (REQ-011/REQ-013). Crate layers are flattened to USDA by the T048
// OpenUSD-wasm reader and composed through the same text importer, so payloads
// and references that point at crate prims land in one composed stage.

import type { DiagnosticSink } from '../core/diagnostics.ts';
import type { SceneAsset } from '../scene/types.ts';
import { AssetResolver } from '../assets/resolver.ts';
import { flattenCrate, type OpenUsdModule } from './crate.ts';
import { importUsdStage, type UsdLayerReader } from './importer.ts';

const CRATE_MAGIC = 'PXR-USDC';

/** Fetches raw bytes for a resolved URL (browser: fetch; tests: in-memory). */
export interface AssetByteSource {
  fetchBytes(url: string): Promise<Uint8Array>;
}

export interface ComposeStageOptions {
  /** Policy-enforcing resolver mapping logical paths to fetchable URLs. */
  resolver: AssetResolver;
  /** Byte source for resolved URLs. */
  source: AssetByteSource;
  /** Loads (and should cache) the OpenUSD-wasm module used to flatten crates. */
  loadCrateModule?: () => Promise<OpenUsdModule>;
  sink?: DiagnosticSink;
  maxDepth?: number;
}

export class StageComposeError extends Error {
  override readonly name = 'StageComposeError';
}

function looksLikeCrate(bytes: Uint8Array): boolean {
  if (bytes.length < CRATE_MAGIC.length) return false;
  for (let i = 0; i < CRATE_MAGIC.length; i += 1) {
    if (bytes[i] !== CRATE_MAGIC.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * A reader that resolves a logical layer URI to a URL, fetches its bytes, and
 * returns USDA text -- flattening binary crates on the fly so the text importer
 * never sees a crate. Asset-root policy violations surface as resolver
 * diagnostics and throw (no silent repair).
 */
export function createCrateAwareReader(options: ComposeStageOptions): UsdLayerReader {
  const { resolver, source, loadCrateModule, sink, maxDepth } = options;
  const decoder = new TextDecoder('utf-8');
  return {
    async read(uri: string): Promise<string> {
      const { url } = resolver.resolve(uri);
      const bytes = await source.fetchBytes(url);
      if (looksLikeCrate(bytes)) {
        if (!loadCrateModule) {
          throw new StageComposeError(`Crate layer '${uri}' requires a crate module loader (loadCrateModule).`);
        }
        return flattenCrate(bytes, uri, {
          preserveLayer: true,
          loadModule: loadCrateModule,
          ...(sink ? { sink } : {}),
          ...(maxDepth !== undefined ? { maxDepth } : {}),
        });
      }
      return decoder.decode(bytes);
    },
  };
}

/**
 * Compose an entry USDA stage and all of its crate/text subLayers, payloads and
 * references into a single SceneAsset.
 */
export async function composeStage(entryUri: string, options: ComposeStageOptions): Promise<SceneAsset> {
  const reader = createCrateAwareReader(options);
  return importUsdStage(entryUri, {
    reader,
    resolveArcs: true,
    ...(options.sink ? { sink: options.sink } : {}),
    ...(options.maxDepth !== undefined ? { maxDepth: options.maxDepth } : {}),
  });
}
