import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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

function findWasmOpt() {
  const executable = process.platform === 'win32' ? 'wasm-opt.exe' : 'wasm-opt';
  if (process.env.MX_WASM_OPT) {
    requirePath(process.env.MX_WASM_OPT, 'wasm-opt');
    return process.env.MX_WASM_OPT;
  }
  if (process.env.EMSDK) {
    const candidate = join(process.env.EMSDK, 'upstream', 'bin', executable);
    requirePath(candidate, 'wasm-opt from EMSDK');
    return candidate;
  }
  const defaultPath = process.platform === 'win32' ? 'D:/emsdk/upstream/bin/wasm-opt.exe' : undefined;
  if (defaultPath && existsSync(defaultPath)) return defaultPath;
  return executable;
}

function optimizeCoreWasm(wasmPath) {
  const optimizer = findWasmOpt();
  const version = spawnSync(optimizer, ['--version'], { encoding: 'utf8' });
  if (version.error) throw version.error;
  if (version.status !== 0) throw new Error(`wasm-opt --version failed with exit code ${version.status}.`);

  const optimizedPath = `${wasmPath}.optimized`;
  try {
    const result = spawnSync(optimizer, ['--all-features', '-Oz', wasmPath, '-o', optimizedPath], {
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`wasm-opt failed with exit code ${result.status}.`);

    const originalBytes = statSync(wasmPath).size;
    const optimizedBytes = statSync(optimizedPath).size;
    if (optimizedBytes >= originalBytes) {
      throw new Error(`wasm-opt did not reduce Core WASM (${originalBytes} -> ${optimizedBytes} bytes).`);
    }
    new WebAssembly.Module(readFileSync(optimizedPath));
    copyFileSync(optimizedPath, wasmPath);
    console.log(
      `Optimized MaterialX Core WASM: ${originalBytes} -> ${optimizedBytes} bytes ` +
      `(${((1 - optimizedBytes / originalBytes) * 100).toFixed(1)}%; ${version.stdout.trim()})`,
    );
  } finally {
    rmSync(optimizedPath, { force: true });
  }
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
      const packed = join(directory, file.location ?? file.path);
      const actual = statSync(packed).size;
      if (file.location === undefined ? actual !== file.byteLength : actual < file.byteLength) {
        throw new Error(`Compiled scene file is incomplete: ${packed} (${actual} bytes; expected ${file.byteLength}). ` +
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
optimizeCoreWasm(join(materialxRoot, 'JsMaterialXCore.wasm'));
cpSync(libraryRoot, join(materialxRoot, 'libraries'), { recursive: true });

const openUsdRoot = join(projectRoot, 'node_modules', '@needle-tools', 'usd', 'src', 'bindings');
const openUsdOutput = join(distRoot, 'openusd');
mkdirSync(openUsdOutput, { recursive: true });
for (const file of ['index.js', 'emHdBindings.js', 'emHdBindings.wasm', 'openusd-build-info.json']) {
  requirePath(join(openUsdRoot, file), `OpenUSD ${file}`);
  cpSync(join(openUsdRoot, file), join(openUsdOutput, file));
}

console.log(`Packaged static app: ${sceneNames.length} scenes + MaterialX Core and libraries into ${distRoot}`);