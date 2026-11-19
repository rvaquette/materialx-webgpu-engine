// T057m2: buildPtDeviceBindings turns a material dispatch + scene into the
// graph-path device binding plan (group-0 buffer order, deduped textures, their
// samplers) the harness uploads. These tests drive it as pure data -- a fake
// image provider that counts decode calls proves shared files decode once -- with
// no WebGPU. The device.createTexture/createBindGroup calls live in the harness.

import { describe, it, expect } from 'vitest';
import {
  buildPtDeviceBindings,
  type PtImageProvider,
} from '../../../src/render/pathtracing/device-bindings.ts';
import {
  buildMaterialDispatch,
  type PtVariantSource,
} from '../../../src/render/pathtracing/material-variant.ts';
import { resolveSurface } from '../../../src/materialx/surface-graph.ts';
import type {
  ResolvedGraph,
  ResolvedInput,
  ResolvedNode,
  ResolvedValueSource,
} from '../../../src/materialx/graph.ts';
import type { PathTraceScene } from '../../../src/render/pathtracing/scene-buffers.ts';
import type { DecodedPixelImage } from '../../../src/assets/images.ts';
import { pathTraceComputeWgsl } from '../../../src/render/pathtracing/compute.ts';
import { inverse4, scaling4, translation4 } from '../../../src/scene/transforms.ts';

const IDENTITY4: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number] =
  [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// --- ResolvedGraph builders (as in material-variant.test.ts) -----------------

function value(name: string, type: string, raw: string, colorSpace?: string): ResolvedInput {
  const source: ResolvedValueSource = { kind: 'value', value: raw, type };
  return colorSpace !== undefined
    ? { name, type, source, colorSpace, provenance: { namePath: `/mat/${name}` } }
    : { name, type, source, provenance: { namePath: `/mat/${name}` } };
}

function conn(name: string, type: string, nodeId: string): ResolvedInput {
  return { name, type, source: { kind: 'connection', nodeId }, provenance: { namePath: `/mat/${name}` } };
}

function upstream(id: string, category: string, type: string, inputs: ResolvedInput[]): ResolvedNode {
  return { id, category, type, inputs, provenance: { namePath: `/mat/${id}` } };
}

function surfaceGraph(category: string, surfaceInputs: ResolvedInput[], upstreamNodes: ResolvedNode[] = []): ResolvedGraph {
  const surface: ResolvedNode = {
    id: 'SR',
    category,
    type: 'surfaceshader',
    inputs: surfaceInputs,
    provenance: { namePath: '/mat/SR' },
  };
  const nodes = new Map<string, ResolvedNode>([['SR', surface]]);
  for (const n of upstreamNodes) nodes.set(n.id, n);
  return {
    terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: 'SR', provenance: { namePath: '/mat/SR' } }],
    nodes,
  };
}

function source(materialIndex: number, graph: ResolvedGraph): PtVariantSource {
  const surface = resolveSurface(graph, {});
  expect(surface).not.toBeNull();
  return { materialIndex, graph, surface: surface! };
}

/** standard_surface whose base_color is driven by an image on `file`. */
function texturedBaseColor(file: string): ResolvedGraph {
  return surfaceGraph(
    'standard_surface',
    [conn('base_color', 'color3', 'tex')],
    [upstream('tex', 'image', 'color3', [value('file', 'filename', file, 'srgb_texture')])],
  );
}

// --- fakes -------------------------------------------------------------------

function fakeImage(): DecodedPixelImage {
  return { kind: 'pixels', data: new Uint8Array([255, 0, 0, 255]), componentType: 'uint8', channels: 4, width: 1, height: 1, colorSpace: 'srgb_texture' };
}

function countingProvider(image: DecodedPixelImage | undefined): { calls: string[]; provider: PtImageProvider } {
  const calls: string[] = [];
  return { calls, provider: { decode: (f: string) => { calls.push(f); return image; } } };
}

