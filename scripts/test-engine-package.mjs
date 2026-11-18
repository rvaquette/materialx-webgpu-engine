import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { openExportSession } from './export-browser-session.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const npmCli = process.env.npm_execpath;
const pathTracing = process.env.MX_CAPTURE_PATH_TRACING === '1';

function assertTriangle({ width, height, rgba }, label) {
  assert.deepEqual([width, height, rgba.length], [33, 31, 33 * 31 * 4], `${label}: invalid RGBA8 dimensions`);
  const pixel = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
  const center = rgba.slice(pixel, pixel + 4);
  const background = rgba.slice(0, 4);
  assert.ok(center[2] >= center[0] + 25 && center[3] === 255, `${label}: expected a blue triangle: ${center}`);
  assert.ok(background[0] >= center[0] + 25 && background[3] === 255, `${label}: unexpected background: ${background}`);
}

test(`installs the packed engine and captures a USD scene (${pathTracing ? 'raster and path tracing' : 'raster'})`, async () => {
  assert.ok(npmCli, 'Run via npm run test:engine-package');
  const consumer = await mkdtemp(join(tmpdir(), 'mx-engine-consumer-'));
  const npm = (...args) => execFileSync(process.execPath, [npmCli, ...args], { cwd: consumer, encoding: 'utf8' });
  try {
    const [archive] = JSON.parse(npm('pack', join(root, 'build-engine'), '--json'));
    assert.ok(archive.files.some(({ path }) => path === 'engine.js'));
    assert.ok(archive.files.every(({ path }) => !path.startsWith('src/') && !path.endsWith('.wasm')));
    await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    npm('install', join(consumer, archive.filename), '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline');
    await cp(join(root, 'scripts', 'fixtures', 'engine-consumer.ts'), join(consumer, 'consumer.ts'));
    execFileSync(process.execPath, [
      join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
      '--noEmit', '--strict', '--module', 'ESNext', '--moduleResolution', 'Bundler',
      '--target', 'ES2022', 'consumer.ts',
    ], { cwd: consumer, stdio: 'inherit' });

    const dist = join(consumer, 'dist');
    await build({
      configFile: false, root: consumer, base: './', logLevel: 'error',
      build: {
        target: 'es2022',
        rolldownOptions: {
          input: join(consumer, 'consumer.ts'),
          preserveEntrySignatures: 'strict',
          output: { entryFileNames: 'consumer.js' },
        },
      },
    });
    const core = process.env.MX_CORE_DIR ??
      'D:/WebGL2/MaterialX/MaterialX-rva/javascript/build/installed/JavaScript/MaterialX';
    const libraries = process.env.MX_LIB_ROOT ?? 'D:/WebGL2/MaterialX/MaterialX-rva/libraries';
    const coreOutput = join(dist, 'engine-assets', 'core');
    await mkdir(coreOutput, { recursive: true });
    for (const file of ['JsMaterialXCore.js', 'JsMaterialXCore.wasm']) {
      await cp(join(core, file), join(coreOutput, file));
    }
    await cp(libraries, join(dist, 'engine-assets', 'libraries'), { recursive: true });
    await cp(join(root, 'examples', 'engine', 'triangle.usda'), join(dist, 'triangle.usda'));

    const session = await openExportSession({
      label: 'engine-package', serverRoot: dist, browserModule: '/consumer.js',
    });
    try {
      const { raster, objects, canvasCount, samples } =
        await session.call('verifyInstalledEngine', [pathTracing], pathTracing ? 360_000 : 120_000);
      assert.deepEqual(objects, ['/World/Triangle']);
      assert.equal(canvasCount, 0);
      assertTriangle(raster, 'Raster');
      if (pathTracing) {
        assert.equal(samples.length, 3);
        const [one, two, oneAgain] = samples;
        assertTriangle(one, 'Path tracing (1 spp)');
        assertTriangle(two, 'Path tracing (2 spp)');
        assertTriangle(oneAgain, 'Path tracing (repeat 1 spp)');
        assert.ok(one.rgba.some((value, i) => value !== two.rgba[i]), 'One and two samples must produce different images');
        assert.ok(one.rgba.every((value, i) => value === oneAgain.rgba[i]), 'Path tracing must restart for every capture');
      } else {
        assert.equal(samples.length, 0);
      }
    } finally {
      await session.close();
    }
  } finally {
    await rm(consumer, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
