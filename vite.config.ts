import { defineConfig } from 'vite';

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

export default defineConfig({
  plugins: [crossOriginIsolation],
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
