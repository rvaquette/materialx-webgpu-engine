import { describe, expect, it } from 'vitest';
import { importUsdStage } from '../../../src/usd/importer.ts';
import { pathTraceSettings } from '../../../src/render/pathtracing/scene-settings.ts';

async function settings(attributes: string) {
  const text = `#usda 1.0\n(defaultPrim = "World")\ndef Xform "World" { ${attributes} }`;
  const scene = await importUsdStage('scene.usda', { reader: { read: async () => text } });
  return pathTraceSettings(scene);
}

describe('converted path-tracer settings', () => {
  it('keeps ordinary USD defaults', async () => {
    expect(await settings('')).toEqual({ converted: false, maxDepth: 64, rouletteDepth: 3 });
  });
  it('honours converted depth and the earlier roulette start', async () => {
    expect(await settings('custom string pathtracer:sourceScene = "hyperion.scene"\ncustom int pathtracer:maxDepth = 3'))
      .toEqual({ converted: true, maxDepth: 3, rouletteDepth: 2 });
  });
  it('rejects invalid depth instead of silently clamping', async () => {
    await expect(settings('custom int pathtracer:maxDepth = -1')).rejects.toThrow('pathtracer:maxDepth');
  });
});
