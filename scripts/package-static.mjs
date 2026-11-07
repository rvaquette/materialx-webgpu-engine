import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = join(projectRoot, 'dist');
const coreRoot = process.env.MX_CORE_DIR ??
  'D:/WebGL2/MaterialX/MaterialX-rva/javascript/build/installed/JavaScript/MaterialX';
const libraryRoot = process.env.MX_LIB_ROOT ?? 'D:/WebGL2/MaterialX/MaterialX-rva/libraries';
const sceneNames = [
  'standard-shader-ball',
  'mtlx-library',
  'pathtracer',
  'OpenPBRShaderPlayground'
];

function requirePath(path, label) {
  if (!existsSync(path)) throw new Error(`Missing ${label}: ${path}`);
}

function validateCompiledScenes(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      validateCompiledScenes(path);
      continue;
    }
    if (!entry.isFile() || entry.name !== 'scene.json') continue;
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    if (manifest.format !== 'materialx-compiled-scene' || manifest.version !== '2.0') continue;
    if (!Array.isArray(manifest.files) || manifest.files.length !== 3) {
      throw new Error(`Invalid grouped-scene manifest: ${path}`);
    }
    for (const file of manifest.files) {
      if (!['buffers.bin.zst', 'metadata.json.zst', 'shaders.wgsl.zst'].includes(file.path) ||
          !Number.isSafeInteger(file.byteLength) || file.byteLength < 0) {
        throw new Error(`Invalid grouped-scene file descriptor in ${path}`);
      }
      const actual = statSync(join(directory, file.path)).size;
      if (actual !== file.byteLength) {
        throw new Error(`Compiled scene file is incomplete: ${join(directory, file.path)} (${actual} bytes; expected ${file.byteLength}). ` +
          'Check that Git LFS files were hydrated before packaging.');
      }
    }
  }
}

requirePath(distRoot, 'Vite build output');
const scenesRoot = join(distRoot, 'scenes');
rmSync(scenesRoot, { recursive: true, force: true });
for (const name of sceneNames) {
  const source = join(projectRoot, 'scenes', name);
  requirePath(source, `built-in scene ${name}`);
}
cpSync(join(projectRoot, 'scenes'), scenesRoot, { recursive: true });
validateCompiledScenes(scenesRoot);

const materialxRoot = join(distRoot, 'materialx');
rmSync(materialxRoot, { recursive: true, force: true });
mkdirSync(materialxRoot, { recursive: true });
for (const file of ['JsMaterialXCore.js', 'JsMaterialXCore.wasm']) {
  const source = join(coreRoot, file);
  requirePath(source, `MaterialX Core ${file}`);
  cpSync(source, join(materialxRoot, file));
}
cpSync(libraryRoot, join(materialxRoot, 'libraries'), { recursive: true });

const openUsdRoot = join(projectRoot, 'node_modules', '@needle-tools', 'usd', 'src', 'bindings');
const openUsdOutput = join(distRoot, 'openusd');
mkdirSync(openUsdOutput, { recursive: true });
for (const file of ['index.js', 'emHdBindings.js', 'emHdBindings.wasm', 'openusd-build-info.json']) {
  requirePath(join(openUsdRoot, file), `OpenUSD ${file}`);
  cpSync(join(openUsdRoot, file), join(openUsdOutput, file));
}

console.log(`Packaged static app: ${sceneNames.length} scenes + MaterialX Core and libraries into ${distRoot}`);