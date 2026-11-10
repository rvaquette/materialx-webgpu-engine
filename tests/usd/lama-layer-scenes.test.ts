import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { importUsdStage, type UsdLayerReader } from '../../src/usd/importer.ts';
import { importLights } from '../../src/usd/lights.ts';
import { packAnalyticLights } from '../../src/render/pathtracing/analytic-lights.ts';

const SCENE_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../scenes/pathtracer/lama');
const reader: UsdLayerReader = {
  async read(uri) {
    return readFile(resolve(SCENE_DIR, uri), 'utf8');
  },
};

describe('LamaLayer gold IOR scenes', () => {
  it('imports the editable IOR scene and resolves its material references', async () => {
    const scene = await importUsdStage(join(SCENE_DIR, 'lama_layer_gold_ior.usda'), { reader });
    const layeredMaterial = scene.materials.find((material) => material.primPath === '/World/Looks/layeredGold');

    expect(scene.stage.defaultPrim).toBe('World');
    expect(scene.prims.has('/World/Geometry/Teapot')).toBe(true);
    expect(scene.prims.has('/World/Geometry/Stand')).toBe(true);
    expect(layeredMaterial?.assetPath).toBe('./lama_layer_gold.mtlx');
    expect(layeredMaterial?.referencedPrimPath).toBe('/MaterialX/Materials/gold_ior');

    const lights = importLights(scene);
    const key = lights.find((light) => light.path === '/World/Lights/Key');
    const fill = lights.find((light) => light.path === '/World/Lights/Fill');
    const environment = lights.find((light) => light.type === 'dome');
    expect(environment?.textureFile).toBe('../HDR/photo_studio_01_1k.hdr');
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

    const materialDocument = await readFile(join(SCENE_DIR, 'lama_layer_gold.mtlx'), 'utf8');
    const dielectric = materialDocument.match(/<LamaDielectric name="dielectric"[^>]*>([\s\S]*?)<\/LamaDielectric>/)?.[1];
    expect(dielectric).toContain('<input name="IOR" type="float" value="1" uimin="1" uimax="3" engine_editable="true" />');
    expect(materialDocument.match(/<LamaDielectric\b/g)).toHaveLength(1);
    expect(materialDocument.match(/<LamaLayer\b/g)).toHaveLength(1);
    expect(materialDocument.match(/<LamaSurface\b/g)).toHaveLength(1);
    expect(materialDocument).toContain('<LamaSurface name="gold_ior" type="material">');
    const conductor = materialDocument.match(/<LamaConductor name="gold_base"[^>]*>([\s\S]*?)<\/LamaConductor>/)?.[1];
    expect(conductor).toContain('<input name="fresnelMode" type="integer" value="1" />');
    expect(conductor).toContain('<input name="roughness" type="float" value="0.22" />');
    expect(conductor).toContain('<input name="anisotropy" type="float" value="0" />');
    expect(conductor).toContain('<input name="tint" type="color3" value="1, 1, 1" />');
  });
});