it('packs per-instance transforms in the existing UV binding for shading and opacity', async () => {
  const graph = surfaceGraph('standard_surface', [
    conn('base_color', 'color3', 'point'), conn('opacity', 'color3', 'point'),
    conn('normal', 'vector3', 'normal'),
  ], [
    upstream('point', 'transformpoint', 'vector3', [
      value('in', 'vector3', '0.2,0.3,0.4'), value('fromspace', 'string', 'object'), value('tospace', 'string', 'world'),
    ]),
    upstream('normal', 'transformnormal', 'vector3', [
      value('in', 'vector3', '0,0,1'), value('fromspace', 'string', 'object'), value('tospace', 'string', 'world'),
    ]),
  ]);
  const dispatch = buildMaterialDispatch([source(0, graph)]);
  const scene = fakeScene();
  scene.triangleCount = 3;
  scene.triangles = new Float32Array(3 * 19);
  scene.triangleUv = new Float32Array(Array.from({ length: 18 }, (_, i) => i / 20));
  const firstModel = translation4(2, 3, 4);
  const secondModel = scaling4(2, 3, 4);
  scene.transformRanges = [
    { firstTriangle: 0, triangleCount: 1, materialIndex: 0, instanceId: '/a', model: firstModel },
    { firstTriangle: 1, triangleCount: 2, materialIndex: 0, instanceId: '/b', model: secondModel },
  ];
  const bindings = await buildPtDeviceBindings(dispatch, scene, countingProvider(undefined).provider);
  expect(bindings.group0).toHaveLength(8);
  const packed = bindings.group0.find(slot => slot.role === 'triangleUv')!.data as Float32Array;
  expect(Array.from(packed.slice(0, 18))).toEqual(Array.from(scene.triangleUv));
  expect(Array.from(packed.slice(18, 21))).toEqual([0, 1, 1]);
  expect(Array.from(packed.slice(21, 37))).toEqual(firstModel);
  expect(Array.from(packed.slice(37, 53))).toEqual(inverse4(firstModel, true));
  Array.from(packed.slice(69, 85)).forEach((value, i) => expect(value).toBeCloseTo(inverse4(secondModel, true)[i]!, 6));
  const wgsl = pathTraceComputeWgsl({ dispatch });
  expect(wgsl).toContain('vary.in_mx_objectToWorld = mx_hit_transform(h.tri, 0u);');
  expect(wgsl).toContain('vary.in_mx_worldToObject = mx_hit_transform(h.tri, 1u);');
  expect(dispatch.opacityReadsVaryings).toBe(true);
  expect(wgsl).toContain('mx_hit_varyings(hit, pos, surface_hit_normal(hit), normalize(-rd))');

  scene.transformRanges[1]!.model = scaling4(0, 1, 1);
  await expect(buildPtDeviceBindings(dispatch, scene, countingProvider(undefined).provider)).rejects.toThrow(/singular/);
  delete scene.transformRanges;
  await expect(buildPtDeviceBindings(dispatch, scene, countingProvider(undefined).provider)).rejects.toThrow(/lacks instance transforms/);
});

it('packs shared object vertices for transformed geometry and opacity without changing UVs', async () => {
  const graph = surfaceGraph('standard_surface', [
    conn('base_color', 'color3', 'point'), conn('opacity', 'color3', 'point'),
    conn('normal', 'vector3', 'normal'),
  ], [
    upstream('point', 'transformpoint', 'vector3', [
      conn('in', 'vector3', 'position'), value('fromspace', 'string', 'object'), value('tospace', 'string', 'world'),
    ]),
    upstream('position', 'position', 'vector3', []),
    upstream('normal', 'transformnormal', 'vector3', [
      conn('in', 'vector3', 'normalObject'), value('fromspace', 'string', 'object'), value('tospace', 'string', 'world'),
    ]),
    upstream('normalObject', 'normal', 'vector3', []),
  ]);
  const dispatch = buildMaterialDispatch([source(0, graph)]);
  const scene = fakeScene();
  scene.triangleCount = 3;
  scene.triangles = new Float32Array(3 * 19);
  scene.triangles[19 + 18] = 1;
  scene.triangleUv = new Float32Array(Array.from({ length: 18 }, (_, i) => i / 20));
  scene.transformRanges = [
    { firstTriangle: 0, triangleCount: 1, materialIndex: 0, instanceId: '/a', prototypeId: '/mesh', model: translation4(1, 2, 3) },
    { firstTriangle: 1, triangleCount: 1, materialIndex: 1, instanceId: '/other', prototypeId: '/otherMesh', model: IDENTITY4 },
    { firstTriangle: 2, triangleCount: 1, materialIndex: 0, instanceId: '/b', prototypeId: '/mesh', model: scaling4(2, 3, 4) },
  ];
  scene.objectGeometry = new Map([['/mesh', {
    indices: new Uint32Array([2, 0, 1]),
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    tangents: new Float32Array([1, 0, 0, -1, 1, 0, 0, -1, 1, 0, 0, -1]),
    tangentComponents: 4,
  }]]);
  const bindings = await buildPtDeviceBindings(dispatch, scene, countingProvider(undefined).provider);
  const packed = bindings.group0.find(slot => slot.role === 'triangleUv')!.data as Float32Array;
  expect(Array.from(packed.slice(0, 18))).toEqual(Array.from(scene.triangleUv));
  expect(Array.from(packed.slice(18, 21))).toEqual([0, 1, 2]);
  expect(Array.from(packed.slice(117, 126))).toEqual([3, 1, 2, 0, 0, 0, 3, 1, 2]);
  expect(Array.from(packed.slice(137, 148))).toEqual([0, 0, 0, 0, 0, 1, 1, 0, 0, -1, 1]);
  expect(packed.length).toBe(126 + 4 * 11);
  expect(dispatch.opacityReadsVaryings).toBe(true);
  const wgsl = pathTraceComputeWgsl({ dispatch });
  expect(wgsl).toContain('vary.in_mx_objectPosition = oa.position * objectWeight');
  expect(wgsl).toContain('vary.in_mx_objectNormal = objectN;');
  expect(wgsl).toContain('mx_hit_varyings(hit, pos, surface_hit_normal(hit), normalize(-rd))');

  const geometry = scene.objectGeometry.get('/mesh')!;
  scene.objectGeometry.set('/mesh', { indices: geometry.indices, positions: geometry.positions });
  const noFrame = await buildPtDeviceBindings(dispatch, scene, countingProvider(undefined).provider);
  const noFramePacked = noFrame.group0.find(slot => slot.role === 'triangleUv')!.data as Float32Array;
  expect(Array.from(noFramePacked.slice(140, 148))).toEqual(Array(8).fill(0));

  scene.objectGeometry.delete('/mesh');
  await expect(buildPtDeviceBindings(dispatch, scene, countingProvider(undefined).provider)).rejects.toThrow(/Missing object-space geometry/);
});

