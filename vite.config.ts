/// <reference path="./vite-shims.d.ts" />
import { defineConfig, configDefaults } from 'vitest/config';
import { existsSync, readFileSync } from 'fs';
import { extname, join, normalize } from 'path';
import { fileURLToPath } from 'node:url';
import { sceneBufferCachePlugin } from './scripts/pathtracer-cache-server.mjs';

// The installed OpenUSD crate runtime requires shared memory and isolation.
const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
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
  // scripts/*.test.mjs use node:test and run through `node --test` (see npm test).
  test: { exclude: [...configDefaults.exclude, 'scripts/**/*.test.mjs'] },
  optimizeDeps: { exclude: ['@bokuweb/zstd-wasm', '@mori2003/jsimgui'] },
  resolve: {
    alias: [{
      // jsimgui 0.14 publishes this optional loader with the words reversed.
      find: './loader-freetype-extensions.js',
      replacement: fileURLToPath(new URL('./node_modules/@mori2003/jsimgui/build/loader-extensions-freetype.js', import.meta.url)),
    }],
  },
  plugins: [materialxAssets, sceneBufferCachePlugin(fileURLToPath(new URL('.', import.meta.url)))],
  server: { headers: crossOriginIsolationHeaders },
  preview: { headers: crossOriginIsolationHeaders },
  // MaterialX ships a .wasm binary that must be served as an asset, not inlined.
  assetsInclude: ['**/*.wasm'],
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          includeDependenciesRecursively: false,
          groups: [
            { name: 'materialx-compiler', test: /[\\/]src[\\/](compiler|materialx|render[\\/]bsdf)[\\/]/ },
            { name: 'scene-assets', test: /[\\/]src[\\/](usd|geometry|assets)[\\/]/ },
            { name: 'pathtracing', test: /[\\/]src[\\/]render[\\/]pathtracing[\\/]/ },
          ],
        },
      },
    },
  },
});
