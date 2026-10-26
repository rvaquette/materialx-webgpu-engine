// Default OpenUSD-wasm module loader for the Node runtime (T048). Loads the
// OpenUSD 0.26.5 WebAssembly runtime from @needle-tools/usd and caches the
// instantiated module. It lives under scripts/ because it is Node-only wiring
// (uses node:module/path/url); the engine's src/ stays browser-typed. A
// browser-side loader lives in src/usd/browser-loader.ts. See docs/dependencies.md for
// the locked revision and the PolyForm-Noncommercial licensing note.
//
// The @needle-tools/usd bindings live at an internal subpath that the package
// `exports` map does not expose, and the package root transitively imports
// `three`; both are avoided by resolving the package main and importing the
// bindings file directly. The bindings auto-detect Node and load the glue as
// CJS, so no DOM shims are needed.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OpenUsdModule } from '../src/usd/crate.ts';

let cached: Promise<OpenUsdModule> | null = null;

/** Loads and caches the OpenUSD-wasm module (Node runtime). */
export function loadOpenUsd(): Promise<OpenUsdModule> {
  if (!cached) {
    cached = (async (): Promise<OpenUsdModule> => {
      const require = createRequire(import.meta.url);
      const indexPath = require.resolve('@needle-tools/usd');
      const bindingsPath = join(dirname(indexPath), 'bindings', 'index.js');
      const bindings = (await import(pathToFileURL(bindingsPath).href)) as {
        getUsdModule: (opts?: { setStatus?: () => void }) => Promise<OpenUsdModule>;
      };
      return bindings.getUsdModule({ setStatus: () => undefined });
    })();
  }
  return cached;
}
