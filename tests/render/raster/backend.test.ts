import { describe, expect, it, vi } from 'vitest';
import { FRAME_BIND_GROUP, RasterBackend } from '../../../src/render/raster/backend.ts';

interface MockPass {
  setPipeline: ReturnType<typeof vi.fn>;
  setBindGroup: ReturnType<typeof vi.fn>;
  setVertexBuffer: ReturnType<typeof vi.fn>;
  setIndexBuffer: ReturnType<typeof vi.fn>;
  drawIndexed: ReturnType<typeof vi.fn>;
  draw: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

function mockPass(): MockPass {
  return {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    setVertexBuffer: vi.fn(),
    setIndexBuffer: vi.fn(),
    drawIndexed: vi.fn(),
    draw: vi.fn(),
    end: vi.fn(),
  };
}

function mockDevice() {
  return {
    createShaderModule: vi.fn((desc: { code: string }) => ({ desc })),
    createRenderPipeline: vi.fn((desc: Record<string, unknown>) => ({ desc })),
  };
}

function makeBackend(tonemap?: 'none' | 'reinhard' | 'acesFilmic') {
  const device = mockDevice();
  const backend = new RasterBackend({
    device: device as unknown as GPUDevice,
    outputFormat: 'bgra8unorm',
    ...(tonemap ? { tonemap } : {}),
  });
  return { device, backend };
}

describe('RasterBackend pipelines', () => {
  it('compiles the forward pipeline into the HDR target with depth', () => {
    const { device, backend } = makeBackend();
    const code = '@vertex fn vs_forward() {} @fragment fn fs_forward() {}';
    const pipeline = backend.createForwardPipeline(code);
    expect(device.createShaderModule).toHaveBeenCalledOnce();
    expect(device.createShaderModule.mock.calls[0]![0].code).toBe(code);
    const desc = device.createRenderPipeline.mock.calls[0]![0] as any;
    expect(desc.vertex.entryPoint).toBe('vs_forward');
    expect(desc.fragment.entryPoint).toBe('fs_forward');
    expect(desc.vertex.buffers).toHaveLength(3);
    expect(desc.fragment.targets[0].format).toBe('rgba16float');
    expect(desc.depthStencil.format).toBe('depth24plus');
    expect(backend.forwardPipeline).toBe(pipeline);
  });

  it('compiles the resolve pipeline into the output format with no depth', () => {
    const { device, backend } = makeBackend('reinhard');
    const pipeline = backend.createResolvePipeline();
    expect(device.createShaderModule.mock.calls[0]![0].code).toContain('c / (vec3<f32>(1.0) + c)');
    const desc = device.createRenderPipeline.mock.calls[0]![0] as any;
    expect(desc.fragment.targets[0].format).toBe('bgra8unorm');
    expect(desc.depthStencil).toBeUndefined();
    expect(backend.resolvePipeline).toBe(pipeline);
  });
});

describe('RasterBackend frame recording', () => {
  const opaqueTargets = {
    hdrView: {} as GPUTextureView,
    depthView: {} as GPUTextureView,
    materialBindGroup: { id: 'm' } as unknown as GPUBindGroup,
    frameBindGroup: { id: 'f' } as unknown as GPUBindGroup,
    geometry: {
      positionBuffer: { id: 'p' } as unknown as GPUBuffer,
      normalBuffer: { id: 'n' } as unknown as GPUBuffer,
      texcoordBuffer: { id: 't' } as unknown as GPUBuffer,
      indexBuffer: {} as GPUBuffer,
      indexCount: 36,
    },
  };
  const resolveTargets = { outputView: {} as GPUTextureView, bindGroup: {} as GPUBindGroup };

  it('records a draw-indexed opaque pass', () => {
    const { backend } = makeBackend();
    const pipeline = backend.createForwardPipeline('@vertex fn vs_forward() {}');
    const pass = mockPass();
    const encoder = { beginRenderPass: vi.fn(() => pass) };
    backend.recordOpaquePass(encoder as unknown as GPUCommandEncoder, opaqueTargets);
    expect(encoder.beginRenderPass).toHaveBeenCalledOnce();
    expect(pass.setPipeline).toHaveBeenCalledWith(pipeline);
    expect(pass.setBindGroup).toHaveBeenCalledWith(0, opaqueTargets.materialBindGroup);
    expect(pass.setBindGroup).toHaveBeenCalledWith(FRAME_BIND_GROUP, opaqueTargets.frameBindGroup);
    expect(pass.setVertexBuffer).toHaveBeenCalledWith(0, opaqueTargets.geometry.positionBuffer);
    expect(pass.setVertexBuffer).toHaveBeenCalledWith(1, opaqueTargets.geometry.normalBuffer);
    expect(pass.setVertexBuffer).toHaveBeenCalledWith(2, opaqueTargets.geometry.texcoordBuffer);
    expect(pass.setIndexBuffer).toHaveBeenCalledWith(opaqueTargets.geometry.indexBuffer, 'uint32');
    expect(pass.drawIndexed).toHaveBeenCalledWith(36);
    expect(pass.end).toHaveBeenCalledOnce();
  });

  it('records a fullscreen resolve pass with three vertices', () => {
    const { backend } = makeBackend();
    backend.createResolvePipeline();
    const pass = mockPass();
    const encoder = { beginRenderPass: vi.fn(() => pass) };
    backend.recordResolvePass(encoder as unknown as GPUCommandEncoder, resolveTargets);
    expect(pass.draw).toHaveBeenCalledWith(3);
    expect(pass.end).toHaveBeenCalledOnce();
  });

  it('throws if a pass is recorded before its pipeline exists', () => {
    const { backend } = makeBackend();
    const encoder = { beginRenderPass: vi.fn(() => mockPass()) };
    expect(() => backend.recordOpaquePass(encoder as unknown as GPUCommandEncoder, opaqueTargets)).toThrow();
  });

  it('records the full frame as opaque then resolve', () => {
    const { backend } = makeBackend();
    backend.createForwardPipeline('@vertex fn vs_forward() {}');
    backend.createResolvePipeline();
    const pass = mockPass();
    const encoder = { beginRenderPass: vi.fn(() => pass) };
    backend.recordFrame(encoder as unknown as GPUCommandEncoder, opaqueTargets, resolveTargets);
    expect(encoder.beginRenderPass).toHaveBeenCalledTimes(2);
    expect(pass.drawIndexed).toHaveBeenCalledWith(36);
    expect(pass.draw).toHaveBeenCalledWith(3);
  });
});

describe('RasterBackend scene forward path', () => {
  it('compiles a per-variant IR scene pipeline, caches it by key, and reads three vertex buffers', () => {
    const { device, backend } = makeBackend();
    const code = '// ir scene forward';
    const pipeline = backend.createSceneVariantPipeline('opaque', 'key-a', code);
    expect(device.createShaderModule.mock.calls[0]![0].code).toBe(code);
    const desc = device.createRenderPipeline.mock.calls[0]![0] as any;
    expect(desc.vertex.entryPoint).toBe('vs_forward');
    expect(desc.fragment.entryPoint).toBe('fs_forward');
    expect(desc.vertex.buffers).toHaveLength(3);
    expect(desc.vertex.buffers[2].attributes[0].shaderLocation).toBe(2);
    expect(backend.sceneVariantPipeline('opaque', 'key-a')).toBe(pipeline);
    // A second request for the same key returns the cache without recompiling.
    expect(backend.createSceneVariantPipeline('opaque', 'key-a', code)).toBe(pipeline);
    expect(device.createRenderPipeline).toHaveBeenCalledOnce();
    // The transmission pass keeps a distinct cache slot for the same key.
    expect(backend.sceneVariantPipeline('transmission', 'key-a')).toBeUndefined();
  });

  it('records a scene pass drawing every instance through its variant pipeline', () => {
    const { backend } = makeBackend();
    backend.createSceneVariantPipeline('opaque', 'ka', '// a');
    backend.createSceneVariantPipeline('opaque', 'kb', '// b');
    const draws = [
      { pipelineKey: 'ka', materialBindGroup: { id: 'ma' } as unknown as GPUBindGroup, frameBindGroup: { id: 'fa' } as unknown as GPUBindGroup, positionBuffer: { id: 'pa' } as unknown as GPUBuffer, normalBuffer: { id: 'na' } as unknown as GPUBuffer, indexBuffer: {} as GPUBuffer, indexCount: 3 },
      { pipelineKey: 'kb', materialBindGroup: { id: 'mb' } as unknown as GPUBindGroup, frameBindGroup: { id: 'fb' } as unknown as GPUBindGroup, positionBuffer: { id: 'pb' } as unknown as GPUBuffer, normalBuffer: { id: 'nb' } as unknown as GPUBuffer, indexBuffer: {} as GPUBuffer, indexCount: 6 },
    ];
    const pass = mockPass();
    const encoder = { beginRenderPass: vi.fn(() => pass) };
    backend.recordScenePass(encoder as unknown as GPUCommandEncoder, {
      pass: 'opaque',
      hdrView: {} as GPUTextureView,
      depthView: {} as GPUTextureView,
      draws,
    });
    expect(pass.setBindGroup).toHaveBeenCalledWith(0, draws[0]!.materialBindGroup);
    expect(pass.setBindGroup).toHaveBeenCalledWith(FRAME_BIND_GROUP, draws[0]!.frameBindGroup);
    expect(pass.setVertexBuffer).toHaveBeenCalledWith(0, draws[0]!.positionBuffer);
    expect(pass.setVertexBuffer).toHaveBeenCalledWith(1, draws[0]!.normalBuffer);
    expect(pass.drawIndexed).toHaveBeenCalledWith(3);
    expect(pass.drawIndexed).toHaveBeenCalledWith(6);
    expect(pass.drawIndexed).toHaveBeenCalledTimes(2);
    expect(pass.end).toHaveBeenCalledOnce();
  });

  it('selects the per-draw variant pipeline by key and binds the texcoord buffer', () => {
    const { backend } = makeBackend();
    const pa = backend.createSceneVariantPipeline('opaque', 'ka', '// a');
    const pb = backend.createSceneVariantPipeline('opaque', 'kb', '// b');
    const draws = [
      { pipelineKey: 'ka', texcoordBuffer: { id: 'ta' } as unknown as GPUBuffer, materialBindGroup: {} as GPUBindGroup, frameBindGroup: {} as GPUBindGroup, positionBuffer: {} as GPUBuffer, normalBuffer: {} as GPUBuffer, indexBuffer: {} as GPUBuffer, indexCount: 3 },
      { pipelineKey: 'ka', texcoordBuffer: { id: 'tb' } as unknown as GPUBuffer, materialBindGroup: {} as GPUBindGroup, frameBindGroup: {} as GPUBindGroup, positionBuffer: {} as GPUBuffer, normalBuffer: {} as GPUBuffer, indexBuffer: {} as GPUBuffer, indexCount: 3 },
      { pipelineKey: 'kb', materialBindGroup: {} as GPUBindGroup, frameBindGroup: {} as GPUBindGroup, positionBuffer: {} as GPUBuffer, normalBuffer: {} as GPUBuffer, indexBuffer: {} as GPUBuffer, indexCount: 6 },
    ];
    const pass = mockPass();
    const encoder = { beginRenderPass: vi.fn(() => pass) };
    backend.recordScenePass(encoder as unknown as GPUCommandEncoder, {
      pass: 'opaque',
      hdrView: {} as GPUTextureView,
      depthView: {} as GPUTextureView,
      draws,
    });
    // Pipeline set once per distinct consecutive key (ka shared by draws 0-1, then kb).
    expect(pass.setPipeline).toHaveBeenNthCalledWith(1, pa);
    expect(pass.setPipeline).toHaveBeenNthCalledWith(2, pb);
    expect(pass.setPipeline).toHaveBeenCalledTimes(2);
    expect(pass.setVertexBuffer).toHaveBeenCalledWith(2, draws[0]!.texcoordBuffer);
    expect(pass.drawIndexed).toHaveBeenCalledTimes(3);
  });

  it('throws when a draw references an uncompiled variant pipeline', () => {
    const { backend } = makeBackend();
    const encoder = { beginRenderPass: vi.fn(() => mockPass()) };
    expect(() =>
      backend.recordScenePass(encoder as unknown as GPUCommandEncoder, {
        pass: 'opaque',
        hdrView: {} as GPUTextureView,
        depthView: {} as GPUTextureView,
        draws: [
          { pipelineKey: 'missing', materialBindGroup: {} as GPUBindGroup, frameBindGroup: {} as GPUBindGroup, positionBuffer: {} as GPUBuffer, normalBuffer: {} as GPUBuffer, indexBuffer: {} as GPUBuffer, indexCount: 3 },
        ],
      }),
    ).toThrow();
  });

  it('clears on the first pass and loads on subsequent passes', () => {
    const { backend } = makeBackend();
    const base = { pass: 'opaque' as const, hdrView: {} as GPUTextureView, depthView: {} as GPUTextureView, draws: [] };
    const clearEncoder = { beginRenderPass: vi.fn((_desc: any) => mockPass()) };
    backend.recordScenePass(clearEncoder as unknown as GPUCommandEncoder, { ...base, clear: true });
    const clearDesc = clearEncoder.beginRenderPass.mock.calls[0]![0] as any;
    expect(clearDesc.colorAttachments[0].loadOp).toBe('clear');
    const loadEncoder = { beginRenderPass: vi.fn((_desc: any) => mockPass()) };
    backend.recordScenePass(loadEncoder as unknown as GPUCommandEncoder, { ...base, clear: false });
    const loadDesc = loadEncoder.beginRenderPass.mock.calls[0]![0] as any;
    expect(loadDesc.colorAttachments[0].loadOp).toBe('load');
    expect(loadDesc.depthStencilAttachment.depthLoadOp).toBe('load');
  });
});
