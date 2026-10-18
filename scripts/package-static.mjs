import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = join(projectRoot, 'dist');
const coreRoot = process.env.MX_CORE_DIR ??
  'D:/WebGL2/MaterialX/MaterialX-rva/javascript/build/installed/JavaScript/MaterialX';
const libraryRoot = process.env.MX_LIB_ROOT ?? 'D:/WebGL2/MaterialX/MaterialX-rva/libraries';
const sceneNames = [
  'test_material_disney_gold',
  'test_material_brick_procedural',
  'test_material_brick_metal_mix',
  'test_material_metal_brushed',
  'test_material_velvet',
];

function requirePath(path, label) {
  if (!existsSync(path)) throw new Error(`Missing ${label}: ${path}`);
}

function replaceTree(source, destination, label) {
  requirePath(source, label);
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true });
}

requirePath(distRoot, 'Vite build output');
const scenesRoot = join(distRoot, 'scenes');
rmSync(scenesRoot, { recursive: true, force: true });
for (const name of sceneNames) {
  const source = join(projectRoot, 'scenes', name);
  requirePath(source, `built-in scene ${name}`);
  cpSync(source, join(scenesRoot, name), { recursive: true });
}

const materialxRoot = join(distRoot, 'materialx');
rmSync(materialxRoot, { recursive: true, force: true });
mkdirSync(materialxRoot, { recursive: true });
for (const file of ['JsMaterialXCore.js', 'JsMaterialXCore.wasm']) {
  const source = join(coreRoot, file);
  requirePath(source, `MaterialX Core ${file}`);
  cpSync(source, join(materialxRoot, file));
}
cpSync(libraryRoot, join(materialxRoot, 'libraries'), { recursive: true });

console.log(`Packaged static app: ${sceneNames.length} scenes + MaterialX Core and libraries into ${distRoot}`);