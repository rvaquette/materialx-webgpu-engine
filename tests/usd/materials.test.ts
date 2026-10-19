import { describe, it, expect } from 'vitest';
import type { Diagnostic } from '../../src/core/diagnostics.ts';
import type { MxNode } from '../../src/materialx/graph.ts';
import { importUsdStage, type UsdLayerReader } from '../../src/usd/importer.ts';
import {
  materialGraphRoots,
  resolveSceneMaterials,
  type MtlxDocumentView,
  type MtlxMaterialInput,
  type MtlxMaterialNode,
} from '../../src/usd/materials.ts';
import type { SceneAsset } from '../../src/scene/types.ts';
import { applyObjectMaterialOverrides } from '../../src/render/usd-scene-assets.ts';

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

async function stage(source: string): Promise<SceneAsset> {
  return importUsdStage('stage.usda', { reader: reader({ 'stage.usda': source }) });
}

describe('resolveSceneMaterials', () => {
  it('overrides one object without changing another object sharing its original material', async () => {
    const scene = await stage(`#usda 1.0
def Xform "World" {
    rel material:binding = </World/Looks/shared>
    def Scope "Looks" {
        def Material "shared" (
            prepend references = @./shared.mtlx@</MaterialX/Materials/shared>
        ) {}
    }
    def Mesh "a" {}
    def Mesh "b" {}
}`);
    const overridden = applyObjectMaterialOverrides(scene, new Map([
      ['/World/a', { assetPath: '/scenes/mtlx-library/gold.mtlx', materialName: 'Gold' }],
    ]));
    const bindings = resolveSceneMaterials(overridden);
    expect(bindings.bindings.get('/World/a')?.materialX?.materialName).toBe('Gold');
    expect(bindings.bindings.get('/World/b')?.materialX?.materialName).toBe('shared');
    expect(scene.prims.get('/World/a')?.materialBinding).toBeUndefined();
    expect(scene.materials).toHaveLength(1);
    const restored = resolveSceneMaterials(applyObjectMaterialOverrides(scene, new Map()));
    expect(restored.bindings.get('/World/a')?.materialX?.materialName).toBe('shared');
  });

  it('rejects material overrides targeting a missing object', async () => {
    const scene = await stage('#usda 1.0\ndef Mesh "object" {}');
    expect(() => applyObjectMaterialOverrides(scene, new Map([
      ['/missing', { assetPath: 'gold.mtlx', materialName: 'Gold' }],
    ]))).toThrow('Unknown mesh');
  });

  it('inherits bindings down the tree and dedups materials', async () => {
    const scene = await stage(`#usda 1.0
def Xform "World" {
    def Scope "Looks" {
        def Material "floor" (
            prepend references = @./floor.mtlx@</MaterialX/Materials/floor>
        ) {
        }
        def Material "metal" (
            prepend references = @./metal.mtlx@</MaterialX/Materials/metal>
        ) {
        }
    }
    def Xform "Group" (
        prepend apiSchemas = ["MaterialBindingAPI"]
    ) {
        rel material:binding (bindMaterialAs = "weakerThanDescendants") = </World/Looks/floor>
        def Mesh "a" {
        }
        def Mesh "b" {
        }
        def Mesh "c" (
            prepend apiSchemas = ["MaterialBindingAPI"]
        ) {
            rel material:binding (bindMaterialAs = "weakerThanDescendants") = </World/Looks/metal>
        }
    }
}
`);
    const result = resolveSceneMaterials(scene);

    expect(result.bindings.get('/World/Group/a')?.materialPath).toBe('/World/Looks/floor');
    expect(result.bindings.get('/World/Group/b')?.materialPath).toBe('/World/Looks/floor');
    expect(result.bindings.get('/World/Group/c')?.materialPath).toBe('/World/Looks/metal');
    expect(result.bindings.get('/World/Group/a')?.materialX?.materialName).toBe('floor');
    expect(result.unbound).toEqual([]);

    const floor = result.units.find((u) => u.materialName === 'floor');
    expect(floor?.boundPrims).toEqual(['/World/Group/a', '/World/Group/b']);
    const metal = result.units.find((u) => u.materialName === 'metal');
    expect(metal?.boundPrims).toEqual(['/World/Group/c']);
    expect(result.units).toHaveLength(2);
  });

  it('lets a strongerThanDescendants ancestor override a descendant binding', async () => {
    const scene = await stage(`#usda 1.0
def Xform "World" (
    prepend apiSchemas = ["MaterialBindingAPI"]
) {
    rel material:binding (bindMaterialAs = "strongerThanDescendants") = </World/Looks/floor>
    def Scope "Looks" {
        def Material "floor" (
            prepend references = @./floor.mtlx@</MaterialX/Materials/floor>
        ) {
        }
        def Material "metal" (
            prepend references = @./metal.mtlx@</MaterialX/Materials/metal>
        ) {
        }
    }
    def Mesh "m" (
        prepend apiSchemas = ["MaterialBindingAPI"]
    ) {
        rel material:binding (bindMaterialAs = "weakerThanDescendants") = </World/Looks/metal>
    }
}
`);
    const result = resolveSceneMaterials(scene);
    const binding = result.bindings.get('/World/m');
    expect(binding?.materialPath).toBe('/World/Looks/floor');
    expect(binding?.strength).toBe('strongerThanDescendants');
  });

  it('reports gprims with no effective binding', async () => {
    const scene = await stage(`#usda 1.0
def Xform "World" {
    def Mesh "orphan" {
    }
}
`);
    const { sink, messages } = collect();
    const result = resolveSceneMaterials(scene, { sink });
    expect(result.unbound).toEqual(['/World/orphan']);
    expect(result.bindings.size).toBe(0);
    expect(messages.some((m) => m.message.includes('no material binding'))).toBe(true);
  });

  it('flags a binding whose target lacks a MaterialX reference', async () => {
    const scene = await stage(`#usda 1.0
def Xform "World" {
    def Mesh "m" (
        prepend apiSchemas = ["MaterialBindingAPI"]
    ) {
        rel material:binding = </World/Looks/missing>
    }
}
`);
    const { sink, messages } = collect();
    const result = resolveSceneMaterials(scene, { sink });
    const binding = result.bindings.get('/World/m');
    expect(binding?.materialPath).toBe('/World/Looks/missing');
    expect(binding?.materialX).toBeUndefined();
    expect(result.units).toHaveLength(0);
    expect(messages.some((m) => m.message.includes('no MaterialX reference'))).toBe(true);
  });
});

