import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  importLocalGltf: vi.fn(),
  loadUsdScene: vi.fn(),
  exportCompiledScene: vi.fn(),
}));
vi.mock('../../src/scene/local-gltf.ts', () => ({ importLocalGltf: mocks.importLocalGltf }));
vi.mock('../../src/render/usd-scene-assets.ts', () => ({ loadUsdScene: mocks.loadUsdScene }));
vi.mock('../../src/scene/compiled-scene.ts', () => ({
  exportCompiledScene: mocks.exportCompiledScene, exportCompiledMaterial: vi.fn(),
}));
vi.mock('../../src/scene/scene-catalog.ts', () => ({ SOURCE_SCENE_CATALOG: [] }));

import { compileScene } from '../../scripts/export-scene-browser.ts';

describe('browser scene exporter', () => {
  const dispose = vi.fn();
  const deleteDocuments = vi.fn();
  const options = { imported: { scene: 'imported' } };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.importLocalGltf.mockResolvedValue({ options, warnings: [], dispose });
    mocks.loadUsdScene.mockResolvedValue({ mtlx: { documents: { delete: deleteDocuments } } });
    mocks.exportCompiledScene.mockResolvedValue({ manifest: {}, files: new Map() });
  });

  it.each(['model.glb', 'model.gltf'])('imports %s through glTF before compilation', async name => {
    const url = `http://localhost/${name}?version=1`;
    await compileScene(url, 3);
    expect(mocks.importLocalGltf).toHaveBeenCalledWith([], undefined, url);
    expect(mocks.loadUsdScene).toHaveBeenCalledWith(url, expect.any(Function), expect.any(Function),
      expect.any(Map), { ...options, editableParameters: true });
    expect(mocks.exportCompiledScene).toHaveBeenCalled();
    expect(deleteDocuments).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('disposes imported glTF resources when loading fails', async () => {
    mocks.loadUsdScene.mockRejectedValue(new Error('load failed'));
    await expect(compileScene('http://localhost/model.glb')).rejects.toThrow('load failed');
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('continues loading USD directly', async () => {
    await compileScene('http://localhost/model.usda');
    expect(mocks.importLocalGltf).not.toHaveBeenCalled();
    expect(mocks.loadUsdScene).toHaveBeenCalledWith('http://localhost/model.usda', expect.any(Function),
      expect.any(Function), expect.any(Map), { editableParameters: true });
  });
});