function fakeScene(): PathTraceScene {
  return {
    nodes: new Float32Array([1]),
    nodeCount: 0,
    triangles: new Float32Array([2]),
    triangleOrder: new Uint32Array([3]),
    triangleCount: 0,
    materials: new Float32Array([4]),
    materialCount: 0,
    triangleUv: new Float32Array([5]),
    triangleTangent: new Float32Array([6]),
    materialKeys: [],
    variantSources: [],
    camera: { viewProj: IDENTITY4, invViewProj: IDENTITY4, eye: [0, 0, 0], exposure: 0 },
    light: { direction: [0, 0, -1], color: [1, 1, 1], intensity: 1 },
    environment: { radiance: [0, 0, 0] },
    bounds: { min: [0, 0, 0], max: [0, 0, 0] },
  };
}

describe('buildPtDeviceBindings (T057m2)', () => {
  it('shares UDIM tile decoding while preserving array and integer-index binding types', async () => {
    const dispatch = buildMaterialDispatch([
      source(0, texturedBaseColor('color.%3CUDIM%3E.jpg')),
      source(1, texturedBaseColor('color.%3CUDIM%3E.jpg')),
    ]);
    const first = fakeImage();
    const image: DecodedPixelImage = { ...first, udim: [{ tile: 1001, image: first }, { tile: 1012, image: first }] };
    const { calls, provider } = countingProvider(image);
    const bindings = await buildPtDeviceBindings(dispatch, fakeScene(), provider);
    expect(calls).toEqual(['color.%3CUDIM%3E.jpg']);
    expect(bindings.textures.map(texture => texture.imageIndex)).toEqual([0, 0]);
    expect(bindings.textures.map(texture => texture.textureKind)).toEqual(['udim', 'udim-index']);
    expect(bindings.textures.map(texture => texture.format)).toEqual(['rgba8unorm-srgb', 'r32uint']);
    expect(bindings.samplers).toHaveLength(1);
    const code = pathTraceComputeWgsl({ dispatch });
    expect(code).toContain('var m0_tex_tex: texture_2d_array<f32>');
    expect(code).toContain('var m0_tex_tex_udim_index: texture_2d<u32>');
    expect(code.match(/fn mx_sample_udim\(/g)).toHaveLength(1);
    expect(code).not.toMatch(/\bm1_tex_tex\b|\bm1_samp_tex\b/);
  });
  it('adds converted analytic lights without moving the existing scene slots', async () => {
    const scene = fakeScene();
    scene.analyticLights = new Float32Array(17 * 20);
    const bindings = await buildPtDeviceBindings(buildMaterialDispatch([]), scene, countingProvider(fakeImage()).provider);
    expect(bindings.group0.map(slot => slot.binding)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 9]);
    expect(bindings.group0[8]).toEqual({ binding: 9, role: 'analyticLights', usage: 'storage', access: 'read', data: scene.analyticLights });
  });
  it('orders the group-0 scene buffers in megakernel binding order', async () => {
    const dispatch = buildMaterialDispatch([source(0, surfaceGraph('standard_surface', [value('base_color', 'color3', '0.2, 0.4, 0.6')]))]);
    const scene = fakeScene();
    const bindings = await buildPtDeviceBindings(dispatch, scene, countingProvider(fakeImage()).provider);

    expect(bindings.group0.map((s) => s.binding)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(bindings.group0.map((s) => s.role)).toEqual([
      'uniform', 'nodes', 'triangles', 'triangleOrder', 'materials', 'accum', 'triangleUv', 'triangleTangent',
    ]);
    // Scene-sourced slots carry their payload; uniform + accum are sized by the harness.
    expect(bindings.group0[1]!.data).toBe(scene.nodes);
    expect(bindings.group0[3]!.data).toBe(scene.triangleOrder);
    expect(bindings.group0[7]!.data).toBe(scene.triangleTangent);
    expect(bindings.group0[0]!.data).toBeUndefined();
    expect(bindings.group0[5]!.data).toBeUndefined();
    expect(bindings.group0[5]!.access).toBe('read_write');
  });

  it('maps every texture slot to its image and decodes shared files once', async () => {
    const dispatch = buildMaterialDispatch([
      source(0, texturedBaseColor('brick_base.jpg')),
      source(1, texturedBaseColor('brick_base.jpg')),
    ]);
    const { calls, provider } = countingProvider(fakeImage());
    const bindings = await buildPtDeviceBindings(dispatch, fakeScene(), provider);

    // Two materials share one texture binding and one decoded image.
    expect(bindings.textures.map((t) => t.binding)).toEqual([0]);
    expect(bindings.textures.map((t) => t.imageIndex)).toEqual([0]);
    expect(bindings.images).toHaveLength(1);
    expect(calls).toEqual(['brick_base.jpg']);
    expect(bindings.samplers.map((s) => s.binding)).toEqual([0]);
    expect(bindings.samplers[0]!.descriptor).toEqual({
      addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear',
    });
  });

  it('produces no texture or sampler slots for constant materials', async () => {
    const dispatch = buildMaterialDispatch([source(0, surfaceGraph('standard_surface', [value('base_color', 'color3', '0.8, 0.1, 0.1')]))]);
    const bindings = await buildPtDeviceBindings(dispatch, fakeScene(), countingProvider(fakeImage()).provider);
    expect(bindings.textures).toHaveLength(0);
    expect(bindings.samplers).toHaveLength(0);
    expect(bindings.images).toHaveLength(0);
  });

  it('chooses sRGB decoding per binding, not from the shared decoded file', async () => {
    const dataGraph = surfaceGraph('standard_surface', [conn('base_color', 'color3', 'tex')], [
      upstream('tex', 'image', 'color3', [value('file', 'filename', 'shared.png', 'lin_rec709')]),
    ]);
    const unspecifiedGraph = surfaceGraph('standard_surface', [conn('base_color', 'color3', 'tex')], [
      upstream('tex', 'image', 'color3', [value('file', 'filename', 'shared.png')]),
    ]);
    const dispatch = buildMaterialDispatch([
      source(0, texturedBaseColor('shared.png')), source(1, dataGraph), source(2, unspecifiedGraph),
    ]);
    const { calls, provider } = countingProvider(fakeImage());
    const bindings = await buildPtDeviceBindings(dispatch, fakeScene(), provider);
    expect(calls).toEqual(['shared.png']);
    expect(bindings.textures.map((t) => t.imageIndex)).toEqual([0, 0]);
    expect(bindings.textures.map((t) => t.format)).toEqual(['rgba8unorm-srgb', 'rgba8unorm']);
  });

  it('warns and leaves the image undefined when a file fails to decode', async () => {
    const dispatch = buildMaterialDispatch([source(0, texturedBaseColor('missing.jpg'))]);
    const messages: string[] = [];
    const bindings = await buildPtDeviceBindings(dispatch, fakeScene(), countingProvider(undefined).provider, {
      sink: (d) => messages.push(d.message),
    });
    expect(bindings.images).toEqual([undefined]);
    expect(bindings.textures).toHaveLength(1);
    expect(messages.join('\n')).toContain('failed to decode');
  });

  it('keeps per-material addressing and filtering when images are deduplicated', async () => {
    const graph = surfaceGraph('standard_surface', [conn('base_color', 'color3', 'tex')], [
      upstream('tex', 'image', 'color3', [
        value('file', 'filename', 'shared.png', 'srgb_texture'),
        value('uaddressmode', 'string', 'clamp'),
        value('vaddressmode', 'string', 'mirror'),
        value('filtertype', 'string', 'closest'),
      ]),
    ]);
    const dispatch = buildMaterialDispatch([source(0, graph), source(1, texturedBaseColor('shared.png'))]);
    const { calls, provider } = countingProvider(fakeImage());
    const bindings = await buildPtDeviceBindings(dispatch, fakeScene(), provider);
    expect(calls).toEqual(['shared.png']);
    expect(bindings.textures.map((t) => t.imageIndex)).toEqual([0]);
    expect(bindings.samplers.map((s) => s.descriptor)).toEqual([
      { addressModeU: 'clamp-to-edge', addressModeV: 'mirror-repeat', magFilter: 'nearest', minFilter: 'nearest' },
      { addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear' },
    ]);
  });
});
