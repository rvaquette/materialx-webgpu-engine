import { describe, it, expect } from 'vitest';
import type { Diagnostic } from '../../src/core/diagnostics.ts';
import { importUsdStage, UsdImportError, type UsdLayerReader } from '../../src/usd/importer.ts';

function reader(layers: Record<string, string>): UsdLayerReader {
  return {
    async read(uri: string): Promise<string> {
      const text = layers[uri];
      if (text === undefined) throw new Error(`no such layer ${uri}`);
      return text;
    },
  };
}

function collect(): { sink: (d: Diagnostic) => void; messages: Diagnostic[] } {
  const messages: Diagnostic[] = [];
  return { sink: (d) => messages.push(d), messages };
}

describe('importUsdStage', () => {
  it('composes subLayers in strength order with overs', async () => {
    const layers = {
      'stage.usda': `#usda 1.0
(
    defaultPrim = "World"
    upAxis = "Y"
    metersPerUnit = 0.01
    subLayers = [
        @geo.usda@,
        @materials.usda@
    ]
)
def Xform "World" {
}
`,
      'geo.usda': `#usda 1.0
over "World" {
    def Mesh "floor" {
        token subdivisionScheme = "catmullClark"
        int refinementLevel = 2
        bool refinementEnableOverride = true
        float2[] primvars:st (interpolation = "vertex") = [(0, 0), (1, 1)]
    }
}
`,
      'materials.usda': `#usda 1.0
over "World" {
    over "floor" {
        token subdivisionScheme = "none"
    }
}
`,
    };
    const asset = await importUsdStage('stage.usda', { reader: reader(layers) });
    expect(asset.stage.defaultPrim).toBe('World');
    expect(asset.stage.upAxis).toBe('Y');
    expect(asset.stage.metersPerUnit).toBeCloseTo(0.01);
    expect(asset.stage.subLayers).toEqual(['geo.usda', 'materials.usda']);
    expect(asset.roots).toEqual(['/World']);

    const floor = asset.prims.get('/World/floor');
    expect(floor).toBeDefined();
    expect(floor!.specifier).toBe('def');
    expect(floor!.typeName).toBe('Mesh');
    // geo.usda is stronger than materials.usda -> catmullClark wins.
    expect(floor!.mesh?.subdivisionScheme).toBe('catmullClark');
    expect(floor!.mesh?.refinementLevel).toBe(2);
    expect(floor!.mesh?.refinementEnableOverride).toBe(true);
    expect(floor!.mesh?.primvars).toEqual([
      { name: 'st', typeName: 'float2[]', interpolation: 'vertex' },
    ]);
    expect(asset.prims.get('/World')!.children).toContain('/World/floor');
  });

  it('records MaterialX references and defers others', async () => {
    const layers = {
      'stage.usda': `#usda 1.0
def "Looks" {
    def Material "floor" (
        prepend inherits = </__class_mtl__/floor>
        prepend references = @./floor.mtlx@</MaterialX/Materials/floor>
    ) {
    }
    def "proxy" (
        prepend references = @./ShdrPlygrnd_Geo.usd@</World>
    ) {
    }
}
`,
    };
    const { sink, messages } = collect();
    const asset = await importUsdStage('stage.usda', { reader: reader(layers), sink });

    expect(asset.materials).toEqual([
      {
        primPath: '/Looks/floor',
        assetPath: './floor.mtlx',
        referencedPrimPath: '/MaterialX/Materials/floor',
        materialName: 'floor',
      },
    ]);
    const floor = asset.prims.get('/Looks/floor')!;
    expect(floor.inherits).toEqual(['/__class_mtl__/floor']);
    expect(floor.references[0]!.isMaterialX).toBe(true);

    // Dangling inherit and deferred binary reference are reported, not fatal.
    expect(messages.some((m) => m.message.includes('Dangling inherit ignored'))).toBe(true);
    expect(messages.some((m) => m.message.includes('Non-MaterialX reference deferred'))).toBe(true);
  });

  it('captures material:binding with strength', async () => {
    const layers = {
      'stage.usda': `#usda 1.0
def Xform "World" {
    def Mesh "floor" (
        prepend apiSchemas = ["MaterialBindingAPI"]
    ) {
        rel material:binding (bindMaterialAs = "weakerThanDescendants") = </World/Looks/floor>
    }
}
`,
    };
    const asset = await importUsdStage('stage.usda', { reader: reader(layers) });
    const floor = asset.prims.get('/World/floor')!;
    expect(floor.apiSchemas).toEqual(['MaterialBindingAPI']);
    expect(floor.materialBinding).toEqual({
      target: '/World/Looks/floor',
      strength: 'weakerThanDescendants',
    });
  });

  it('preserves xformOpOrder including inverted pivots', async () => {
    const layers = {
      'stage.usda': `#usda 1.0
def Xform "obj" {
    double3 xformOp:translate = (1, 2, 3)
    double3 xformOp:translate:pivot = (0.5, 0, 0)
    uniform token[] xformOpOrder = ["xformOp:translate:pivot", "xformOp:translate", "!invert!xformOp:translate:pivot"]
}
`,
    };
    const asset = await importUsdStage('stage.usda', { reader: reader(layers) });
    const ops = asset.prims.get('/obj')!.xformOps;
    expect(ops.map((o) => o.op)).toEqual([
      'xformOp:translate:pivot',
      'xformOp:translate',
      'xformOp:translate:pivot',
    ]);
    expect(ops[0]!.invert).toBe(false);
    expect(ops[2]!.invert).toBe(true);
    expect(ops[1]!.value).toEqual([1, 2, 3]);
  });

  it('defers binary crate subLayers without failing', async () => {
    const layers = {
      'stage.usda': `#usda 1.0
(
    subLayers = [ @geo.usd@ ]
)
def Xform "World" {
}
`,
      'geo.usd': 'PXR-USDC\u0000\u0000binarygarbage',
    };
    const { sink, messages } = collect();
    const asset = await importUsdStage('stage.usda', { reader: reader(layers), sink });
    expect(asset.prims.has('/World')).toBe(true);
    expect(messages.some((m) => m.message.includes('Binary crate layer deferred'))).toBe(true);
  });

  it('reports a missing subLayer instead of throwing', async () => {
    const layers = {
      'stage.usda': `#usda 1.0
(
    subLayers = [ @missing.usda@ ]
)
def Xform "World" {
}
`,
    };
    const { sink, messages } = collect();
    const asset = await importUsdStage('stage.usda', { reader: reader(layers), sink });
    expect(asset.prims.has('/World')).toBe(true);
    expect(messages.some((m) => m.level === 'error' && m.message.includes('Cannot read USD layer'))).toBe(true);
  });

  it('throws when the entry stage is a binary crate', async () => {
    const layers = { 'stage.usd': 'PXR-USDC\u0000binary' };
    await expect(importUsdStage('stage.usd', { reader: reader(layers) })).rejects.toBeInstanceOf(
      UsdImportError,
    );
  });

  it('guards against subLayer cycles', async () => {
    const layers = {
      'a.usda': `#usda 1.0
(
    subLayers = [ @b.usda@ ]
)
def "A" {}
`,
      'b.usda': `#usda 1.0
(
    subLayers = [ @a.usda@ ]
)
def "B" {}
`,
    };
    const { sink, messages } = collect();
    const asset = await importUsdStage('a.usda', { reader: reader(layers), sink });
    expect(asset.prims.has('/A')).toBe(true);
    expect(asset.prims.has('/B')).toBe(true);
    expect(messages.some((m) => m.message.includes('cycle guard'))).toBe(true);
  });
});
