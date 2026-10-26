import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../src/core/diagnostics.ts';
import { AssetResolver } from '../../src/assets/resolver.ts';
import type { OpenUsdModule, OpenUsdStage } from '../../src/usd/crate.ts';
import { composeStage, createCrateAwareReader, type AssetByteSource } from '../../src/usd/compose.ts';

const MAGIC = 'PXR-USDC';
const ROOT = 'mem://root';

function textBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Crate payload = magic prefix + flattened USDA text, so the fake module can echo it back. */
function crateBytes(usda: string): Uint8Array {
  const magic = new TextEncoder().encode(MAGIC);
  const body = new TextEncoder().encode(usda);
  const out = new Uint8Array(magic.length + body.length);
  out.set(magic, 0);
  out.set(body, magic.length);
  return out;
}

/** OpenUSD-wasm stand-in: ExportToString echoes the stored crate body (sans magic). */
function fakeCrateModule(): OpenUsdModule {
  const files = new Map<string, Uint8Array>();
  let current: string | null = null;
  const stageFor = (path: string): OpenUsdStage => ({
    GetRootLayer: () => ({ ExportToString: () => new TextDecoder().decode(files.get(path)!.subarray(MAGIC.length)) }),
    ExportToString: () => new TextDecoder().decode(files.get(path)!.subarray(MAGIC.length)),
    GetCompositionErrors: () => [],
  });
  return {
    FS_createDataFile: (_parent, name, data) => {
      files.set(`/${name}`, data);
      return {};
    },
    FS_unlink: (path) => {
      files.delete(path);
    },
    OpenStage: (path) => {
      current = path;
      return stageFor(current);
    },
    ReleaseStage: () => true,
    GetBuildInfoJson: () => '{}',
  };
}

function source(bytesByUrl: Record<string, Uint8Array>): AssetByteSource {
  return {
    async fetchBytes(url: string): Promise<Uint8Array> {
      const bytes = bytesByUrl[url];
      if (!bytes) throw new Error(`404 ${url}`);
      return bytes;
    },
  };
}

function collect(): { sink: (d: Diagnostic) => void; messages: Diagnostic[] } {
  const messages: Diagnostic[] = [];
  return { sink: (d) => messages.push(d), messages };
}

