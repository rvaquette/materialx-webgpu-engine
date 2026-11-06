import { expect, it } from 'vitest';
import { FLOAT, IrModuleBuilder, shaderType, vector, type ShaderIr } from '../../src/compiler/ir.ts';
import { isSpatialVolumeIr } from '../../src/compiler/volume-ir.ts';
import { bakeVolumeGrid, sampleVolumeGrid, sampleVolumeTransport } from '../../src/render/volume-field.ts';
import { createPcg32, integratePath, type SceneSampler } from '../../src/render/pathtracing/integrator.ts';
import { PT_MATERIAL_RECORD_FLOATS } from '../../src/render/pathtracing/material-record.ts';
import { pathTraceComputeWgsl } from '../../src/render/pathtracing/compute.ts';
import { rasterVolumeWgsl } from '../../src/render/raster/volume-pass.ts';

function spatialIr(): ShaderIr {
  const b = new IrModuleBuilder();
  const position = b.add({ kind:'input',name:'position',type:vector(3) });
  const x = b.add({ kind:'swizzle',source:position,pattern:'x',type:FLOAT });
  const density = b.add({ kind:'convert',source:x,from:FLOAT,type:vector(3) });
  const volume = b.add({ kind:'closure',type:shaderType('volume'),closure:'vdf',op:'anisotropic_vdf',
    params: { absorption:density,scattering:b.constant(vector(3),[0,0,0]),anisotropy:b.constant(FLOAT,0),
      emission:b.constant(vector(3),[2,3,4]) } });
  b.output({ name:'volumeshader',type:shaderType('volume'),ref:volume });
  return b.build();
}

it('bakes a spatial field, interpolates all coefficients and bounds extinction', () => {
  const ir = spatialIr();
  expect(isSpatialVolumeIr(ir)).toBe(true);
  const grid = bakeVolumeGrid(ir,{ min:[0,0,0],max:[1,1,1] },4);
  const materials = new Float32Array(PT_MATERIAL_RECORD_FLOATS);
  materials[41] = grid.size;
  materials.set([1,1,1],46);
  const m = sampleVolumeGrid(materials,grid.data,0,[0.25,0.75,0.5]);
  expect(m.absorption[0]).toBeCloseTo(0.25,6);
  expect(m.emission).toEqual([2,3,4]);
  expect(grid.majorant).toBeGreaterThan(1);
  expect(() => bakeVolumeGrid(ir,{ min:[0,0,0],max:[0,1,1] })).toThrow('extent');
});

it('does not misclassify a homogeneous volume because its surface uses position', () => {
  const ir = spatialIr();
  const b = new IrModuleBuilder();
  const unused = b.add({ kind:'input',name:'position',type:vector(3) });
  b.output({ name:'surface',type:vector(3),ref:unused });
  const v = b.add({ kind:'closure',type:shaderType('volume'),closure:'vdf',op:'anisotropic_vdf',
    params: { absorption:b.constant(vector(3),[1,1,1]),scattering:b.constant(vector(3),[0,0,0]),anisotropy:b.constant(FLOAT,0) } });
  b.output({ name:'volumeshader',type:shaderType('volume'),ref:v });
  expect(isSpatialVolumeIr(b.build())).toBe(false);
  expect(() => bakeVolumeGrid(ir,{ min:[-1,0,0],max:[1,1,1] },2)).toThrow('absorption');
});

it('tracks RGB absorption and EDF with the analytic Beer-Lambert expectation', () => {
  const absorption = [0.4,0.7,1] as const, emission = [2,3,4] as const;
  const field = { majorant:1.000001,sample: () => ({ absorption,scattering:[0,0,0] as const,anisotropy:0,emission }) };
  const rng = createPcg32(81);
  const trans = [0,0,0], source = [0,0,0];
  const count = 60000;
  for (let i=0;i<count;i++) {
    const sample = sampleVolumeTransport(field,[0,0,0],[0,0,1],1,rng);
    for (let c=0;c<3;c++) {
      trans[c] = trans[c]!+sample.weight[c]!;
      source[c] = source[c]!+sample.emission[c]!;
    }
  }
  for (let c=0;c<3;c++) {
    expect(trans[c]!/count).toBeCloseTo(Math.exp(-absorption[c]!),2);
    expect(source[c]!/count).toBeCloseTo(emission[c]!/absorption[c]!*(1-Math.exp(-absorption[c]!)),1);
  }
});

it('integrates spatial extinction rather than using the value at the origin', () => {
  const field = { majorant:1.000001,sample: (p: readonly [number,number,number]) =>
    ({ absorption:[p[0],p[0],p[0]] as const,scattering:[0,0,0] as const,anisotropy:0 }) };
  const rng = createPcg32(27);
  let sum = 0;
  for (let i=0;i<50000;i++) sum += sampleVolumeTransport(field,[0,0,0],[1,0,0],1,rng).weight[0];
  expect(sum/50000).toBeCloseTo(Math.exp(-0.5),2);
});

it('emits in a vacuum and works when the camera starts inside a pure volume', () => {
  const field = { majorant:0,sample: () => ({ absorption:[0,0,0] as const,scattering:[0,0,0] as const,
    anisotropy:0,emission:[1,2,3] as const }) };
  expect(sampleVolumeTransport(field,[0,0,0],[0,0,1],2,() => 0.5).emission).toEqual([2,4,6]);
  const scene: SceneSampler = {
    intersect: ray => ray.origin[2] < 1 ? { position:[0,0,1],normal:[0,0,1],volumeBoundary:true,interiorField:field } : null,
    sampleBsdf: () => { throw new Error('Volume boundary is not a surface.'); },
    evalBsdf: () => ({ value:[0,0,0],pdf:0 }),sampleLight: () => null,lightPdf: () => 0,
    occluded: () => false,environment: () => [0,0,0],
  };
  expect(integratePath(scene,{ origin:[0,0,0],direction:[0,0,1] },() => 0.5)).toEqual([1,2,3]);
});

it('emits explicit errors for invalid boundaries and unsafe majorants', () => {
  const field = { majorant:0.1,sample: () => ({ absorption:[1,1,1] as const,scattering:[0,0,0] as const,anisotropy:0 }) };
  expect(() => sampleVolumeTransport(field,[0,0,0],[0,0,1],Infinity,() => 0.01)).toThrow('closed');
  expect(() => sampleVolumeTransport(field,[0,0,0],[0,0,1],1,() => 0.01)).toThrow('majorant');
});

it('wires spatial sampling and emission into both GPU backends', () => {
  const pt = pathTraceComputeWgsl({ volumeGrid:true });
  expect(pt).toContain('@binding(10)');
  expect(pt).toContain('radiance += beta*vs.emission');
  expect(pt).toContain('volumeIndex = tri_material(hit.tri)');
  const raster = rasterVolumeWgsl(true,true);
  expect(raster).toContain('radiance+tr*background.xyz');
  expect(raster).toContain('source = m.emission');
  expect(raster).toContain('source += m.scattering*single_scattering');
  expect(raster).toContain('shadow_volume');
});
