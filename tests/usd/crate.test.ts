import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../src/core/diagnostics.ts';
import { CrateReadError, flattenCrate, importCrate, type OpenUsdModule, type OpenUsdStage } from '../../src/usd/crate.ts';

const SAMPLE_USDA = `#usda 1.0
(
    defaultPrim = "World"
    upAxis = "Y"
)

def Xform "World"
{
    def Mesh "panel"
    {
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
        texCoord2f[] primvars:st (interpolation = "faceVarying") = [(0, 0), (1, 0), (0, 1)]
        rel material:binding = </World/mat>
    }

    def Camera "cam"
    {
        float focalLength = 35
        double3 xformOp:translate = (0, 0, 5)
        uniform token[] xformOpOrder = ["xformOp:translate"]
    }

    def RectLight "key"
    {
        float inputs:intensity = 500
    }
}
`;

interface Calls {
  created: string[];
  opened: string[];
  released: number;
  unlinked: string[];
}

function fakeModule(overrides: Partial<OpenUsdModule> & { usda?: string; errors?: string[] } = {}): {
  mod: OpenUsdModule;
  calls: Calls;
} {
  const calls: Calls = { created: [], opened: [], released: 0, unlinked: [] };
  const stage: OpenUsdStage = {
    ExportToString: () => overrides.usda ?? SAMPLE_USDA,
    GetCompositionErrors: () => overrides.errors ?? [],
  };
  const mod: OpenUsdModule = {
    FS_createDataFile: (_parent, name) => {
      calls.created.push(name);
      return {};
    },
    FS_unlink: (path) => {
      calls.unlinked.push(path);
    },
    OpenStage: (path) => {
      calls.opened.push(path);
      return stage;
    },
    ReleaseStage: () => {
      calls.released += 1;
      return true;
    },
    GetBuildInfoJson: () => '{}',
    ...overrides,
  };
  return { mod, calls };
}

const bytes = new Uint8Array([0x50, 0x58, 0x52, 0x2d, 0x55, 0x53, 0x44, 0x43]); // "PXR-USDC"

describe('OpenUSD-wasm crate reader', () => {
  it('flattens a crate through the module FS lifecycle', async () => {
    const { mod, calls } = fakeModule();
    const usda = await flattenCrate(bytes, 'assets/ShdrPlygrnd_Geo.usd', { loadModule: async () => mod });
    expect(usda).toContain('def Mesh "panel"');
    expect(calls.created).toEqual(['ShdrPlygrnd_Geo.usd']);
    expect(calls.opened).toEqual(['/ShdrPlygrnd_Geo.usd']);
    expect(calls.released).toBe(1);
    expect(calls.unlinked).toEqual(['/ShdrPlygrnd_Geo.usd']);
  });

  it('decodes meshes, cameras and lights into a SceneAsset', async () => {
    const { mod } = fakeModule();
    const scene = await importCrate(bytes, 'Geo.usd', { loadModule: async () => mod });

    expect(scene.stage.upAxis).toBe('Y');
    expect(scene.stage.defaultPrim).toBe('World');

    const mesh = scene.prims.get('/World/panel');
    expect(mesh?.typeName).toBe('Mesh');
    expect(mesh?.attributes.get('points')?.value).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(mesh?.attributes.get('faceVertexIndices')?.value).toEqual([0, 1, 2]);
    expect(mesh?.mesh?.primvars.some((p) => p.name === 'st')).toBe(true);
    expect(mesh?.materialBinding?.target).toBe('/World/mat');

    const cam = scene.prims.get('/World/cam');
    expect(cam?.typeName).toBe('Camera');
    expect(cam?.xformOps[0]?.op).toBe('xformOp:translate');

    const light = scene.prims.get('/World/key');
    expect(light?.typeName).toBe('RectLight');
    expect(light?.attributes.get('inputs:intensity')?.value).toBe(500);
  });

  it('reports composition errors through the sink without failing', async () => {
    const { mod } = fakeModule({ errors: ['bad reference /World/missing'] });
    const diagnostics: Diagnostic[] = [];
    const scene = await importCrate(bytes, 'Geo.usd', { loadModule: async () => mod, sink: (d) => diagnostics.push(d) });
    expect(scene.prims.has('/World/panel')).toBe(true);
    expect(diagnostics.some((d) => d.level === 'warning' && d.message.includes('Crate composition'))).toBe(true);
  });

  it('unlinks the FS entry even when the stage fails to open', async () => {
    const calls: string[] = [];
    const mod: OpenUsdModule = {
      FS_createDataFile: () => ({}),
      FS_unlink: (path) => calls.push(path),
      OpenStage: () => null as unknown as OpenUsdStage,
      ReleaseStage: () => true,
      GetBuildInfoJson: () => '{}',
    };
    await expect(flattenCrate(bytes, 'Geo.usd', { loadModule: async () => mod })).rejects.toBeInstanceOf(CrateReadError);
    expect(calls).toEqual(['/Geo.usd']);
  });
});
