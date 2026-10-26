import { describe, expect, it, vi } from 'vitest';
import { loadUsdScene, resolveMaterialTextureUrl, meshSourceFromScene } from '../../src/render/usd-scene-assets.ts';
import { composeStage } from '../../src/usd/compose.ts';
import { AssetResolver } from '../../src/assets/resolver.ts';

describe('browser USD scene loading', () => {
  it('anchors material texture paths at the document by default or at an explicit scene root', () => {
    const directory = 'https://example.test/playground/materials/';
    expect(resolveMaterialTextureUrl('textures/base.png', directory)).toBe(`${directory}textures/base.png`);
    expect(resolveMaterialTextureUrl('textures/base.png', directory, 'https://example.test/playground/'))
      .toBe('https://example.test/playground/textures/base.png');
    expect(resolveMaterialTextureUrl('https://cdn.test/base.png', directory, 'https://example.test/playground/'))
      .toBe('https://cdn.test/base.png');
  });

  it('preserves HTTP origins, authorship, dictionaries, escaped strings and relationship strength', async () => {
    const root = 'https://example.test/playground/';
    const layers = new Map([
      [`${root}stage.usda`, '#usda 1.0\n(subLayers = [@./materials/look.usda@])\ndef Xform "World" {}'],
      [`${root}materials/look.usda`, `#usda 1.0
over "World" {
  def Material "Mat" (prepend references = @./mat.mtlx@</MaterialX/Materials/Mat>) {}
  over "Declarations" {
    token outputs:mtlx:displacement
    token outputs:mtlx:volume
  }
  def Mesh "Mesh" (
    customData = { dictionary Maya = { string note = "a \\"quoted\\" value" } }
  ) {
    rel material:binding = </World/Mat> (bindMaterialAs = "weakerThanDescendants")
    float inputs:contrast = 2 (customData = { dictionary ui = { float2 range = (0, 2) } })
    point3f[] points = [(0,0,0),(1,0,0),(0,1,0)]
    normal3f[] normals = [(0,0,1)] (interpolation = "faceVarying")
    int[] normals:indices = [0,0,0]
    texCoord2f[] primvars:st = [(0,0),(1,0)] (interpolation = "faceVarying")
    int[] primvars:st:indices = [0,1,0]
    int[] faceVertexCounts = [3]
    int[] faceVertexIndices = [0,1,2]
  }
}`],
    ]);
    const scene = await composeStage(`${root}stage.usda`, {
      resolver: new AssetResolver({ rootUrl: root }),
      source: { fetchBytes: async url => {
        expect(layers.has(url)).toBe(true);
        return new TextEncoder().encode(layers.get(url)!);
      } },
    });
    expect(scene.materials[0]?.authoringLayer).toBe(`${root}materials/look.usda`);
    expect(scene.prims.get('/World/Mesh')?.materialBinding?.strength).toBe('weakerThanDescendants');
    expect(meshSourceFromScene(scene).meshFor('/World/Mesh')?.points).toHaveLength(9);
    expect(meshSourceFromScene(scene).meshFor('/World/Mesh')?.normals?.indices).toEqual([0, 0, 0]);
    expect(meshSourceFromScene(scene).meshFor('/World/Mesh')?.primvars?.[0]?.indices).toEqual([0, 1, 0]);
  });

  it('rejects failed sublayer loading instead of displaying a partial scene as success', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(
      '#usda 1.0\n(subLayers = [@missing.usd@])\ndef Xform "World" {}',
    )).mockResolvedValue(new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    const sink = vi.fn();
    try {
      await expect(loadUsdScene('https://example.test/stage.usda', sink)).rejects.toThrow('USD composition failed');
      expect(sink).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
    } finally { vi.unstubAllGlobals(); }
  });
});
