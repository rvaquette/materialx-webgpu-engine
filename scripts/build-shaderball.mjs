import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
await build({
  root,
  configFile: join(root, 'vite.config.ts'),
  build: {
    outDir: 'dist-shaderball',
    rollupOptions: { input: [join(root, 'usd-image-harness.html'), join(root, 'index.html')] },
  },
});
