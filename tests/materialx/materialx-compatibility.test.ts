import { describe, expect, it } from 'vitest';
import inventory from '../../docs/generated/materialx-nodedefs.json';
import gpuProbes from '../../docs/generated/materialx-gpu-probes.json';
import { COMPATIBILITY_CASES, compatibilityCase } from '../../scripts/materialx-compatibility-status.ts';
import { SURFACE_IR_UPSTREAM } from '../../src/compiler/surface-ir.ts';
import { probeCpuValue } from '../../scripts/materialx-compatibility-cpu.ts';
import { probeDisneyDirect } from '../../scripts/materialx-compatibility-disney.ts';

describe('MaterialX compatibility inventory', () => {
  it('classifies every listed variant using the current rules without duplicate NodeDefs', () => {
    const names = inventory.definitions.map(definition => definition.nodedef);
    expect(new Set(names).size).toBe(names.length);
    for (const definition of inventory.definitions) {
      expect(definition.compatibility, definition.nodedef).toBe(compatibilityCase(definition, definition.origin, definition.cpuProbe, definition.disneyProbe));
      expect(definition.surfaceValueCategoryRegistered, definition.nodedef).toBe(SURFACE_IR_UPSTREAM.has(definition.category));
      if (definition.origin === 'library') {
        expect(probeCpuValue(definition), definition.nodedef).toEqual(definition.cpuProbe);
        expect(probeDisneyDirect(definition), definition.nodedef).toEqual(definition.disneyProbe);
      }
    }
    expect(inventory.compatibilityCases).toEqual(COMPATIBILITY_CASES);
  });

  it('distinguishes a direct Disney rejection from an untested output', () => {
    const color = { category: 'constant', outputs: [{ type: 'color3', name: 'out' }] };
    expect(probeDisneyDirect(color)).toMatchObject({ status: 'rejected', message: expect.stringContaining('Unsupported Disney texture graph') });
    expect(compatibilityCase(color, 'library', { status: 'evaluated' }, probeDisneyDirect(color))).toBe('cpuProbeDisneyRejected');
    const scalar = { category: 'constant', outputs: [{ type: 'float', name: 'out' }] };
    expect(probeDisneyDirect(scalar)).toMatchObject({ status: 'rejected', message: expect.stringContaining('Unsupported connected standard_surface input base') });
    const multiply = { category: 'multiply', outputs: [{ type: 'color3', name: 'out' }] };
    expect(probeDisneyDirect(multiply)).toMatchObject({ status: 'rejected', message: expect.stringContaining('missing or editable input') });
    expect(probeDisneyDirect({ category: 'constant', outputs: [{ type: 'vector2' }] })).toMatchObject({ status: 'not-tested' });
  });

  it('exercises a real literal numeric case and reports an unsupported node', () => {
    const constant = inventory.definitions.find(definition => definition.nodedef === 'ND_constant_float')!;
    expect(probeCpuValue(constant)).toEqual({ status: 'evaluated', value: [0] });
    const vector = inventory.definitions.find(definition => definition.nodedef === 'ND_constant_vector2')!;
    expect(probeCpuValue(vector)).toEqual({ status: 'evaluated', value: [0, 0] });
    const texture = inventory.definitions.find(definition => definition.category === 'triplanarprojection')!;
    expect(probeCpuValue(texture)).toMatchObject({ status: 'not-tested' });
    const unlowered = inventory.definitions.find(definition => definition.nodedef === 'ND_UsdPrimvarReader_float')!;
    expect(probeCpuValue(unlowered)).toMatchObject({ status: 'diagnostic', messages: [expect.stringContaining('neutral constant')] });
  });

  it('records one GPU result for each eligible CPU probe, including differences and errors', () => {
    const gpuTypes = new Set(['float', 'color3', 'color4', 'vector2', 'vector3', 'vector4']);
    const eligible = inventory.definitions.filter(definition =>
      definition.origin === 'library' && definition.cpuProbe.status === 'evaluated'
      && definition.outputs.length === 1 && gpuTypes.has(definition.outputs[0]!.type));
    expect(gpuProbes.results.map(result => result.nodedef)).toEqual(eligible.map(definition => definition.nodedef));
    for (const result of gpuProbes.results) {
      expect(['matched', 'different', 'error']).toContain(result.status);
      if (result.status === 'different') expect(result.actual?.every(Number.isFinite)).toBe(true);
      if (result.status === 'error') expect('message' in result && result.message).toBeTruthy();
    }
  });

  it('does not generalize a float test to another output type or a multi-output node', () => {
    expect(compatibilityCase({ category: 'power', outputs: [{ type: 'float', name: 'out' }] }, 'library')).toBe('floatMath');
    expect(compatibilityCase({ category: 'power', outputs: [{ type: 'color3', name: 'out' }] }, 'library')).toBe('unknown');
    expect(compatibilityCase({ category: 'power', outputs: [{ type: 'float', name: 'a' }, { type: 'float', name: 'b' }] }, 'library')).toBe('unknown');
    expect(compatibilityCase({ category: 'triplanarprojection', outputs: [{ type: 'color3', name: 'out' }] }, 'library')).toBe('triplanar');
  });

  it('distinguishes extensions and unsupported Disney roots from unverified values', () => {
    expect(compatibilityCase({ category: 'water', outputs: [] }, 'engine')).toBe('engineSurfacePreset');
    expect(compatibilityCase({ category: 'aov_shader', outputs: [] }, 'engine')).toBe('engineAov');
    expect(COMPATIBILITY_CASES.engineAov.backends.raster).toBe('unsupported');
    expect(compatibilityCase({ category: 'unknown_extension', outputs: [] }, 'engine')).toBe('engine');
    expect(compatibilityCase({ category: 'gltf_pbr', outputs: [{ type: 'surfaceshader', name: 'out' }] }, 'library')).toBe('otherSurface');
    expect(COMPATIBILITY_CASES.otherSurface.backends.disney).toBe('unsupported');
    expect(compatibilityCase({ category: 'gltf_pbr', outputs: [{ type: 'float', name: 'out' }] }, 'library')).toBe('unknown');
    expect(compatibilityCase({ category: 'UsdPrimvarReader', outputs: [{ type: 'vector2', name: 'out' }] }, 'library')).toBe('unloweredValue');
    expect(compatibilityCase({ category: 'UsdPrimvarReader', outputs: [{ type: 'string', name: 'out' }] }, 'library')).toBe('nonNumericOutput');
  });
});
