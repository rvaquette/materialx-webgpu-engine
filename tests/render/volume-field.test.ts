import { expect, it } from 'vitest';
import { FLOAT, IrModuleBuilder, OBJECT_TO_WORLD_INPUT, matrix, shaderType, vector, type ShaderIr } from '../../src/compiler/ir.ts';
import { appendVolumeIr, isSpatialVolumeIr, lowerVolumeInputsToIr } from '../../src/compiler/volume-ir.ts';
import type { ResolvedGraph, ResolvedNode } from '../../src/materialx/graph.ts';
import type { ResolvedVolume } from '../../src/materialx/volume-graph.ts';
import { bakeVolumeGrid, sampleVolumeGrid, sampleVolumeTransport, sampleVolumeMixture, sampleVolumeEmitter, volumeTransmittance } from '../../src/render/volume-field.ts';
import { createPcg32, integratePath, type SceneSampler } from '../../src/render/pathtracing/integrator.ts';
import { PT_MATERIAL_RECORD_FLOATS } from '../../src/render/pathtracing/material-record.ts';
import { pathTraceComputeWgsl } from '../../src/render/pathtracing/compute.ts';
import { rasterVolumeWgsl } from '../../src/render/raster/volume-pass.ts';

it('estimates inverse-square illumination from two volume emitters regardless of selection weights', () => {
  const materials = new Float32Array(2 * PT_MATERIAL_RECORD_FLOATS);
  for (let index = 0; index < 2; index++) {
    const base = index * PT_MATERIAL_RECORD_FLOATS;
    materials.set([2, 3, 4].map(value => value * (index + 1)), base + 38);
    materials.set([-0.5, -0.5, (index + 1) * 10 - 0.5], base + 43);
    materials.set([1, 1, 1], base + 46);
    materials[base + 50] = index === 0 ? 2 : 16;
  }
  const rng = createPcg32(731);
  const sum = [0, 0, 0];
  const samples = 30000;
  for (let sample = 0; sample < samples; sample++) {
    const light = sampleVolumeEmitter(materials, undefined, [0, 0, 0], rng)!;
    for (let axis = 0; axis < 3; axis++) sum[axis] = sum[axis]! + light.emission[axis]! * light.direction[2] / (Math.PI * light.pdf);
  }
  for (let axis = 0; axis < 3; axis++) {
    const expected = (axis + 2) * (1 / 100 + 2 / 400) / Math.PI;
    expect(Math.abs(sum[axis]! / samples - expected) / expected).toBeLessThan(0.025);
  }
});

it('ratio tracking agrees with Beer-Lambert extinction', () => {
  const field = { majorant: 2, sample: () => ({ absorption: [1, 0.5, 0.25] as const, scattering: [0, 0, 0] as const, anisotropy: 0 }) };
  const rng = createPcg32(923);
  const sum = [0, 0, 0];
  for (let sample = 0; sample < 20000; sample++) {
    const tr = volumeTransmittance(field, [0, 0, 0], [0, 0, 1], 1, rng);
    for (let axis = 0; axis < 3; axis++) sum[axis] = sum[axis]! + tr[axis]!;
  }
  for (let axis = 0; axis < 3; axis++) expect(sum[axis]! / 20000).toBeCloseTo(Math.exp(-field.sample().absorption[axis]!), 2);
  expect(() => volumeTransmittance({ ...field, majorant: 0.1 }, [0, 0, 0], [0, 0, 1], 1, () => 0.01)).toThrow('majorant');
});

