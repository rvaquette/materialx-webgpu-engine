import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importUsdStage } from '../../src/usd/importer.ts';
import { lowerPreviewSurfaceMaterials } from '../../src/usd/preview-surface.ts';

describe('USD PreviewSurface texture coordinates', () => {
  it('preserves bottom-left UVs so MaterialX image lowering flips V exactly once', async () => {
    const root = resolve('scenes', 'standard-shader-ball');
    const scene = await importUsdStage('standard-shader-ball.usda', {
      reader: { read: uri => readFile(resolve(root, uri), 'utf8') },
    });
    const ground = lowerPreviewSurfaceMaterials(scene).find(material =>
      material.textureFiles.includes('textures/ground.png'))!;
    expect(ground).toBeDefined();
    expect(ground.xml).toContain('<texcoord name="st_raw" type="vector2" />');
    expect(ground.xml).toContain('<input name="texcoord" type="vector2" nodename="st_raw" />');
    expect(ground.xml).not.toContain('st_flip');
    expect(ground.xml).not.toContain('st_mul');
    expect(ground.xml).not.toContain('value="1, -1"');
  });
});
