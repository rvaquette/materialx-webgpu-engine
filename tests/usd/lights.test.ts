import { describe, expect, it, vi } from 'vitest';
import { importLights } from '../../src/usd/lights.ts';
import type { Diagnostic } from '../../src/core/diagnostics.ts';
import type { AttributeValue, PrimAttribute, SceneAsset, ScenePrim } from '../../src/scene/types.ts';

function attr(name: string, typeName: string, value: AttributeValue): [string, PrimAttribute] {
  return [name, { name, typeName, value }];
}

function prim(path: string, typeName: string, attrs: [string, PrimAttribute][] = []): ScenePrim {
  return {
    path,
    name: path.split('/').filter(Boolean).pop() ?? '',
    specifier: 'def',
    typeName,
    apiSchemas: [],
    inherits: [],
    references: [],
    payloads: [],
    attributes: new Map(attrs),
    relationships: new Map(),
    xformOps: [],
    children: [],
  };
}

function scene(prims: ScenePrim[]): SceneAsset {
  return { entry: 'root.usda', stage: { subLayers: [] }, prims: new Map(prims.map((p) => [p.path, p])), roots: prims.map((p) => p.path), materials: [] };
}

describe('importLights', () => {
  it('reads shape and radiometric parameters per light type', () => {
    const sun = prim('/Sun', 'DistantLight', [
      attr('inputs:angle', 'float', 0.53),
      attr('inputs:intensity', 'float', 3),
      attr('inputs:color', 'color3f', [1, 0.9, 0.8]),
    ]);
    const lamp = prim('/Lamp', 'SphereLight', [
      attr('inputs:radius', 'float', 0.5),
      attr('inputs:intensity', 'float', 100),
      attr('inputs:enableColorTemperature', 'bool', true),
      attr('inputs:colorTemperature', 'float', 6500),
    ]);
    const lights = importLights(scene([sun, lamp]));
    const byPath = new Map(lights.map((l) => [l.path, l]));
    expect(byPath.get('/Sun')!.type).toBe('distant');
    expect(byPath.get('/Sun')!.angle).toBeCloseTo(0.53);
    expect(byPath.get('/Lamp')!.type).toBe('sphere');
    expect(byPath.get('/Lamp')!.radius).toBeCloseTo(0.5);
    expect(byPath.get('/Lamp')!.colorTemperature).toBe(6500);
  });

  it('records a dome texture without loading it', () => {
    const sink = vi.fn<(d: Diagnostic) => void>();
    const dome = prim('/Dome', 'DomeLight', [attr('inputs:texture:file', 'asset', 'env.hdr')]);
    const [light] = importLights(scene([dome]), { sink });
    expect(light!.type).toBe('dome');
    expect(light!.textureFile).toBe('env.hdr');
    expect(sink).toHaveBeenCalledWith(expect.objectContaining({ level: 'info' }));
  });

  it('reports unknown light types instead of guessing', () => {
    const sink = vi.fn<(d: Diagnostic) => void>();
    const weird = prim('/X', 'MysteryLight');
    const [light] = importLights(scene([weird]), { sink });
    expect(light!.type).toBe('unknown');
    expect(sink).toHaveBeenCalledWith(expect.objectContaining({ level: 'warning' }));
  });

  it('omits colour temperature when not enabled', () => {
    const lamp = prim('/L', 'SphereLight', [attr('inputs:colorTemperature', 'float', 4000)]);
    const [light] = importLights(scene([lamp]));
    expect(light!.colorTemperature).toBeUndefined();
  });
});
