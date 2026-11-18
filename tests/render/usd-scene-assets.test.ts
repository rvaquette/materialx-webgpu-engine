import { afterEach, expect, it, vi } from 'vitest';
import { loadMaterialXCore } from '../../src/materialx/wasm.ts';
import { loadSharedMaterialXLibraries, MaterialXLibraries } from '../../src/materialx/libraries.ts';
import { loadMtlxSceneContext } from '../../src/render/usd-scene-assets.ts';

vi.mock('../../src/materialx/wasm.ts', () => ({ loadMaterialXCore: vi.fn() }));
vi.mock('../../src/materialx/libraries.ts', { spy: true });

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
