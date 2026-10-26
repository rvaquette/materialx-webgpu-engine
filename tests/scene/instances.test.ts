import { describe, expect, it } from 'vitest';
import { buildSceneInstances, composeXform, multiply4, IDENTITY4 } from '../../src/scene/instances.ts';
import type { SceneAsset, ScenePrim, XformOp } from '../../src/scene/types.ts';
import type { SceneMaterials } from '../../src/usd/materials.ts';

function prim(path: string, overrides: Partial<ScenePrim> = {}): ScenePrim {
  const name = path.split('/').filter(Boolean).pop() ?? '';
  return {
    path,
    name,
    specifier: 'def',
    apiSchemas: [],
    inherits: [],
    references: [],
    payloads: [],
    attributes: new Map(),
    relationships: new Map(),
    xformOps: [],
    children: [],
    ...overrides,
  };
}

function scene(prims: ScenePrim[], roots: string[]): SceneAsset {
  return {
    entry: 'root.usda',
    stage: { subLayers: [] },
    prims: new Map(prims.map((p) => [p.path, p])),
    roots,
    materials: [],
  };
}

const translateOp = (x: number, y: number, z: number): XformOp => ({
  op: 'xformOp:translate',
  typeName: 'double3',
  value: [x, y, z],
  invert: false,
});

describe('composeXform', () => {
  it('applies the first op as the outermost transform', () => {
    const ops: XformOp[] = [
      translateOp(10, 0, 0),
      { op: 'xformOp:scale', typeName: 'float3', value: [2, 2, 2], invert: false },
    ];
    const m = composeXform(ops);
    expect(m[0]).toBeCloseTo(2); // scale survives
    expect(m[12]).toBeCloseTo(10); // translation survives
  });

  it('inverts an op flagged with !invert!', () => {
    const forward = composeXform([translateOp(3, 4, 5)]);
    const back = composeXform([{ ...translateOp(3, 4, 5), invert: true }]);
    const round = multiply4(forward, back);
    for (let i = 0; i < 16; i++) expect(round[i]).toBeCloseTo(IDENTITY4[i]!);
  });
});

describe('buildSceneInstances', () => {
  it('does not treat primvars on cameras and lights as mesh geometry', () => {
    const camera = prim('/camera', { typeName: 'Camera', mesh: { primvars: [] } });
    const light = prim('/light', { typeName: 'DomeLight', mesh: { primvars: [] } });
    const mesh = prim('/mesh', { typeName: 'Mesh', mesh: { primvars: [] } });
    const result = buildSceneInstances(scene([camera, light, mesh], ['/camera', '/light', '/mesh']));
    expect(result.prototypes.map(p => p.primPath)).toEqual(['/mesh']);
    expect(result.instances).toHaveLength(1);
  });

  it('accumulates ancestor transforms for a standalone mesh', () => {
    const world = prim('/World', { children: ['/World/mesh'], xformOps: [translateOp(1, 0, 0)] });
    const mesh = prim('/World/mesh', { typeName: 'Mesh', mesh: { primvars: [] }, xformOps: [translateOp(0, 2, 0)] });
    const result = buildSceneInstances(scene([world, mesh], ['/World']));
    expect(result.prototypes.map((p) => p.primPath)).toEqual(['/World/mesh']);
    expect(result.instances).toHaveLength(1);
    const t = result.instances[0]!.transform;
    expect(t[12]).toBeCloseTo(1);
    expect(t[13]).toBeCloseTo(2);
  });

  it('shares one prototype across native instances', () => {
    const proto = prim('/proto', { typeName: 'Mesh', mesh: { primvars: [] } });
    const a = prim('/a', { references: [{ primPath: '/proto', isMaterialX: false }], xformOps: [translateOp(5, 0, 0)] });
    const b = prim('/b', { references: [{ primPath: '/proto', isMaterialX: false }], xformOps: [translateOp(9, 0, 0)] });
    const result = buildSceneInstances(scene([proto, a, b], ['/proto', '/a', '/b']));
    expect(result.prototypes).toHaveLength(1);
    expect(result.instances).toHaveLength(3);
    expect(new Set(result.instances.map((i) => i.prototypeId))).toEqual(new Set(['/proto']));
  });

  it('attaches the effective material binding to an instance', () => {
    const mesh = prim('/mesh', { typeName: 'Mesh', mesh: { primvars: [] } });
    const materials: SceneMaterials = {
      bindings: new Map([
        ['/mesh', { primPath: '/mesh', materialPath: '/Looks/floor', strength: 'weakerThanDescendants' }],
      ]),
      units: [],
      unbound: [],
    };
    const result = buildSceneInstances(scene([mesh], ['/mesh']), { materials });
    expect(result.instances[0]!.materialPath).toBe('/Looks/floor');
  });
});
