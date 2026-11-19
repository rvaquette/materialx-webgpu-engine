import { afterEach, expect, it, vi } from 'vitest';
import { loadMaterialXCore } from '../../src/materialx/wasm.ts';
import { loadSharedMaterialXLibraries, MaterialXLibraries } from '../../src/materialx/libraries.ts';
import { loadMaterialXDocuments } from '../../src/materialx/document-source.ts';
import { loadMtlxSceneContext } from '../../src/render/usd-scene-assets.ts';
import { lowerPreviewSurfaceMaterials } from '../../src/usd/preview-surface.ts';

vi.mock('../../src/materialx/wasm.ts', () => ({ loadMaterialXCore: vi.fn() }));
vi.mock('../../src/materialx/libraries.ts', { spy: true });
vi.mock('../../src/materialx/document-source.ts', { spy: true });
vi.mock('../../src/usd/preview-surface.ts', { spy: true });

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it('loads the MaterialX module and WASM from the core directory and uses the separate library directory', async () => {
  const entry = 'https://app.example.test/scenes/triangle.usda';
  const coreRoot = 'https://cdn.example.test/core/';
  const libraryRoot = 'https://app.example.test/shared/mtlx/';
  vi.stubGlobal('document', { baseURI: 'https://app.example.test/host/' });
  vi.mocked(loadSharedMaterialXLibraries).mockImplementationOnce(async core => new MaterialXLibraries(core));
  await loadMtlxSceneContext(
    { entry, stage: { subLayers: [] }, roots: [], prims: new Map(), materials: [] },
    entry, vi.fn(), undefined, undefined, undefined,
    { materialxCore: coreRoot, materialxLibraries: libraryRoot },
  );
  const options = vi.mocked(loadMaterialXCore).mock.calls[0]?.[0];
  expect(options?.moduleUrl).toBe(`${coreRoot}JsMaterialXCore.js`);
  expect(options?.locateFile?.('JsMaterialXCore.wasm', '')).toBe(`${coreRoot}JsMaterialXCore.wasm`);
  expect(loadSharedMaterialXLibraries).toHaveBeenCalledOnce();
  const sources = vi.mocked(loadSharedMaterialXLibraries).mock.calls[0]?.[1].sources ?? [];
  expect(sources.length).toBeGreaterThan(0);
  expect(sources.every(source => source.url === `${libraryRoot}${source.name}`)).toBe(true);
});

it('resolves export texture candidates when a relative scene also contains USD preview materials', async () => {
  const entry = 'scenes/model/scene.usda';
  const material = { primPath: '/Mat', assetPath: 'looks/mat.mtlx',
    referencedPrimPath: '/MaterialX/Materials/mat', materialName: 'mat' };
  vi.stubGlobal('document', { baseURI: 'https://app.example.test/viewer/' });
  vi.stubGlobal('DOMParser', class {
    parseFromString() { return { querySelector: () => null, querySelectorAll: () => [] }; }
  });
  vi.stubGlobal('XMLSerializer', class { serializeToString() { return '<materialx />'; } });
  vi.mocked(lowerPreviewSurfaceMaterials).mockReturnValueOnce([{
    reference: { ...material, primPath: '/Preview', assetPath: 'usdpreview:/Preview' },
    xml: '<materialx />', textureFiles: [],
  }]);
  vi.mocked(loadSharedMaterialXLibraries).mockImplementationOnce(async core => new MaterialXLibraries(core));
  vi.mocked(loadMaterialXDocuments).mockResolvedValueOnce({ documentFor: () => undefined, delete() {} });
  const context = await loadMtlxSceneContext(
    { entry, stage: { subLayers: [] }, roots: [], prims: new Map(), materials: [material] },
    entry, vi.fn(), undefined, undefined, new Map([['looks/mat.mtlx', '<materialx />']]),
  );
  expect(context.imageProvider.exportSource?.('base.png')?.urls).toEqual([
    'https://app.example.test/viewer/scenes/model/looks/base.png',
    'https://app.example.test/viewer/scenes/model/base.png',
  ]);
  expect(context.imageProvider.exportSource?.('https://cdn.example.test/base.png')?.urls)
    .toEqual(['https://cdn.example.test/base.png']);
});
