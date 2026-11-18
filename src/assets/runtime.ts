/** Runtime directories served by the host. Relative URLs use the document base. */
export interface EngineRuntimeAssets {
  /** Directory containing JsMaterialXCore.js and its companion WASM. */
  readonly materialxCore?: string | URL;
  /** Directory containing the MaterialX standard library tree. */
  readonly materialxLibraries?: string | URL;
  /** Directory containing the OpenUSD bindings (index.js and its companion files). */
  readonly openUsd?: string | URL;
}

export type RuntimeAssetUrls = { [K in keyof EngineRuntimeAssets]: string };

function directoryUrl(value: string | URL): string {
  const url = new URL(value, globalThis.document?.baseURI);
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}

export function resolveRuntimeAssets(assets: EngineRuntimeAssets): RuntimeAssetUrls {
  const { materialxCore, materialxLibraries, openUsd } = assets;
  return {
    ...(materialxCore !== undefined ? { materialxCore: directoryUrl(materialxCore) } : {}),
    ...(materialxLibraries !== undefined ? { materialxLibraries: directoryUrl(materialxLibraries) } : {}),
    ...(openUsd !== undefined ? { openUsd: directoryUrl(openUsd) } : {}),
  };
}
