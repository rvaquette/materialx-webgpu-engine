import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const outDir = join(root, 'build-engine');
const source = join(root, 'src');
const project = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const externals = ['@bokuweb/zstd-wasm', 'three'];
const dependencies = {
  ...Object.fromEntries(externals.map(name => [name, project.dependencies[name]])),
  '@types/three': project.devDependencies['@types/three'],
  '@webgpu/types': project.devDependencies['@webgpu/types'],
};

await build({
  configFile: false,
  root: source,
  base: './',
  publicDir: false,
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
    lib: {
      entry: { engine: join(source, 'engine.ts'), element: join(source, 'engine-element.ts') },
      formats: ['es'], fileName: (_format, entry) => `${entry}.js`,
    },
    rolldownOptions: {
      external: id => externals.some(name => id === name || id.startsWith(`${name}/`)),
    },
  },
});

execFileSync(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.engine.json'], {
  cwd: root,
  stdio: 'inherit',
});

// Expose the WebGPU globals to consumers without requiring changes to their tsconfig.
await writeFile(join(outDir, 'index.d.ts'), '/// <reference types="@webgpu/types" />\nexport * from "./types/engine.js";\n');
await writeFile(join(outDir, 'element.d.ts'), '/// <reference types="@webgpu/types" />\nexport * from "./types/engine-element.js";\n');
const manifest = {
  name: project.name,
  version: project.version,
  description: project.description,
  private: true,
  type: 'module',
  types: './index.d.ts',
  exports: {
    '.': { types: './index.d.ts', import: './engine.js' },
    './element': { types: './element.d.ts', import: './element.js' },
  },
  dependencies,
};
await writeFile(join(outDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
