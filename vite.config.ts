/// <reference path="./vite-shims.d.ts" />
import { defineConfig } from 'vite';
import { existsSync, readFileSync } from 'fs';
import { extname, join, normalize } from 'path';

// Cross-origin isolation (COOP/COEP) enables SharedArrayBuffer and threaded
// WASM. It is opt-in: the engine must keep a non-shared-memory fallback
// (plan section 10), so these headers are a dev-server convenience, not a
// hard requirement.
const crossOriginIsolation = {
  name: 'cross-origin-isolation',
  configureServer(server: { middlewares: { use: (fn: (req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => void) => void } }) {
    server.middlewares.use((_req, res, next) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      next();
    });
  },
};

// Serve the real MaterialX Core WASM module and standard library .mtlx tree at
// /materialx/ so the graph material compiler (T057m) loads them in the browser
// without copying the large binaries into the repo. Paths point at the local
// MaterialX-rva install and are overridable via env for other machines.
const MATERIALX_CORE_DIR =
  process.env['MX_CORE_DIR'] ??
  'D:/WebGL2/MaterialX/MaterialX-rva/javascript/build/installed/JavaScript/MaterialX';
const MATERIALX_LIB_ROOT =
  process.env['MX_LIB_ROOT'] ?? 'D:/WebGL2/MaterialX/MaterialX-rva/libraries';
const PLAYGROUND_ROOT = process.env['MX_PLAYGROUND_ROOT'] ??
  'D:\\WebGL2\\MaterialX\\OpenPBRShaderPlayground\\ShdrPlygrnd';
const OPENUSD_ROOT = join('node_modules', '@needle-tools', 'usd', 'src', 'bindings');

const MATERIALX_MIME: Record<string, string> = {
  '.js': 'application/javascript',
  '.wasm': 'application/wasm',
  '.mtlx': 'application/xml',
};

interface MxReq {
  url?: string;
}
interface MxRes {
  setHeader: (k: string, v: string) => void;
  end: (chunk?: Uint8Array) => void;
}

const materialxAssets = {
  name: 'materialx-assets',
  configureServer(server: {
    middlewares: { use: (fn: (req: MxReq, res: MxRes, next: () => void) => void) => void };
  }) {
    server.middlewares.use((req, res, next) => {
      const path = (req.url ?? '').split('?')[0] ?? '';
      const externalRoot = path.startsWith('/openusd/') ? OPENUSD_ROOT
        : path.startsWith('/playground/') ? PLAYGROUND_ROOT : undefined;
      if (externalRoot) {
        const prefix = path.startsWith('/openusd/') ? '/openusd/' : '/playground/';
        const rel = decodeURIComponent(path.slice(prefix.length));
        if (rel.split(/[\\/]/).some(part => part === '..') || rel.includes(':')) { next(); return; }
        const file = join(externalRoot, rel);
        if (!existsSync(file)) { next(); return; }
        res.setHeader('Content-Type', MATERIALX_MIME[extname(file)] ?? 'application/octet-stream');
        res.end(readFileSync(file));
        return;
      }
      if (!path.startsWith('/materialx/')) {
        next();
        return;
      }
      const rel = decodeURIComponent(path.slice('/materialx/'.length));
      const underLibraries = rel.startsWith('libraries/');
      const root = underLibraries ? MATERIALX_LIB_ROOT : MATERIALX_CORE_DIR;
      const sub = underLibraries ? rel.slice('libraries/'.length) : rel;
      const file = normalize(join(root, sub));
      // Guard against path traversal outside the served roots.
      if (!file.startsWith(normalize(root)) || !existsSync(file)) {
        next();
        return;
      }
      res.setHeader('Content-Type', MATERIALX_MIME[extname(file)] ?? 'application/octet-stream');
      res.end(readFileSync(file));
    });
  },
};

export default defineConfig({
  base: './',
  plugins: [crossOriginIsolation, materialxAssets],
  // MaterialX ships a .wasm binary that must be served as an asset, not inlined.
  assetsInclude: ['**/*.wasm'],
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