it('samples overlapping colored scattering phases and emission without bias', () => {
  const media = [
    { absorption: [0.2, 0.2, 0.2] as const, scattering: [0.4, 0.1, 0] as const, anisotropy: 0.7, emission: [0.2, 0.1, 0.05] as const },
    { absorption: [0.1, 0.1, 0.1] as const, scattering: [0.1, 0.2, 0.4] as const, anisotropy: -0.5, emission: [0.1, 0.05, 0.15] as const },
  ];
  const fields = media.map(medium => ({
    majorant: Math.max(...medium.absorption.map((value, i) => value + medium.scattering[i]!)) * 1.000001,
    sample: () => medium,
  }));
  const rng = createPcg32(297);
  const transmitted = [0, 0, 0], emitted = [0, 0, 0], scattered = [[0, 0, 0], [0, 0, 0]];
  const samples = 80000;
  for (let i = 0; i < samples; i++) {
    const result = sampleVolumeMixture(fields, [0, 0, 0], [0, 0, 1], 1, rng);
    for (let c = 0; c < 3; c++) {
      emitted[c] = emitted[c]! + result.emission[c]! / samples;
      if (result.scattered) {
        const index = result.anisotropy === media[0]!.anisotropy ? 0 : 1;
        scattered[index]![c] = scattered[index]![c]! + result.weight[c]! / samples;
      } else transmitted[c] = transmitted[c]! + result.weight[c]! / samples;
    }
  }
  for (let c = 0; c < 3; c++) {
    const extinction = media.reduce((sum, medium) => sum + medium.absorption[c]! + medium.scattering[c]!, 0);
    const integral = (1 - Math.exp(-extinction)) / extinction;
    expect(Math.abs(transmitted[c]! - Math.exp(-extinction))).toBeLessThan(0.012);
    expect(Math.abs(emitted[c]! - media.reduce((sum, medium) => sum + medium.emission[c]!, 0) * integral)).toBeLessThan(0.012);
    for (let i = 0; i < media.length; i++) {
      expect(Math.abs(scattered[i]![c]! - media[i]!.scattering[c]! * integral)).toBeLessThan(0.012);
    }
  }
});

it('importance sampling preserves the integrated emission of a nonuniform reconstructed grid', () => {
  const b = new IrModuleBuilder();
  const position = b.add({ kind: 'input', name: 'position', type: vector(3) });
  const x = b.add({ kind: 'swizzle', source: position, pattern: 'x', type: FLOAT });
  const emission = b.add({ kind: 'convert', source: x, from: FLOAT, type: vector(3) });
  const ref = b.add({ kind: 'closure', type: shaderType('volume'), closure: 'vdf', op: 'anisotropic_vdf', params: {
    absorption: b.constant(vector(3), [0, 0, 0]), scattering: b.constant(vector(3), [0, 0, 0]),
    anisotropy: b.constant(FLOAT, 0), emission,
  } });
  b.output({ name: 'volumeshader', type: shaderType('volume'), ref });
  const grid = bakeVolumeGrid(b.build(), { min: [0, 0, 10], max: [1, 1, 11] }, 8);
  const data = new Float32Array(grid.data.length + grid.emissionCdf!.length);
  data.set(grid.data);
  data.set(grid.emissionCdf!, grid.data.length);
  const materials = new Float32Array(PT_MATERIAL_RECORD_FLOATS);
  materials[41] = grid.size;
  materials.set([0, 0, 10], 43);
  materials.set([1, 1, 1], 46);
  materials[50] = grid.emissionWeight;
  const rng = createPcg32(627);
  let integral = 0;
  for (let sample = 0; sample < 10000; sample++) {
    const light = sampleVolumeEmitter(materials, data, [0, 0, 0], rng)!;
    integral += light.emission[0] * light.distance ** 2 / light.pdf;
  }
  expect(grid.emissionWeight).toBeCloseTo(0.5, 6);
  expect(integral / 10000).toBeCloseTo(0.5, 2);
});

it('attenuates surface illumination from an emissive volume without a proxy light', () => {
  const scene: SceneSampler = {
    intersect: () => ({ position: [0, 0, 0], normal: [0, 0, 1] }),
    sampleBsdf: () => null,
    evalBsdf: () => ({ value: [1 / Math.PI, 1 / Math.PI, 1 / Math.PI], pdf: 1 / Math.PI }),
    sampleLight: () => null,
    sampleVolumeLight: () => ({ direction: [0, 0, 1], radiance: [2, 2, 2], pdf: 1, distance: 1 }),
    transmittance: () => [0.5, 0.25, 0],
    occluded: () => false,
    lightPdf: () => 0,
  };
  const value = integratePath(scene, { origin: [0, 0, 1], direction: [0, 0, -1] }, createPcg32(1), { maxBounces: 1 });
  expect(value[0]).toBeCloseTo(1 / Math.PI);
  expect(value[1]).toBeCloseTo(0.5 / Math.PI);
  expect(value[2]).toBe(0);
});