describe('composeStage (T049)', () => {
  it('resolves text subLayers through the asset root', async () => {
    const { sink, messages } = collect();
    const resolver = new AssetResolver({ rootUrl: ROOT, onDiagnostic: sink });
    const bytes = {
      [`${ROOT}/stage.usda`]: textBytes(`#usda 1.0
(
    defaultPrim = "World"
    upAxis = "Y"
    subLayers = [ @geo.usda@ ]
)
def Xform "World" {
}
`),
      [`${ROOT}/geo.usda`]: textBytes(`#usda 1.0
over "World" {
    def Mesh "floor" {
        token subdivisionScheme = "catmullClark"
        float2[] primvars:st (interpolation = "vertex") = [(0, 0), (1, 1)]
    }
}
`),
    };
    const asset = await composeStage('stage.usda', { resolver, source: source(bytes), sink });
    expect(asset.stage.defaultPrim).toBe('World');
    expect(asset.stage.subLayers).toEqual(['geo.usda']);
    const floor = asset.prims.get('/World/floor');
    expect(floor?.typeName).toBe('Mesh');
    expect(floor?.mesh?.subdivisionScheme).toBe('catmullClark');
    expect(messages.some((m) => m.level === 'error')).toBe(false);
  });

  it('flattens a binary crate subLayer and composes it at root', async () => {
    const { sink } = collect();
    const resolver = new AssetResolver({ rootUrl: ROOT, onDiagnostic: sink });
    const bytes = {
      [`${ROOT}/stage.usda`]: textBytes(`#usda 1.0
(
    defaultPrim = "World"
    subLayers = [ @assets/geo.usd@ ]
)
def Xform "World" {
}
`),
      [`${ROOT}/assets/geo.usd`]: crateBytes(`#usda 1.0
over "World" {
    def Mesh "panel" {
        int[] faceVertexCounts = [3]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
    }
}
`),
    };
    const asset = await composeStage('stage.usda', {
      resolver,
      source: source(bytes),
      loadCrateModule: async () => fakeCrateModule(),
      sink,
    });
    const panel = asset.prims.get('/World/panel');
    expect(panel?.typeName).toBe('Mesh');
    expect(panel?.attributes.get('points')).toBeDefined();
  });

  it('grafts a crate payload under the payload prim', async () => {
    const { sink, messages } = collect();
    const resolver = new AssetResolver({ rootUrl: ROOT, onDiagnostic: sink });
    const bytes = {
      [`${ROOT}/stage.usda`]: textBytes(`#usda 1.0
(
    defaultPrim = "World"
)
def Xform "World" {
    def Xform "lightRig" (
        prepend payload = @lights/lightRig.usd@
    ) {
    }
}
`),
      [`${ROOT}/lights/lightRig.usd`]: crateBytes(`#usda 1.0
(
    defaultPrim = "lightRig"
)
def Xform "lightRig" {
    def RectLight "key" {
        float inputs:intensity = 500
    }
}
`),
    };
    const asset = await composeStage('stage.usda', {
      resolver,
      source: source(bytes),
      loadCrateModule: async () => fakeCrateModule(),
      sink,
    });
    const rig = asset.prims.get('/World/lightRig')!;
    expect(rig.children).toContain('/World/lightRig/key');
    const key = asset.prims.get('/World/lightRig/key');
    expect(key?.typeName).toBe('RectLight');
    expect(key?.attributes.get('inputs:intensity')?.value).toBe(500);
    expect(messages.some((m) => m.message.includes('Composed payload arc'))).toBe(true);
  });

  it('grafts a crate reference at a target prim path', async () => {
    const { sink } = collect();
    const resolver = new AssetResolver({ rootUrl: ROOT, onDiagnostic: sink });
    const bytes = {
      [`${ROOT}/stage.usda`]: textBytes(`#usda 1.0
def Xform "World" {
    def "proxy" (
        prepend references = @assets/geo.usd@</World>
    ) {
    }
}
`),
      [`${ROOT}/assets/geo.usd`]: crateBytes(`#usda 1.0
def Xform "World" {
    def Mesh "panel" {
        int[] faceVertexCounts = [3]
    }
}
`),
    };
    const asset = await composeStage('stage.usda', {
      resolver,
      source: source(bytes),
      loadCrateModule: async () => fakeCrateModule(),
      sink,
    });
    const proxy = asset.prims.get('/World/proxy')!;
    expect(proxy.children).toContain('/World/proxy/panel');
    expect(asset.prims.get('/World/proxy/panel')?.typeName).toBe('Mesh');
  });

  it('reports an out-of-policy local path and does not silently remap it', async () => {
    const { sink, messages } = collect();
    const resolver = new AssetResolver({ rootUrl: ROOT, onDiagnostic: sink });
    const bytes = {
      [`${ROOT}/stage.usda`]: textBytes(`#usda 1.0
(
    subLayers = [ @/abs/secret.usda@ ]
)
def Xform "World" {
}
`),
    };
    const asset = await composeStage('stage.usda', { resolver, source: source(bytes), sink });
    // Entry still composes; the out-of-policy subLayer is dropped with a diagnostic.
    expect(asset.prims.get('/World')).toBeDefined();
    expect(messages.some((m) => m.level === 'error' && m.message.includes('cannot be opened by the browser'))).toBe(true);
    expect(asset.prims.has('/abs')).toBe(false);
  });

  it('createCrateAwareReader throws when a crate has no module loader', async () => {
    const { sink } = collect();
    const resolver = new AssetResolver({ rootUrl: ROOT, onDiagnostic: sink });
    const bytes = { [`${ROOT}/c.usd`]: crateBytes('#usda 1.0\n') };
    const reader = createCrateAwareReader({ resolver, source: source(bytes), sink });
    await expect(reader.read('c.usd')).rejects.toThrow(/requires a crate module loader/);
  });
});
