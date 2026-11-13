import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const unsupported = 'RenderMan renderer feature switch is not represented by the MaterialX LamaSurface NodeDef or implemented by this engine.';
export const SURFACE_CASES = [
  { id: 'material_sides', label: 'Material Sides - Front / Back', cards: true, back: true },
  { id: 'material_front', label: 'Material Front' },
  { id: 'material_back', label: 'Material Back', cards: true, back: true },
  { id: 'presence', label: 'Presence - Connected Pattern', pattern: true },
  { id: 'compute_presence', label: 'Compute Presence - NOT SUPPORTED', pattern: true, reason: unsupported },
  { id: 'compute_opacity', label: 'Compute Opacity - NOT SUPPORTED', closure: 'glass', reason: unsupported },
  { id: 'presence_opacity_cached', label: 'Presence / Opacity Cached - NOT SUPPORTED', pattern: true, reason: unsupported },
  { id: 'compute_subsurface', label: 'Compute Subsurface - NOT SUPPORTED', closure: 'sss', reason: unsupported },
  { id: 'compute_interior', label: 'Compute Interior - NOT SUPPORTED', closure: 'glass', reason: unsupported },
];

const cards = `
        def Mesh "FrontCard"
        {
            point3f[] points = [(0.14, 0.035, -0.06), (0.14, 0.105, -0.06), (0.14, 0.105, -0.005), (0.14, 0.035, -0.005)]
            int[] faceVertexCounts = [4]
            int[] faceVertexIndices = [0, 1, 2, 3]
            rel material:binding = </World/Looks/lamaSurface>
        }
        def Mesh "BackCard"
        {
            point3f[] points = [(0.14, 0.035, 0.005), (0.14, 0.105, 0.005), (0.14, 0.105, 0.06), (0.14, 0.035, 0.06)]
            int[] faceVertexCounts = [4]
            int[] faceVertexIndices = [3, 2, 1, 0]
            rel material:binding = </World/Looks/lamaSurface>
        }
`;

export async function buildLamaSurfaceScenes(root = new URL('../', import.meta.url)) {
  const directory = new URL('scenes/lama/surface/', root);
  await mkdir(directory, { recursive: true });
  const template = (await readFile(new URL('scenes/lama/layer/lama_layer_gold_rough_coating.usda', root), 'utf8')).replaceAll('\r\n', '\n');
  const nodes = [];
  for (const example of SURFACE_CASES) {
    const material = `surface_${example.id}`;
    const front = example.closure ?? 'front';
    nodes.push(`  <LamaSurface name="${material}" type="material">
    <input name="materialFront" type="BSDF" nodename="${front}" />${example.back ? '\n    <input name="materialBack" type="BSDF" nodename="back" />' : ''}
    <input name="presence" type="float" ${example.pattern ? 'nodename="mask"' : 'value="1"'} />
  </LamaSurface>`);
    let stage = template
      .replace('Rough gold base with dielectric top, LamaLayer Rough Coating', `${example.label}${example.reason ? `: ${example.reason}` : ''}`)
      .replaceAll('@./lama_layer_gold_modes.mtlx@', '@../layer/lama_layer_gold_modes.mtlx@')
      .replace(/        def Material "layeredGold"[^\n]*/, `        def Material "lamaSurface" (prepend references = @./materials.mtlx@</MaterialX/Materials/${material}>) {}`)
      .replaceAll('/World/Looks/layeredGold', '/World/Looks/lamaSurface');
    if (example.cards) stage = stage.replace('    }\n\n    def Scope "Lights"', `${cards}    }\n\n    def Scope "Lights"`);
    await writeFile(new URL(`${material}.usda`, directory), stage);
  }
  const shared = `  <LamaDiffuse name="front" type="BSDF">
    <input name="color" type="color3" value="0.8, 0.12, 0.08" />
  </LamaDiffuse>
  <LamaDiffuse name="back" type="BSDF">
    <input name="color" type="color3" value="0.08, 0.25, 0.8" />
  </LamaDiffuse>
  <LamaDielectric name="glass" type="BSDF">
    <input name="IOR" type="float" value="1.5" />
    <input name="roughness" type="float" value="0.1" />
  </LamaDielectric>
  <LamaSSS name="sss" type="BSDF">
    <input name="color" type="color3" value="0.8, 0.35, 0.2" />
    <input name="sssRadius" type="color3" value="1, 0.4, 0.2" />
    <input name="sssUnitLength" type="float" value="0.001" />
  </LamaSSS>
  <checkerboard name="checker" type="color3">
    <input name="uvtiling" type="vector2" value="8, 8" />
  </checkerboard>
  <extract name="mask" type="float">
    <input name="in" type="color3" nodename="checker" />
    <input name="index" type="integer" value="0" />
  </extract>`;
  await writeFile(new URL('materials.mtlx', directory), `<?xml version="1.0"?>\n<materialx version="1.39" colorspace="lin_rec709">\n${shared}\n${nodes.join('\n')}\n</materialx>\n`);
  await writeFile(new URL('coverage.json', directory), `${JSON.stringify(SURFACE_CASES.map(example => ({
    parameter: example.id, scene: `surface_${example.id}.usda`, label: example.label,
    status: example.reason ? 'unsupported' : 'implemented',
    ...(example.reason ? { reason: example.reason } : {}),
  })), null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildLamaSurfaceScenes();
  console.log(`Generated ${SURFACE_CASES.length} LamaSurface scenes (${SURFACE_CASES.filter(example => example.reason).length} explicitly unsupported).`);
}