it('lights a volume scattering event from an emissive volume without double counting its emission', () => {
  const field = {
    majorant: 1,
    sample: () => ({ absorption: [0, 0, 0] as const, scattering: [1, 1, 1] as const,
      anisotropy: 0, emission: [1, 1, 1] as const }),
  };
  const scene: SceneSampler = {
    intersect: ray => ({
      position: [ray.origin[0] + ray.direction[0] * 10, ray.origin[1] + ray.direction[1] * 10,
        ray.origin[2] + ray.direction[2] * 10],
      normal: [0, 0, 1], volumeBoundary: true, interiorField: field,
    }),
    sampleBsdf: () => null,
    evalBsdf: () => ({ value: [0, 0, 0], pdf: 0 }),
    sampleLight: () => null,
    sampleVolumeLight: () => ({ direction: [0, 0, 1], radiance: [4, 4, 4], pdf: 2, distance: 1 }),
    transmittance: () => [0.25, 0.5, 1],
    occluded: () => false,
    lightPdf: () => 0,
  };
  const value = integratePath(scene, { origin: [0, 0, 0], direction: [0, 0, 1] }, () => 0.1, { maxBounces: 1 });
  for (const [axis, tr] of [0.25, 0.5, 1].entries()) {
    expect(value[axis]).toBeCloseTo(1 + 2 * tr / (4 * Math.PI), 10);
  }
});

