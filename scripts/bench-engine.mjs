// Path-tracer benchmark built on the public engine API (scripts/bench-engine-browser.ts).
// For each scene it measures load time, time to the first raster and path-traced images,
// warm capture time at fixed samples per pixel, and the error against a reference image
// rendered at many samples per pixel. Efficiency is 1 / (RMSE² × time): the usual Monte
// Carlo figure of merit, comparable between sampling strategies.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

export const DEFAULT_SCENES = [
  'scenes/pathtracer/hyperion_rect_lights.usda',
  'scenes/pathtracer/diningroom.usda',
  'scenes/pathtracer/renderman_teapot_tiles.usda',
  'scenes/pathtracer/test_material_disney_gold.usda',
  'scenes/pathtracer/bedroom.usda',
  'scenes/pathtracer/test_veach.usda',
  'scenes/pathtracer/tungsten-material-testball.usda',
  'scenes/pathtracer/light_guide_occlusion.usda',
];
/** Declared tolerance on the 8×8 block-mean RMSE of a high-sample render against the reference. */
export const BIAS_TOLERANCE = 0.01;
const BLOCK = 8;

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * RGB errors of an RGBA8 image against a reference, in [0, 1] display units: per-pixel RMSE
 * (noise and bias) and the RMSE of 8×8 block means, which averages noise out and exposes bias.
 */
export function imageError(candidate, reference) {
  const { width, height } = reference;
  if (candidate.width !== width || candidate.height !== height) throw new Error('Image dimensions differ.');
  const a = candidate.rgba, b = reference.rgba;
  let squared = 0;
  const bw = Math.ceil(width / BLOCK), bh = Math.ceil(height / BLOCK);
  const blocks = new Float64Array(bw * bh * 7);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      const block = (Math.floor(y / BLOCK) * bw + Math.floor(x / BLOCK)) * 7;
      for (let c = 0; c < 3; c++) {
        const d = (a[p + c] - b[p + c]) / 255;
        squared += d * d;
        blocks[block + c] += a[p + c] / 255;
        blocks[block + 3 + c] += b[p + c] / 255;
      }
      blocks[block + 6]++;
    }
  }
  let blockSquared = 0;
  for (let i = 0; i < bw * bh; i++) {
    const n = blocks[i * 7 + 6];
    for (let c = 0; c < 3; c++) {
      const d = (blocks[i * 7 + c] - blocks[i * 7 + 3 + c]) / n;
      blockSquared += d * d;
    }
  }
  return { rmse: Math.sqrt(squared / (width * height * 3)), blockRmse: Math.sqrt(blockSquared / (bw * bh * 3)) };
}

export function efficiency(rmse, ms) {
  return rmse > 0 && ms > 0 ? 1 / (rmse * rmse * ms) : Infinity;
}

/** Per-scene ratios of `current` over `baseline` (speed-ups > 1 are improvements). */
export function compareRuns(baseline, current) {
  return current.scenes.flatMap(scene => {
    const base = baseline.scenes.find(candidate => candidate.scene === scene.scene);
    if (!base || base.error || scene.error) return [];
    return [{
      scene: scene.scene,
      loadSpeedup: base.loadMs / scene.loadMs,
      firstPathTraceSpeedup: base.firstPathTraceMs / scene.firstPathTraceMs,
      captureSpeedup: base.captureMs / scene.captureMs,
      rmseRatio: scene.rmse / base.rmse,
      efficiencyGain: scene.efficiency / base.efficiency,
      bias: scene.bias,
    }];
  });
}

const fmt = (value, digits = 1) => value === undefined || value === null ? '—' : Number(value).toFixed(digits);

function table(run, comparison) {
  const lines = ['| Scène | Charg. ms | 1er raster ms | 1er PT ms | Capture ms | RMSE | Efficacité | Biais |', '|---|---:|---:|---:|---:|---:|---:|---:|'];
  for (const s of run.scenes) {
    if (s.error) { lines.push(`| ${basename(s.scene)} | erreur : ${s.error} |||||||`); continue; }
    lines.push(`| ${basename(s.scene)} | ${fmt(s.loadMs, 0)} | ${fmt(s.firstRasterMs, 0)} | ${fmt(s.firstPathTraceMs, 0)} | ${fmt(s.captureMs)} | ${fmt(s.rmse, 4)} | ${fmt(s.efficiency, 2)} | ${fmt(s.bias, 4)} |`);
  }
  if (comparison?.length) {
    lines.push('', '| Scène | Charg. × | 1er PT × | Capture × | RMSE ratio | Gain d’efficacité | Biais ≤ tolérance |', '|---|---:|---:|---:|---:|---:|---|');
    for (const c of comparison) {
      lines.push(`| ${basename(c.scene)} | ${fmt(c.loadSpeedup, 2)} | ${fmt(c.firstPathTraceSpeedup, 2)} | ${fmt(c.captureSpeedup, 2)} | ${fmt(c.rmseRatio, 3)} | ${fmt(c.efficiencyGain, 2)} | ${c.bias === undefined ? '—' : c.bias <= BIAS_TOLERANCE ? 'oui' : 'NON'} |`);
    }
  }
  return lines.join('\n');
}

