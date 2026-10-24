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

    // Two materials, two texture slots, but the shared file decodes once.
    expect(bindings.textures.map((t) => t.binding)).toEqual([0, 1]);
    expect(bindings.textures.map((t) => t.imageIndex)).toEqual([0, 0]);
    expect(bindings.images).toHaveLength(1);
    expect(calls).toEqual(['brick_base.jpg']);
    // One sampler per texture slot, repeat + linear.
    expect(bindings.samplers.map((s) => s.binding)).toEqual([0, 1]);
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
    expect(bindings.textures.map((t) => t.imageIndex)).toEqual([0, 0, 0]);
    expect(bindings.textures.map((t) => t.format)).toEqual(['rgba8unorm-srgb', 'rgba8unorm', 'rgba8unorm']);
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
    expect(bindings.textures.map((t) => t.imageIndex)).toEqual([0, 0]);
    expect(bindings.samplers.map((s) => s.descriptor)).toEqual([
      { addressModeU: 'clamp-to-edge', addressModeV: 'mirror-repeat', magFilter: 'nearest', minFilter: 'nearest' },
      { addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear' },
    ]);
  });
});
