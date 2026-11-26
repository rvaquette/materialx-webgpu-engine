import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { gzipSync } from 'node:zlib';

const sourceRoot = resolve(process.env.MX_SOURCE_DIR ?? 'D:/WebGL2/MaterialX/MaterialX-rva');
const builds = [
  {
    name: 'full',
    directory: resolve(process.env.MX_BASELINE_CORE_DIR ??
      join(sourceRoot, 'javascript', 'build', 'installed', 'JavaScript', 'MaterialX')),
  },
  {
    name: 'minimal',
    directory: resolve(process.env.MX_MINIMAL_CORE_DIR ?? 'dist/materialx'),
  },
];
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'materialx-core-bench-'));
const optimizedFullWasm = join(temporaryDirectory, 'JsMaterialXCore.wasm');

function findWasmOpt() {
  const executable = process.platform === 'win32' ? 'wasm-opt.exe' : 'wasm-opt';
  if (process.env.MX_WASM_OPT) return process.env.MX_WASM_OPT;
  if (process.env.EMSDK) return join(process.env.EMSDK, 'upstream', 'bin', executable);
  if (process.platform === 'win32') return 'D:/emsdk/upstream/bin/wasm-opt.exe';
  return executable;
}

try {
  const optimization = spawnSync(findWasmOpt(), [
    '--all-features', '-Oz',
    join(builds[0].directory, 'JsMaterialXCore.wasm'),
    '-o', optimizedFullWasm,
  ], { encoding: 'utf8' });
  if (optimization.error) throw optimization.error;
  if (optimization.status !== 0) throw new Error(`wasm-opt failed with exit code ${optimization.status}.`);
  builds[0].wasmPath = optimizedFullWasm;
  builds[1].wasmPath = join(builds[1].directory, 'JsMaterialXCore.wasm');

  function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  for (const build of builds) {
    const jsPath = join(build.directory, 'JsMaterialXCore.js');
    const wasmPath = build.wasmPath;
    const js = readFileSync(jsPath);
    const wasm = readFileSync(wasmPath);
    const moduleUrl = `${pathToFileURL(jsPath).href}?bench=${build.name}`;
    const imported = await import(moduleUrl);
    const factory = imported.default;
    if (typeof factory !== 'function') throw new Error(`Missing factory export in ${jsPath}`);

    const startup = [];
    for (let i = 0; i < 7; i++) {
      const start = performance.now();
      const module = await factory({ locateFile: () => wasmPath });
      startup.push(performance.now() - start);
      module.createDocument().delete();
    }

    const compressedJs = gzipSync(js).length;
    const compressedWasm = gzipSync(wasm).length;
    console.log([
      build.name,
      `js=${statSync(jsPath).size} (${compressedJs} gzip)`,
      `wasm=${wasm.length} (${compressedWasm} gzip)`,
      `pair=${js.length + wasm.length} (${compressedJs + compressedWasm} gzip)`,
      `startup-median=${median(startup).toFixed(1)} ms`,
    ].join(' | '));
  }
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
