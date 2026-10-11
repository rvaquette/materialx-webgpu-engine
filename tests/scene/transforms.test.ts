import { describe, expect, it } from 'vitest';
import {
  composeXform,
  computeWorldTransforms,
  inverse4,
  lookAt4,
  multiply4,
  perspective4,
  IDENTITY4,
} from '../../src/scene/transforms.ts';
import type { SceneAsset, ScenePrim, XformOp } from '../../src/scene/types.ts';

function prim(path: string, overrides: Partial<ScenePrim> = {}): ScenePrim {
  return {
    path,
    name: path.split('/').filter(Boolean).pop() ?? '',
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
  return { entry: 'root.usda', stage: { subLayers: [] }, prims: new Map(prims.map((p) => [p.path, p])), roots, materials: [] };
}

const translate = (x: number, y: number, z: number): XformOp => ({ op: 'xformOp:translate', typeName: 'double3', value: [x, y, z], invert: false });

describe('transforms', () => {
  it('composes xformOps with the first op outermost', () => {
    const m = composeXform([
      translate(10, 0, 0),
      { op: 'xformOp:scale', typeName: 'float3', value: [2, 2, 2], invert: false },
    ]);
    expect(m[0]).toBeCloseTo(2);
    expect(m[12]).toBeCloseTo(10);
  });

  it('inverts a matrix back to identity', () => {
    const m = composeXform([translate(3, -4, 5)]);
    const round = multiply4(m, inverse4(m));
    for (let i = 0; i < 16; i++) expect(round[i]).toBeCloseTo(IDENTITY4[i]!);
  });

  it('accumulates world transforms down the tree', () => {
    const a = prim('/A', { children: ['/A/B'], xformOps: [translate(1, 0, 0)] });
    const b = prim('/A/B', { xformOps: [translate(0, 2, 0)] });
    const world = computeWorldTransforms(scene([a, b], ['/A']));
    const m = world.get('/A/B')!;
    expect(m[12]).toBeCloseTo(1);
    expect(m[13]).toBeCloseTo(2);
  });

  it('builds a perspective matrix with the expected vertical scale', () => {
    const fovY = Math.PI / 2;
    const m = perspective4(fovY, 1, 0.1, 100);
    expect(m[5]).toBeCloseTo(1 / Math.tan(fovY / 2));
  });

  it('places the eye at the origin of the view space', () => {
    const view = lookAt4([0, 0, 5], [0, 0, 0], [0, 1, 0]);
    const eyeInView = [
      view[0]! * 0 + view[4]! * 0 + view[8]! * 5 + view[12]!,
      view[1]! * 0 + view[5]! * 0 + view[9]! * 5 + view[13]!,
      view[2]! * 0 + view[6]! * 0 + view[10]! * 5 + view[14]!,
    ];
    expect(eyeInView[0]).toBeCloseTo(0);
    expect(eyeInView[1]).toBeCloseTo(0);
    expect(eyeInView[2]).toBeCloseTo(0);
  });
});