it('samples emissive volume domains without duplicating the BSDF evaluation or double counting direct EDF', () => {
  const shader = pathTraceComputeWgsl({ volumeGrid: true, media: true, volumeEmission: true });
  const integrate = shader.slice(shader.indexOf('fn integrate('));
  expect(integrate.match(/mx_closure_eval_parts\(/g)).toHaveLength(1);
  expect(integrate).toContain('if (!volumeEmissionNee)');
  expect(integrate).toContain('let light = mx_sample_volume_light(sp, state)');
  expect(integrate).toContain('volumeEmissionNee = volumeNee');
  const volumeNee = integrate.slice(integrate.indexOf('if (volumeNee)'), integrate.indexOf('let wiM = mx_sample_hg'));
  expect(volumeNee.match(/mx_transmittance\(/g)).toHaveLength(1);
  expect(shader).toContain('mx_volume_point_inside(index,position)');
  expect(() => pathTraceComputeWgsl({ volumeEmission: true })).toThrow('medium-aware visibility');
});

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

it('rejects instance-dependent volume transforms without rejecting unrelated surface inputs', () => {
  const value = (name: string, type: string, raw: string) => ({
    name, type, source: { kind: 'value' as const, type, value: raw }, provenance: { namePath: `/${name}` },
  });
  const connection = (name: string, nodeId: string) => ({
    name, type: 'vector3', source: { kind: 'connection' as const, nodeId }, provenance: { namePath: `/${name}` },
  });
  const volume: ResolvedVolume = { nodeId: 'v', inputs: new Map([
    ['absorption', { name: 'absorption', type: 'vector3', source: { kind: 'connection', nodeId: 'transform' } }],
  ]) };
  const graph = (from: string, to: string, geometry: boolean): ResolvedGraph => ({
    terminals: [],
    nodes: new Map<string, ResolvedNode>([
      ['transform', { id: 'transform', category: 'transformpoint', type: 'vector3', provenance: { namePath: '/transform' },
        inputs: [geometry ? connection('in', 'position') : value('in', 'vector3', '1,2,3'),
          value('fromspace', 'string', from), value('tospace', 'string', to)] }],
      ['position', { id: 'position', category: 'position', type: 'vector3', inputs: [], provenance: { namePath: '/position' } }],
    ]),
  });
  expect(() => lowerVolumeInputsToIr(volume, new IrModuleBuilder(), graph('object', 'world', false)))
    .toThrow('needs per-instance geometric data');
  expect(() => lowerVolumeInputsToIr(volume, new IrModuleBuilder(), graph('object', 'object', true)))
    .toThrow('needs per-instance geometric data');
  const builder = new IrModuleBuilder();
  builder.add({ kind: 'input', type: matrix(4), name: OBJECT_TO_WORLD_INPUT });
  expect(() => lowerVolumeInputsToIr(volume, builder, graph('world', 'world', false))).not.toThrow();
});

it('rejects implicit object-space flake3d in a volume but accepts an explicit position', () => {
  const volume: ResolvedVolume = { nodeId: 'v', inputs: new Map([
    ['anisotropy', { name: 'anisotropy', type: 'float', source: { kind: 'connection', nodeId: 'flake', output: 'presence' } }],
  ]) };
  const flake: ResolvedNode = {
    id: 'flake', category: 'flake3d', type: 'multioutput', inputs: [], provenance: { namePath: '/flake' },
  };
  const graph: ResolvedGraph = { terminals: [], nodes: new Map([['flake', flake]]) };
  expect(() => lowerVolumeInputsToIr(volume, new IrModuleBuilder(), graph)).toThrow('needs per-instance geometric data');
  flake.inputs.push({
    name: 'position', type: 'vector3', source: { kind: 'value', type: 'vector3', value: '0.1, 0.2, 0.3' },
    provenance: { namePath: '/flake/position' },
  });
  expect(() => lowerVolumeInputsToIr(volume, new IrModuleBuilder(), graph)).not.toThrow();

  const normalVolume: ResolvedVolume = { ...volume, inputs: new Map([
    ['absorption', { name: 'absorption', type: 'vector3', source: { kind: 'connection', nodeId: 'flake', output: 'flakenormal' } }],
  ]) };
  expect(() => lowerVolumeInputsToIr(normalVolume, new IrModuleBuilder(), graph)).toThrow('needs a surface tangent frame');
  for (const [name, raw] of [['normal', '0, 0, 1'], ['tangent', '1, 0, 0'], ['bitangent', '0, 1, 0']] as const) {
    flake.inputs.push({
      name, type: 'vector3', source: { kind: 'value', type: 'vector3', value: raw }, provenance: { namePath: `/flake/${name}` },
    });
  }
  expect(() => lowerVolumeInputsToIr(normalVolume, new IrModuleBuilder(), graph)).not.toThrow();
});

it('rejects implicit object-space Worley 3D in a volume and bakes an explicit world-space field', () => {
  const volume: ResolvedVolume = { nodeId: 'v', inputs: new Map([
    ['absorption', { name: 'absorption', type: 'vector3', source: { kind: 'connection', nodeId: 'worley' } }],
    ['scattering', { name: 'scattering', type: 'vector3', source: { kind: 'value', value: [0, 0, 0] } }],
    ['anisotropy', { name: 'anisotropy', type: 'float', source: { kind: 'value', value: [0] } }],
  ]) };
  const worley: ResolvedNode = { id: 'worley', category: 'worleynoise3d', type: 'vector3', inputs: [
    { name: 'jitter', type: 'float', source: { kind: 'value', type: 'float', value: '0' }, provenance: { namePath: '/worley/jitter' } },
  ], provenance: { namePath: '/worley' } };
  const position: ResolvedNode = { id: 'position', category: 'position', type: 'vector3', inputs: [
    { name: 'space', type: 'string', source: { kind: 'value', type: 'string', value: 'world' }, provenance: { namePath: '/position/space' } },
  ], provenance: { namePath: '/position' } };
  const graph: ResolvedGraph = { terminals: [], nodes: new Map([['worley', worley], ['position', position]]) };
  expect(() => lowerVolumeInputsToIr(volume, new IrModuleBuilder(), graph)).toThrow('needs per-instance geometric data');
  worley.inputs.push({
    name: 'position', type: 'vector3', source: { kind: 'connection', nodeId: 'position' }, provenance: { namePath: '/worley/position' },
  });
  const builder = new IrModuleBuilder();
  appendVolumeIr(volume, builder, graph);
  const ir = builder.build();
  expect(isSpatialVolumeIr(ir)).toBe(true);
  const grid = bakeVolumeGrid(ir, { min: [0, 0, 0], max: [1, 1, 1] }, 3);
  expect(grid.data.every(Number.isFinite)).toBe(true);
  expect(grid.data[0]).toBeCloseTo(Math.sqrt(0.75), 6);
  expect(grid.data[130]).toBeCloseTo(0, 6);
  expect(grid.majorant).toBeGreaterThan(0);
});

it('rejects implicit UV-dependent Worley 2D in a volume but accepts explicit coordinates', () => {
  const volume: ResolvedVolume = { nodeId: 'v', inputs: new Map([
    ['absorption', { name: 'absorption', type: 'vector3', source: { kind: 'connection', nodeId: 'worley' } }],
    ['scattering', { name: 'scattering', type: 'vector3', source: { kind: 'value', value: [0, 0, 0] } }],
    ['anisotropy', { name: 'anisotropy', type: 'float', source: { kind: 'value', value: [0] } }],
  ]) };
  const worley: ResolvedNode = { id: 'worley', category: 'worleynoise2d', type: 'vector3', inputs: [
    { name: 'jitter', type: 'float', source: { kind: 'value', type: 'float', value: '0' }, provenance: { namePath: '/worley/jitter' } },
  ],
    provenance: { namePath: '/worley' } };
  const graph: ResolvedGraph = { terminals: [], nodes: new Map([['worley', worley]]) };
  expect(() => lowerVolumeInputsToIr(volume, new IrModuleBuilder(), graph)).toThrow('needs per-instance geometric data');
  worley.inputs.push({
    name: 'texcoord', type: 'vector2', source: { kind: 'value', type: 'vector2', value: '0.3, 0.7' },
    provenance: { namePath: '/worley/texcoord' },
  });
  const builder = new IrModuleBuilder();
  appendVolumeIr(volume, builder, graph);
  const grid = bakeVolumeGrid(builder.build(), { min: [0, 0, 0], max: [1, 1, 1] }, 2);
  expect(grid.data.every(Number.isFinite)).toBe(true);
  expect(grid.data[0]).toBeCloseTo(Math.sqrt(0.08), 6);
  expect(grid.data[10]).toBeCloseTo(grid.data[0]!, 6);
});

it('rejects object-space or image-dependent triplanar volume fields explicitly', () => {
  const volume: ResolvedVolume = { nodeId: 'v', inputs: new Map([
    ['absorption', { name: 'absorption', type: 'vector3', source: { kind: 'connection', nodeId: 'tri' } }],
    ['scattering', { name: 'scattering', type: 'vector3', source: { kind: 'value', value: [0, 0, 0] } }],
    ['anisotropy', { name: 'anisotropy', type: 'float', source: { kind: 'value', value: [0] } }],
  ]) };
  const tri: ResolvedNode = {
    id: 'tri', category: 'triplanarprojection', type: 'vector3', inputs: [
      { name: 'filex', type: 'filename', source: { kind: 'value', type: 'filename', value: 'x.png' }, provenance: { namePath: '/tri/filex' } },
    ], provenance: { namePath: '/tri' },
  };
  const graph: ResolvedGraph = { terminals: [], nodes: new Map([['tri', tri]]) };
  expect(() => lowerVolumeInputsToIr(volume, new IrModuleBuilder(), graph)).toThrow('needs per-instance geometric data');
  tri.inputs.push(
    { name: 'position', type: 'vector3', source: { kind: 'value', type: 'vector3', value: '0.1,0.2,0.3' }, provenance: { namePath: '/tri/position' } },
    { name: 'normal', type: 'vector3', source: { kind: 'value', type: 'vector3', value: '0,0,1' }, provenance: { namePath: '/tri/normal' } },
  );
  const builder = new IrModuleBuilder();
  appendVolumeIr(volume, builder, graph);
  expect(() => bakeVolumeGrid(builder.build(), { min: [0, 0, 0], max: [1, 1, 1] }, 2))
    .toThrow('Volume image inputs require a 3D image sampler');
});

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
