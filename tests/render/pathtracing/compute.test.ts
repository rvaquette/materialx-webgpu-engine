import { describe, expect, it, vi } from 'vitest';
import {
  buildPathTraceUniform,
  pathTraceComputeWgsl,
  PathTraceBackend,
  PT_COMPUTE_ENTRY,
  PT_UNIFORM_FLOATS,
  PT_WORKGROUP_SIZE,
} from '../../../src/render/pathtracing/compute.ts';
import type { PathTraceScene } from '../../../src/render/pathtracing/scene-buffers.ts';
import { IDENTITY4 } from '../../../src/scene/transforms.ts';

function fakeScene(): PathTraceScene {
  return {
    nodes: new Float32Array(),
    nodeCount: 0,
    triangles: new Float32Array(),
    triangleOrder: new Uint32Array(),
    triangleCount: 0,
    materials: new Float32Array(),
    materialCount: 0,
    triangleUv: new Float32Array(),
    materialKeys: [],
    camera: { viewProj: IDENTITY4, invViewProj: IDENTITY4, eye: [1, 2, 3], exposure: 0 },
    light: { direction: [0, 0, -1], color: [1, 0.5, 0.25], intensity: 4 },
    environment: { radiance: [0.1, 0.2, 0.3] },
    bounds: { min: [0, 0, 0], max: [0, 0, 0] },
  };
}

describe('pathTraceComputeWgsl', () => {
  const src = pathTraceComputeWgsl();

  it('declares the compute entry point and workgroup tile', () => {
    expect(src).toContain(`fn ${PT_COMPUTE_ENTRY}`);
    expect(src).toContain(`@workgroup_size(${PT_WORKGROUP_SIZE}, ${PT_WORKGROUP_SIZE}, 1)`);
    expect(src).toContain('@compute');
  });

  it('includes BVH traversal, surface closures and the integrator', () => {
    expect(src).toContain('fn traverse(');
    expect(src).toContain('fn intersect_tri(');
    expect(src).toContain('fn surface_eval(');
    expect(src).toContain('fn surface_sample(');
    expect(src).toContain('fn integrate(');
    expect(src).toContain('fn power_heuristic(');
    expect(src).toContain('fn pcg_hash(');
  });

  it('binds the scene storage buffers and the accumulation buffer', () => {
    expect(src).toContain('var<storage, read> nodes');
    expect(src).toContain('var<storage, read> tris');
    expect(src).toContain('var<storage, read> triOrder');
    expect(src).toContain('var<storage, read> materials');
    expect(src).toContain('var<storage, read_write> accum');
  });

  it('accumulates progressively with a running mean keyed by frame', () => {
    expect(src).toContain('accum[pixel]');
    expect(src).toContain('prev.w');
  });
});

describe('buildPathTraceUniform layout', () => {
  it('packs invViewProj, eye, light, environment and frame counters', () => {
    const u = buildPathTraceUniform(fakeScene(), 7, 2, 320, 180);
    expect(u.length).toBe(PT_UNIFORM_FLOATS);
    // invViewProj occupies floats 0..15 (identity).
    expect(u[0]).toBeCloseTo(1);
    expect(u[5]).toBeCloseTo(1);
    // eye at 16..18.
    expect(u[16]).toBeCloseTo(1);
    expect(u[17]).toBeCloseTo(2);
    expect(u[18]).toBeCloseTo(3);
    // light direction 20..22, color 24..26, intensity 27.
    expect(u[22]).toBeCloseTo(-1);
    expect(u[24]).toBeCloseTo(1);
    expect(u[25]).toBeCloseTo(0.5);
    expect(u[26]).toBeCloseTo(0.25);
    expect(u[27]).toBeCloseTo(4);
    // environment 28..30.
    expect(u[28]).toBeCloseTo(0.1);
    expect(u[30]).toBeCloseTo(0.3);
    // frame counters 32..35.
    expect(u[32]).toBeCloseTo(7);
    expect(u[33]).toBeCloseTo(2);
    expect(u[34]).toBeCloseTo(320);
    expect(u[35]).toBeCloseTo(180);
  });
});

describe('PathTraceBackend', () => {
  function mockDevice() {
    const createComputePipeline = vi.fn((_desc: any) => ({ id: 'pipeline' }));
    const createShaderModule = vi.fn((_desc: any) => ({ id: 'module' }));
    return {
      device: { createComputePipeline, createShaderModule } as unknown as GPUDevice,
      createComputePipeline,
      createShaderModule,
    };
  }

  it('creates a compute pipeline from the generated WGSL with an auto layout', () => {
    const { device, createComputePipeline, createShaderModule } = mockDevice();
    const backend = new PathTraceBackend(device);
    backend.createPipeline();
    expect(createShaderModule).toHaveBeenCalledOnce();
    const shaderArg = createShaderModule.mock.calls[0]![0];
    expect(shaderArg.code).toContain(`fn ${PT_COMPUTE_ENTRY}`);
    const pipelineArg = createComputePipeline.mock.calls[0]![0];
    expect(pipelineArg.layout).toBe('auto');
    expect(pipelineArg.compute.entryPoint).toBe(PT_COMPUTE_ENTRY);
  });

  it('caches the pipeline across calls', () => {
    const { device, createComputePipeline } = mockDevice();
    const backend = new PathTraceBackend(device);
    backend.createPipeline();
    backend.createPipeline();
    expect(createComputePipeline).toHaveBeenCalledOnce();
  });

  it('tracks and resets the progressive frame counter', () => {
    const { device } = mockDevice();
    const backend = new PathTraceBackend(device);
    expect(backend.advanceFrame()).toBe(0);
    expect(backend.advanceFrame()).toBe(1);
    expect(backend.frameIndex).toBe(2);
    backend.resetAccumulation();
    expect(backend.frameIndex).toBe(0);
  });

  it('computes the workgroup count to cover an image', () => {
    expect(PathTraceBackend.workgroupCount(320, 180)).toEqual([40, 23]);
  });
});
