import { afterEach, describe, expect, it, vi } from 'vitest';
import { surfaceFromParsedInputs } from '../../../src/materialx/surface-from-inputs.ts';
import { disneyMaterialFromPrincipled, packDisneyMaterials, uploadDisneyMaterials } from '../../../src/render/pathtracing/disney-material.ts';

afterEach(() => vi.unstubAllGlobals());

function surface(inputs: Record<string, number | readonly number[]> = {}) {
  const result = surfaceFromParsedInputs({ category: 'disney_principled', inputs });
  if (!result) throw new Error('Missing fixture surface');
  return result;
}

describe('Disney material records', () => {
  it('converts and packs independent Disney material parameters and texture slots', () => {
    const converted = disneyMaterialFromPrincipled(surface({
      baseColor: [0.2, 0.4, 0.8], metallic: 0.7, roughness: 0.3,
      anisotropic: 0.2, clearcoat: 0.8, clearcoatGloss: 0.9, ior: 1.3,
    }));
    expect(converted.warnings.join(' ')).toContain('approximated');
    const record = packDisneyMaterials([{ ...converted.material, textures: [2, 3, -1, 7] }]);
    expect(record.length).toBe(32);
    expect(record[0]).toBeCloseTo(0.2);
    expect(record[3]).toBeCloseTo(0.2);
    expect(record[8]).toBeCloseTo(0.7);
    expect(record[9]).toBeCloseTo(0.3);
    expect(record[14]).toBeCloseTo(0.8);
    expect(record[15]).toBeCloseTo(0.9);
    expect(record[17]).toBeCloseTo(1.3);
    expect([...record.slice(24, 28)]).toEqual([2, 3, -1, 7]);
    expect([...record.slice(28, 32)]).toEqual([1, 0, 0, 0]);
  });

  it('reports features that do not map to the WebGL Disney model', () => {
    const result = disneyMaterialFromPrincipled(surface({ specular: 0.9, subsurface: 0.3 }));
    expect(result.warnings).toHaveLength(3);
    expect(result.warnings.join(' ')).toContain('subsurfaceDistance');
  });

  it('uses live material edits and rejects missing uniform values', () => {
    const source = surface();
    const inputs = new Map(source.inputs);
    inputs.set('roughness', { ...inputs.get('roughness')!, parameter: 'roughnessUniform' });
    const editable = { ...source, inputs };
    expect(() => disneyMaterialFromPrincipled(editable)).toThrow('Missing editable Disney material parameter');
    const result = disneyMaterialFromPrincipled(editable, [{
      id: 'roughness', label: 'Roughness', type: 'float', value: [0.25], initial: [0.5],
      update: 'uniform', uniform: 'roughnessUniform', input: 'roughness',
    }]);
    expect(result.material.roughness).toBe(0.25);
  });

  it('keeps medium and alpha data separate across material records', () => {
    const material = disneyMaterialFromPrincipled(surface()).material;
    const records = packDisneyMaterials([material, {
      ...material, emission: [2, 4, 8], mediumType: 2, mediumDensity: 0.5,
      mediumColor: [0.25, 0.5, 0.75], mediumAnisotropy: -0.5,
      opacity: 0.25, alphaMode: 2, alphaCutoff: 0.5,
    }]);
    expect([...records.slice(32 + 4, 32 + 8)]).toEqual([2, 4, 8, 0]);
    expect([...records.slice(32 + 18, 32 + 24)]).toEqual([2, 0.5, 0.25, 0.5, 0.75, -0.5]);
    expect([...records.slice(32 + 28, 32 + 32)]).toEqual([0.25, 2, 0.5, 0]);
  });

  it('rejects connected inputs instead of losing their textures', () => {
    const source = surface();
    const inputs = new Map(source.inputs);
    inputs.set('baseColor', { ...inputs.get('baseColor')!, source: { kind: 'connection', nodeId: 'image' } });
    expect(() => disneyMaterialFromPrincipled({ ...source, inputs })).toThrow('baseColor is missing or connected');
  });

  it('rejects invalid values and texture indices before uploading', () => {
    const material = disneyMaterialFromPrincipled(surface()).material;
    expect(() => packDisneyMaterials([{ ...material, roughness: NaN }])).toThrow('Invalid Disney material');
    expect(() => packDisneyMaterials([{ ...material, textures: [-1, -1, -1, 0.5] }])).toThrow('Invalid Disney material');
    expect(() => packDisneyMaterials([{ ...material, emission: [1e100, 0, 0] }])).toThrow('Invalid Disney material color');
    expect(() => packDisneyMaterials([{ ...material, ior: 1e-300 }])).toThrow('Invalid Disney material');
  });

  it('validates texture references and releases a buffer when upload fails', () => {
    vi.stubGlobal('GPUBufferUsage', { STORAGE: 128, COPY_DST: 8 });
    const material = disneyMaterialFromPrincipled(surface()).material;
    const destroy = vi.fn();
    const createBuffer = vi.fn(() => ({ destroy }));
    const writeBuffer = vi.fn();
    const device = {
      limits: { maxTextureArrayLayers: 4, maxStorageBufferBindingSize: 1024, maxBufferSize: 1024 },
      createBuffer, queue: { writeBuffer },
    } as unknown as GPUDevice;
    expect(() => uploadDisneyMaterials(device, [], 0)).toThrow('at least one');
    expect(() => uploadDisneyMaterials(device, [material], 5)).toThrow('texture count');
    expect(() => uploadDisneyMaterials(device, [{ ...material, textures: [1, -1, -1, -1] }], 1)).toThrow('missing texture layer');
    const limitedDevice = { ...device, limits: { ...device.limits, maxStorageBufferBindingSize: 64 } };
    expect(() => uploadDisneyMaterials(limitedDevice, [material], 0)).toThrow('exceeds device limits');
    expect(createBuffer).not.toHaveBeenCalled();
    uploadDisneyMaterials(device, [material], 0);
    expect(createBuffer).toHaveBeenCalledWith({ label: 'Disney materials', size: 128, usage: 136 });
    expect(writeBuffer).toHaveBeenCalledOnce();
    writeBuffer.mockImplementationOnce(() => { throw new Error('device lost'); });
    expect(() => uploadDisneyMaterials(device, [material], 0)).toThrow('device lost');
    expect(destroy).toHaveBeenCalledOnce();
  });
});