const decode = image => ({ width: image.width, height: image.height, rgba: Buffer.from(image.rgba, 'base64') });

async function main() {
  const { values } = parseArgs({ options: {
    scenes: { type: 'string' }, res: { type: 'string', default: '128' }, spp: { type: 'string', default: '16' },
    repeats: { type: 'string', default: '5' }, 'reference-spp': { type: 'string', default: '1024' },
    label: { type: 'string', default: 'run' }, baseline: { type: 'string' }, 'update-references': { type: 'boolean' },
    'bias-check': { type: 'boolean' }, 'default-gpu': { type: 'boolean' }, 'browser-args': { type: 'string' },
    out: { type: 'string', default: 'bench-results' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Usage: npm run bench:engine -- [--scenes a.usda,b.usda] [--res 128] [--spp 16] [--repeats 5]\n' +
      '  [--reference-spp 1024] [--label name] [--baseline bench-results/base.json] [--bias-check] [--update-references]\n' +
      'References are rendered once per scene and resolution into <out>/references; --bias-check also renders\n' +
      `--reference-spp samples with the current code and reports the block-mean RMSE (tolerance ${BIAS_TOLERANCE}).\n` +
      'Chrome is started with --force_high_performance_gpu (discrete GPU); --default-gpu keeps its own choice.\n' +
      '--browser-args "..." appends Chrome switches (for example --enable-dawn-features=use_dxc).');
    return;
  }
  const root = fileURLToPath(new URL('../', import.meta.url));
  const scenes = values.scenes ? values.scenes.split(',').map(scene => scene.trim()).filter(Boolean) : DEFAULT_SCENES;
  const size = Number(values.res), samples = Number(values.spp), repeats = Number(values.repeats);
  const referenceSamples = Number(values['reference-spp']);
  const out = resolve(values.out);
  const references = join(out, 'references');
  await mkdir(references, { recursive: true });
  const { openExportSession } = await import('./export-browser-session.mjs');
  const session = await openExportSession({
    label: 'bench', browserModule: '/scripts/bench-engine-browser.ts', quiet: true,
    browserArgs: [...values['default-gpu'] ? [] : ['--force_high_performance_gpu'],
      ...(values['browser-args'] ?? '').split(' ').filter(Boolean)],
  });
  const run = { label: values.label, date: new Date().toISOString(), res: size, spp: samples, repeats, referenceSamples, scenes: [] };
  try {
    for (const scene of scenes) {
      const referenceFile = join(references, `${basename(scene).replace(/\.[^.]+$/, '')}-${size}.json`);
      const needsReference = values['update-references'] || !existsSync(referenceFile);
      console.log(`[bench] ${scene}${needsReference ? ' (rendering reference)' : ''}`);
      try {
        if (!session.alive) await session.restart();
        const result = await session.call('benchScene', [{
          scene: session.url(scene), width: size, height: size, samples, repeats,
          ...(needsReference || values['bias-check'] ? { referenceSamples } : {}),
        }], 60 * 60 * 1000);
        if (needsReference) await writeFile(referenceFile, JSON.stringify(result.reference));
        const reference = decode(JSON.parse(await readFile(referenceFile, 'utf8')));
        const captureMs = median(result.captureMs);
        const { rmse } = imageError(decode(result.image), reference);
        const bias = values['bias-check'] && !needsReference ? imageError(decode(result.reference), reference).blockRmse : undefined;
        run.scenes.push({
          scene, loadMs: result.loadMs, firstRasterMs: result.firstRasterMs, firstPathTraceMs: result.firstPathTraceMs,
          reloadToPathTraceMs: result.reloadToPathTraceMs, reloadPhases: result.reloadPhases, gpu: result.gpu,
          captureMs, captureMsAll: result.captureMs, rmse, efficiency: efficiency(rmse, captureMs),
          ...(bias !== undefined ? { bias } : {}), objects: result.objects, jsHeapBytes: result.jsHeapBytes,
          phases: result.phases, shaders: result.shaders, diagnostics: result.diagnostics,
        });
      } catch (error) {
        run.scenes.push({ scene, error: error.message.split('\n')[0] });
        console.error(`[bench] ${scene}: ${error.message.split('\n')[0]}`);
      }
    }
  } finally {
    await session.close();
  }
  const comparison = values.baseline ? compareRuns(JSON.parse(await readFile(values.baseline, 'utf8')), run) : undefined;
  if (comparison) run.comparison = comparison;
  const file = join(out, `${values.label}.json`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(run, null, 2)}\n`);
  console.log(`\n${table(run, comparison)}\n\n[bench] ${file}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`[bench] ${error.message}`); process.exitCode = 1; });
}
