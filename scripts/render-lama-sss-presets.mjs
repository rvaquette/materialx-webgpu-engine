// Renders the LamaSSS teapot once per RenderMan Color/Radius preset on the local
// GPU. The presets are read from the engine:presets attributes of the scene
// MaterialX document; each one becomes a temporary stage under
// scenes/lama/sss/.tmp/ that run-usd-matrix-local.mjs path traces.
//
// Color and Radius are rendered in uniform parameter mode, so every preset uses
// the same WGSL shader and only its uniform values differ.
//
// Usage:  node scripts/render-lama-sss-presets.mjs [res] [spp]   (default 512 64)
// Env:    MX_PRESETS  comma-separated subset, e.g. "apple,skin1"
//         MX_MODES    comma-separated sssMode values (0 Davis, 1 exponential,
//                     2 Burley DMFP, 3 engine-only Burley from volumetric MFP);
//                     renders every preset in each
//                     mode into renders/lama-sss-modes/<preset>-mode<N>.png.
//                     The mode is compile-time, so each mode has its own shader.
//         MX_CDP_PORT and the other run-usd-matrix-local.mjs variables

import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RES = process.argv[2] ?? '512';
const SPP = process.argv[3] ?? '64';
const SCENE_DIR = new URL('../scenes/lama/sss/', import.meta.url);
const TEMP_DIR = new URL('.tmp/', SCENE_DIR);
const MODES = (process.env.MX_MODES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
if (MODES.some((mode) => !['0', '1', '2', '3'].includes(mode))) throw new Error('MX_MODES values must be 0, 1, 2 or 3');
const OUT_DIR = new URL(MODES.length ? '../renders/lama-sss-modes/' : '../renders/lama-sss-presets/', import.meta.url);
const STEM = 'lama_sss_color_radius';
const log = (m) => console.log(`[lama-sss-presets] ${m}`);

const mtlx = readFileSync(new URL(`${STEM}.mtlx`, SCENE_DIR), 'utf8');
const usda = readFileSync(new URL(`${STEM}.usda`, SCENE_DIR), 'utf8');

function inputPresets(name) {
  const element = mtlx.match(new RegExp(`<input name="${name}"[^>]*/>`))?.[0];
  const spec = element?.match(/engine:presets="([^"]+)"/)?.[1];
  if (!spec) throw new Error(`missing engine:presets on ${name}`);
  return { element, presets: new Map(spec.split(';').map((entry) => {
    const [preset, values] = entry.split('=').map((part) => part.trim());
    return [preset, values.split(',').map((value) => value.trim()).join(', ')];
  })) };
}

const color = inputPresets('color');
const radius = inputPresets('sssRadius');
const filter = (process.env.MX_PRESETS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const names = [...color.presets.keys()].filter((name) => filter.length === 0 || filter.includes(name));
const unknown = filter.filter((name) => !color.presets.has(name));
if (unknown.length) throw new Error(`unknown preset(s): ${unknown.join(', ')}`);

const withValue = (element, value) => element.replace(/ value="[^"]*"/, ` value="${value}"`);
// Variants live one directory deeper, so every relative asset gains one "../".
const nestedUsda = usda.replace(/@\.\.\//g, '@../../').replace(`@./${STEM}.mtlx@`, '@./VARIANT.mtlx@');

rmSync(TEMP_DIR, { recursive: true, force: true });
mkdirSync(TEMP_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });
const variants = names.flatMap((name) => (MODES.length ? MODES : [undefined]).map((mode) => {
  const label = `${name.replace(/[^a-zA-Z0-9]+/g, '_')}${mode === undefined ? '' : `-mode${mode}`}`;
  const slug = `${STEM}-${label}`;
  let document = mtlx
    .replace(color.element, withValue(color.element, color.presets.get(name)))
    .replace(radius.element, withValue(radius.element, radius.presets.get(name)));
  if (mode !== undefined) {
    document = document.replace(/(\n(\s*)<input name="sssUnitLength"[^>]*\/>)/, `$1\n$2<input name="sssMode" type="integer" value="${mode}" />`);
    if (!document.includes('name="sssMode"')) throw new Error('could not insert sssMode');
  }
  writeFileSync(new URL(`${slug}.mtlx`, TEMP_DIR), document);
  writeFileSync(new URL(`${slug}.usda`, TEMP_DIR), nestedUsda.replace('VARIANT', slug));
  return { name: label, slug };
}));

function render() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('run-usd-matrix-local.mjs', import.meta.url)), RES, SPP], {
      stdio: 'inherit',
      env: {
        ...process.env,
        MX_BACKENDS: 'pathtracing',
        MX_CDP_PORT: process.env.MX_CDP_PORT ?? '9333',
        MX_HARNESS_QUERY: process.env.MX_HARNESS_QUERY ?? 'params=uniform',
        MX_ENTRIES: variants.map(({ slug }) => `/scenes/lama/sss/.tmp/${slug}.usda`).join(','),
      },
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

let code = 1;
try {
  log(`${variants.length} render(s) @ ${RES}x${RES}, ${SPP} spp`);
  code = await render();
} finally {
  rmSync(TEMP_DIR, { recursive: true, force: true });
}
for (const { name, slug } of variants) {
  const source = new URL(`../renders/local-${slug}-pathtracing.png`, import.meta.url);
  if (!existsSync(source)) continue;
  const target = new URL(`${name}.png`, OUT_DIR);
  copyFileSync(source, target);
  rmSync(source);
  log(`${name} -> ${fileURLToPath(target)}`);
}
process.exit(code);
