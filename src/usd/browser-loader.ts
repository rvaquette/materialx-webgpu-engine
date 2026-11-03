import type { OpenUsdModule } from './crate.ts';

let loading: Promise<OpenUsdModule> | undefined;

function isModule(value: unknown): value is OpenUsdModule {
  return typeof value === 'object' && value !== null &&
    ['FS_createDataFile', 'FS_unlink', 'OpenStage', 'ReleaseStage', 'GetBuildInfoJson']
      .every(key => key in value && typeof Reflect.get(value, key) === 'function');
}

/** Load the installed OpenUSD runtime only when a binary layer is encountered. */
export function loadBrowserOpenUsd(): Promise<OpenUsdModule> {
  loading ??= (async () => {
    if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
      throw new Error(
        'Binary USD loading requires cross-origin isolation (SharedArrayBuffer). ' +
        'Serve the app with Cross-Origin-Opener-Policy: same-origin and ' +
        'Cross-Origin-Embedder-Policy: require-corp over HTTPS or localhost. ' +
        'For the built app, run npm run preview and open its URL instead of Live Server.',
      );
    }
    const url = new URL(`${import.meta.env.BASE_URL}openusd/index.js`, document.baseURI).href;
    const bindings: unknown = await import(/* @vite-ignore */ url);
    if (typeof bindings !== 'object' || bindings === null ||
      !('getUsdModule' in bindings) || typeof bindings.getUsdModule !== 'function') {
      throw new Error('Invalid OpenUSD bindings: missing getUsdModule.');
    }
    const module: unknown = await bindings.getUsdModule({ setStatus: () => {} });
    if (!isModule(module)) throw new Error('Invalid OpenUSD WASM module.');
    return module;
  })().catch(error => {
    loading = undefined;
    throw error;
  });
  return loading;
}
