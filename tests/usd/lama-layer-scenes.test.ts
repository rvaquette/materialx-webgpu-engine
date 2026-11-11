import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { importUsdStage, type UsdLayerReader } from '../../src/usd/importer.ts';
import { importLights } from '../../src/usd/lights.ts';
import { packAnalyticLights } from '../../src/render/pathtracing/analytic-lights.ts';

const SCENE_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../scenes/lama');
const ADD_DIR = join(SCENE_DIR, 'add');
const LAYER_DIR = join(SCENE_DIR, 'layer');
const MIX_DIR = join(SCENE_DIR, 'mix');
const MODES = [
  { mode: 'fresnel_blend', scene: 'lama_layer_gold_fresnel_blend.usda', material: 'gold_fresnel_blend' },
  { mode: 'smooth_coating', scene: 'lama_layer_gold_smooth_coating.usda', material: 'gold_smooth_coating' },
  { mode: 'rough_coating', scene: 'lama_layer_gold_rough_coating.usda', material: 'gold_rough_coating' },
  { mode: 'auto', scene: 'lama_layer_gold_auto.usda', material: 'gold_auto' },
] as const;
const reader: UsdLayerReader = {
  async read(uri) {
    return readFile(resolve(SCENE_DIR, uri), 'utf8');
  },
};

