import { describe, expect, it } from 'vitest';
import { importCameras } from '../../src/usd/cameras.ts';
import type { AttributeValue, PrimAttribute, SceneAsset, ScenePrim, XformOp } from '../../src/scene/types.ts';

function attr(name: string, typeName: string, value: AttributeValue): [string, PrimAttribute] {
  return [name, { name, typeName, value }];
}

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

describe('importCameras', () => {
  it('derives fov, aspect and a view matrix from a UsdGeomCamera', () => {
    const camera = prim('/cam', {
      typeName: 'Camera',
      xformOps: [translate(0, 0, 5)],
      attributes: new Map([
        attr('focalLength', 'float', 50),
        attr('horizontalAperture', 'float', 36),
        attr('verticalAperture', 'float', 24),
        attr('clippingRange', 'float2', [0.1, 1000]),
        attr('fStop', 'float', 2.8),
      ]),
    });
    const [cam] = importCameras(scene([camera], ['/cam']));
    expect(cam!.projection).toBe('perspective');
    expect(cam!.aspectRatio).toBeCloseTo(1.5);
    expect(cam!.fovY).toBeCloseTo(2 * Math.atan(24 / 100));
    expect(cam!.fStop).toBe(2.8);
    expect(cam!.view[14]).toBeCloseTo(-5); // eye at z=5 -> view translates by -5
  });

  it('handles orthographic projection', () => {
    const camera = prim('/ortho', {
      typeName: 'Camera',
      attributes: new Map([
        attr('projection', 'token', 'orthographic'),
        attr('horizontalAperture', 'float', 20),
        attr('verticalAperture', 'float', 10),
      ]),
    });
    const [cam] = importCameras(scene([camera], ['/ortho']));
    expect(cam!.projection).toBe('orthographic');
    expect(cam!.fovY).toBe(0);
  });
});