function input(name: string, type: string, node: MxNode | null): MtlxMaterialInput {
  return { getName: () => name, getType: () => type, getConnectedNode: () => node };
}

function materialNode(name: string, inputs: MtlxMaterialInput[]): MtlxMaterialNode {
  return {
    getName: () => name,
    getNamePath: () => `/${name}`,
    validate: () => true,
    getInputs: () => inputs,
    delete: () => undefined,
  };
}

describe('materialGraphRoots', () => {
  it('builds roots from connected shader terminals in render order', () => {
    const surf = { id: 'surf' } as unknown as MxNode;
    const disp = { id: 'disp' } as unknown as MxNode;
    const material = materialNode('floor', [
      input('surfaceshader', 'surfaceshader', surf),
      input('displacementshader', 'displacementshader', disp),
    ]);
    const doc: MtlxDocumentView = { getMaterialNode: (n) => (n === 'floor' ? material : null) };

    const roots = materialGraphRoots(doc, 'floor');
    expect(roots.map((r) => r.name)).toEqual(['displacementshader', 'surfaceshader']);
    expect(roots[0]!.node).toBe(disp);
    expect(roots[1]!.node).toBe(surf);
  });

  it('warns on an unconnected terminal and skips it', () => {
    const surf = { id: 'surf' } as unknown as MxNode;
    const material = materialNode('floor', [
      input('surfaceshader', 'surfaceshader', surf),
      input('displacementshader', 'displacementshader', null),
    ]);
    const doc: MtlxDocumentView = { getChild: (n) => (n === 'floor' ? material : null) };
    const { sink, messages } = collect();

    const roots = materialGraphRoots(doc, 'floor', { sink });
    expect(roots.map((r) => r.name)).toEqual(['surfaceshader']);
    expect(messages.some((m) => m.level === 'warning' && m.message.includes('unconnected'))).toBe(true);
  });

  it('reports a missing material', () => {
    const doc: MtlxDocumentView = { getMaterialNode: () => null, getChild: () => null };
    const { sink, messages } = collect();
    const roots = materialGraphRoots(doc, 'ghost', { sink });
    expect(roots).toEqual([]);
    expect(messages.some((m) => m.level === 'error' && m.message.includes('not found'))).toBe(true);
  });
});