describe('LamaLayer gold IOR scenes', () => {
  it('imports every conductor parameter scene with valid material assets and the common camera', async () => {
    const directory = join(SCENE_DIR, 'conductor');
    const coverage = JSON.parse(await readFile(join(directory, 'coverage.json'), 'utf8')) as { scene: string; parameter: string; status: string }[];
    expect(coverage).toHaveLength(21);
    expect(coverage.filter(example => example.status === 'unsupported')).toHaveLength(4);
    const reference = await importUsdStage(join(LAYER_DIR, 'lama_layer_gold_rough_coating.usda'), { reader });
    for (const example of coverage) {
      const scene = await importUsdStage(join(directory, example.scene), { reader });
      const name = `conductor_${example.parameter}`;
      const material = scene.materials.find(entry => entry.primPath === `/World/Looks/${name}`);
      expect(material?.assetPath, example.parameter).toBe('./materials.mtlx');
      expect(material?.referencedPrimPath, example.parameter).toBe(`/MaterialX/Materials/${name}`);
      expect(scene.prims.get('/World/Camera')?.attributes, example.parameter)
        .toEqual(reference.prims.get('/World/Camera')?.attributes);
      for (const entry of scene.materials) {
        if (entry.assetPath) await access(resolve(directory, entry.assetPath));
      }
    }
    for (const asset of ['background.obj', 'teapot.obj', 'teapot_base.obj']) {
      await access(resolve(directory, '../../pathtracer/renderman', asset));
    }
    await access(resolve(directory, '../../pathtracer/HDR/photo_studio_01_1k.hdr'));
  });

  it('imports the editable gold/blue LamaMix scene with the common Lama camera', async () => {
    const scene = await importUsdStage(join(MIX_DIR, 'lama_mix_gold_blue.usda'), { reader });
    const material = scene.materials.find((entry) => entry.primPath === '/World/Looks/gold_blue');
    expect(material?.assetPath).toBe('./lama_mix_gold_blue.mtlx');
    expect(material?.referencedPrimPath).toBe('/MaterialX/Materials/gold_blue');
    expect(scene.prims.has('/World/Geometry/Teapot')).toBe(true);
    expect(scene.prims.has('/World/Geometry/Stand')).toBe(true);
    const reference = await importUsdStage(join(LAYER_DIR, 'lama_layer_gold_rough_coating.usda'), { reader });
    expect(scene.prims.get('/World/Camera')?.attributes)
      .toEqual(reference.prims.get('/World/Camera')?.attributes);
    const document = await readFile(join(MIX_DIR, 'lama_mix_gold_blue.mtlx'), 'utf8');
    expect(document).toContain('<LamaMix name="gold_blue_mix" type="BSDF">');
    expect(document).toContain('<input name="material1" type="BSDF" nodename="gold" />');
    expect(document).toContain('<input name="material2" type="BSDF" nodename="blue" />');
    expect(document).toContain('<input name="mix" type="float" value="0.5" uimin="0" uimax="1" engine:editable="true" />');
  });

  it('imports the yellow LamaAdd scene with its textured diffuse and dielectric branches', async () => {
    const scene = await importUsdStage(join(ADD_DIR, 'lama_add_yellow.usda'), { reader });
    const material = scene.materials.find((entry) => entry.primPath === '/World/Looks/yellow');
    expect(material?.assetPath).toBe('./lama_add_yellow.mtlx');
    expect(material?.referencedPrimPath).toBe('/MaterialX/Materials/yellow');
    expect(scene.prims.has('/World/Geometry/Teapot')).toBe(true);
    expect(scene.prims.has('/World/Geometry/Stand')).toBe(true);
    expect(scene.prims.get('/World')?.attributes.get('pathtracer:environmentIntensity')?.value).toBe(0);
    const reference = await importUsdStage(join(LAYER_DIR, 'lama_layer_gold_rough_coating.usda'), { reader });
    expect(scene.prims.get('/World/Camera')?.attributes)
      .toEqual(reference.prims.get('/World/Camera')?.attributes);
    for (const name of ['Teapot', 'Stand']) {
      expect(scene.prims.get(`/World/Geometry/${name}`)?.attributes.has('xformOp:transform')).toBe(false);
    }
    const document = await readFile(join(ADD_DIR, 'lama_add_yellow.mtlx'), 'utf8');
    expect(document).toContain('<LamaAdd name="yellow_add" type="BSDF">');
    expect(document).toContain('<input name="material1" type="BSDF" nodename="yellow_diffuse" />');
    expect(document).toContain('<input name="material2" type="BSDF" nodename="glossy_reflection" />');
    expect(document).toContain('../../pathtracer/renderman/textures/gold_base.png');
  });

  it('imports the verdigris scene with the same layered patina on the teapot and stand', async () => {
    const scene = await importUsdStage(join(LAYER_DIR, 'lama_layer_verdigris.usda'), { reader });
    const material = scene.materials.find((entry) => entry.primPath === '/World/Looks/verdigris');
    expect(material?.assetPath).toBe('./lama_layer_verdigris.mtlx');
    expect(material?.referencedPrimPath).toBe('/MaterialX/Materials/verdigris');
    expect(scene.prims.has('/World/Geometry/Teapot')).toBe(true);
    expect(scene.prims.has('/World/Geometry/Stand')).toBe(true);
    const document = await readFile(join(LAYER_DIR, 'lama_layer_verdigris.mtlx'), 'utf8');
    expect(document).toContain('<LamaLayer name="patina_layer" type="BSDF" engine:layerMode="rough_coating"');
    expect(document).toContain('<input name="materialBase" type="BSDF" nodename="weathered_metal" />');
    expect(document).toContain('<input name="mix" type="float" nodename="patina_mask" />');
    expect(document).toContain('<fractal3d name="corrosion" type="float">');
  });

  it.each(MODES)('imports the $mode teapot scene and resolves its material reference', async ({ scene: sceneFile, material, mode }) => {
    const scene = await importUsdStage(join(LAYER_DIR, sceneFile), { reader });
    const layeredMaterial = scene.materials.find((material) => material.primPath === '/World/Looks/layeredGold');

    expect(scene.stage.defaultPrim).toBe('World');
    expect(scene.prims.has('/World/Geometry/Teapot')).toBe(true);
    expect(scene.prims.has('/World/Geometry/Stand')).toBe(true);
    expect(layeredMaterial?.assetPath).toBe('./lama_layer_gold_modes.mtlx');
    expect(layeredMaterial?.referencedPrimPath).toBe(`/MaterialX/Materials/${material}`);

    const lights = importLights(scene);
    const key = lights.find((light) => light.path === '/World/Lights/Key');
    const fill = lights.find((light) => light.path === '/World/Lights/Fill');
    const environment = lights.find((light) => light.type === 'dome');
    expect(environment?.textureFile).toBe('../../pathtracer/HDR/photo_studio_01_1k.hdr');
    expect(environment?.intensity).toBe(0.06);
    expect(key?.type).toBe('rect');
    expect(key?.width).toBe(0.18);
    expect(key?.height).toBe(0.35);
    expect(key?.intensity).toBe(10);
    expect(fill?.intensity).toBe(2.5);
    expect(scene.prims.get('/World')?.attributes.get('pathtracer:environmentIntensity')?.value).toBe(0.06);
    if (!key) throw new Error('Missing vertical key light');
    const packed = packAnalyticLights([key]);
    // The softbox is upright and its emitting side faces the teapot at the origin.
    expect(Array.from(packed.slice(12, 15))).toEqual([0, expect.closeTo(0.35, 6), 0]);
    expect(packed[17]).toBe(0);
    expect(packed[16]! * -packed[0]! + packed[18]! * -packed[2]!).toBeGreaterThan(0);

    const materialDocument = await readFile(join(LAYER_DIR, 'lama_layer_gold_modes.mtlx'), 'utf8');
    const dielectric = materialDocument.match(/<LamaDielectric name="dielectric"[^>]*>([\s\S]*?)<\/LamaDielectric>/)?.[1];
    expect(dielectric).toContain('<input name="IOR" type="float" value="1.5" uimin="1" uimax="3" engine:editable="true" />');
    expect(materialDocument.match(/<LamaDielectric\b/g)).toHaveLength(1);
    expect(materialDocument.match(/<LamaLayer\b/g)).toHaveLength(4);
    expect(materialDocument.match(/<LamaSurface\b/g)).toHaveLength(4);
    expect(materialDocument).toContain(`<LamaLayer name="layer_${mode}" type="BSDF" engine:layerMode="${mode}" engine:topThickness="0">`);
    expect(materialDocument).toContain(`<LamaSurface name="${material}" type="material">`);
    const conductor = materialDocument.match(/<LamaConductor name="gold_base"[^>]*>([\s\S]*?)<\/LamaConductor>/)?.[1];
    expect(conductor).toContain('<input name="fresnelMode" type="integer" value="1" />');
    expect(conductor).toContain('<input name="roughness" type="float" value="0.22" />');
    expect(conductor).toContain('<input name="anisotropy" type="float" value="0" />');
    expect(conductor).toContain('<input name="tint" type="color3" value="1, 1, 1" />');
  });
});
