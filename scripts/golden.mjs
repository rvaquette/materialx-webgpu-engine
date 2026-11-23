// Golden renders: each case in tests/golden/cases.json is rendered through the public
// engine API in headless Chrome and compared with tests/golden/<name>.png.
//
//   node scripts/golden.mjs                 raster cases (SwiftShader: the references' adapter)
//   node scripts/golden.mjs --gpu           path-traced cases on the host GPU (GPU runner)
//   node scripts/golden.mjs --update        rewrite the selected references from this machine
//
// Failing cases write <name>-actual.png and <name>-diff.png to renders/golden/.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { decodePng, encodePng } from './png.mjs';
import { imageError } from './bench-engine.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const GOLDEN_DIR = join(root, 'tests', 'golden');

/**
 * Raster cases tolerate small rasterization differences between drivers: mean absolute
 * RGB error and the share of pixels off by more than 16/255. Path-traced cases compare
 * 8x8 block means, which average Monte Carlo noise out and expose bias.
 */
export function compareGolden(candidate, reference, tolerance) {
  if (candidate.width !== reference.width || candidate.height !== reference.height) {
    return { pass: false, reason: `size ${candidate.width}x${candidate.height} instead of ${reference.width}x${reference.height}` };
  }
  let absolute = 0, outliers = 0;
  const pixels = candidate.width * candidate.height;
  const diff = new Uint8Array(pixels * 4);
  for (let i = 0; i < pixels; i++) {
    let worst = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(candidate.rgba[i * 4 + c] - reference.rgba[i * 4 + c]);
      absolute += d;
      worst = Math.max(worst, d);
    }
    if (worst > 16) outliers++;
    diff.set([Math.min(255, worst * 8), Math.min(255, worst * 8), Math.min(255, worst * 8), 255], i * 4);
  }
  const metrics = {
    meanAbsoluteError: absolute / (pixels * 3),
    outlierFraction: outliers / pixels,
    blockRmse: imageError(candidate, reference).blockRmse,
  };
  const failures = Object.entries(tolerance)
    .filter(([metric, limit]) => metrics[metric] > limit)
    .map(([metric, limit]) => `${metric} ${metrics[metric].toFixed(4)} > ${limit}`);
  return { pass: failures.length === 0, metrics, ...(failures.length ? { reason: failures.join(', ') } : {}), diff };
}

async function main() {
  const { values } = parseArgs({ options: {
    update: { type: 'boolean', default: false },
    gpu: { type: 'boolean', default: false },
    case: { type: 'string', multiple: true },
  } });
  const { openExportSession, SWIFTSHADER_ARGS } = await import('./export-browser-session.mjs');
  const cases = JSON.parse(await readFile(join(GOLDEN_DIR, 'cases.json'), 'utf8')).cases
    .filter(golden => (golden.backend === 'pathtracing') === values.gpu && (!values.case || values.case.includes(golden.name)));
  // Raster references are SwiftShader images, reproducible on GitHub-hosted runners without a GPU.
  const swiftshader = !values.gpu;
  const session = await openExportSession({
    label: 'golden', browserModule: '/scripts/golden-browser.ts', quiet: true,
    browserArgs: swiftshader
      ? SWIFTSHADER_ARGS
      : process.env.MX_DEFAULT_GPU ? [] : ['--force_high_performance_gpu'],
  });
  const out = join(root, 'renders', 'golden');
  let failed = 0;
  try {
    for (const golden of cases) {
      const result = await session.call('renderGolden', [session.url(golden.scene), golden], 20 * 60 * 1000);
      const image = { width: result.width, height: result.height, rgba: new Uint8Array(Buffer.from(result.rgba, 'base64')) };
      const file = join(GOLDEN_DIR, `${golden.name}.png`);
      const adapter = `${result.adapter.vendor} ${result.adapter.architecture}`.trim() || 'unknown adapter';
      if (values.update) {
        await writeFile(file, encodePng(image.width, image.height, image.rgba));
        console.log(`updated ${golden.name} (${adapter})`);
        continue;
      }
      if (!existsSync(file)) throw new Error(`Missing golden reference ${file}; run with --update.`);
      const comparison = compareGolden(image, decodePng(await readFile(file)), golden.tolerance);
      const metrics = Object.entries(comparison.metrics ?? {}).map(([name, value]) => `${name} ${value.toFixed(4)}`).join(', ');
      console.log(`${comparison.pass ? 'ok  ' : 'FAIL'} ${golden.name} (${adapter}) ${metrics}${comparison.reason ? ` - ${comparison.reason}` : ''}`);
      for (const warning of result.warnings) console.log(`     warning: ${warning}`);
      if (!comparison.pass) {
        failed++;
        await mkdir(out, { recursive: true });
        await writeFile(join(out, `${golden.name}-actual.png`), encodePng(image.width, image.height, image.rgba));
        if (comparison.diff) await writeFile(join(out, `${golden.name}-diff.png`), encodePng(image.width, image.height, comparison.diff));
      }
    }
  } finally {
    await session.close();
  }
  if (failed) {
    console.error(`${failed} golden case(s) failed; see renders/golden/.`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
