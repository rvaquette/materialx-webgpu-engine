// Command-line batch renderer built on the public engine API (examples/engine/batch.ts).
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { openExportSession, root } from './export-browser-session.mjs';

const HELP = `Usage: npm run render:engine -- [--scene scene.usda] [--material a.mtlx ...] [--object /World/Prim]
  [--backend raster|pathtracing] [--samples 16] [--width 256] [--height 256] [--out renders]

Renders the scene with its USD materials, then once per --material on --object (the first object by
default), through MaterialXEngine.createHeadless() and capture() in headless Chrome/Edge (MX_CHROME).
Scene and material paths are relative to the project; PNG files are written to --out.`;

function projectPath(path, label) {
  const absolute = resolve(path);
  const inside = relative(root, absolute);
  if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new Error(`${label} must be inside the project: ${path}`);
  return inside.split(sep).join('/');
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`--${name} must be a positive integer.`);
  return number;
}

async function main() {
  const { values } = parseArgs({ options: {
    scene: { type: 'string', default: 'examples/engine/triangle.usda' },
    material: { type: 'string', multiple: true, default: [] },
    object: { type: 'string' },
    backend: { type: 'string', default: 'raster' },
    samples: { type: 'string', default: '16' },
    width: { type: 'string', default: '256' },
    height: { type: 'string', default: '256' },
    out: { type: 'string', default: 'renders' },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) { console.log(HELP); return; }
  if (values.backend !== 'raster' && values.backend !== 'pathtracing') throw new Error('--backend must be raster or pathtracing.');
  const scene = projectPath(values.scene, '--scene');
  if (!(await stat(join(root, scene))).isFile()) throw new Error(`Scene not found: ${values.scene}`);
  const materials = values.material.map(path => projectPath(path, '--material'));
  const width = positiveInteger(values.width, 'width');
  const height = positiveInteger(values.height, 'height');
  const capture = values.backend === 'pathtracing'
    ? { backend: 'pathtracing', samples: positiveInteger(values.samples, 'samples') } : { backend: 'raster' };
  const out = resolve(values.out);

  const session = await openExportSession({ label: 'render-engine', browserModule: '/examples/engine/batch.ts', quiet: true });
  try {
    const job = { scene: session.url(scene), materials: materials.map(session.url), width, height, capture,
      ...(values.object ? { object: values.object } : {}) };
    const result = await session.call('renderBatch', [job], 30 * 60 * 1000);
    await mkdir(out, { recursive: true });
    const stem = basename(scene, extname(scene));
    for (const [index, image] of result.images.entries()) {
      const name = index === 0 ? 'original' : basename(materials[index - 1], extname(materials[index - 1]));
      const file = join(out, `${stem}-${name}.png`);
      await writeFile(file, Buffer.from(image.png, 'base64'));
      console.log(`[render-engine] ${file}`);
    }
    console.log(`[render-engine] ${result.images.length} image(s) of ${result.object}, ${values.backend}, ${width}x${height}.`);
  } finally {
    await session.close();
  }
}

main().catch(error => { console.error(`[render-engine] ${error.message}`); process.exitCode = 1; });
