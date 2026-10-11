import { describe, expect, it, vi } from 'vitest';
import { RasterBackend } from '../../../src/render/raster/backend.ts';

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
    const pipeline = backend.createForwardPipeline();
    expect(device.createShaderModule).toHaveBeenCalledOnce();
    expect(device.createShaderModule.mock.calls[0]![0].code).toContain('@vertex');
    const desc = device.createRenderPipeline.mock.calls[0]![0] as any;
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
    bindGroup: {} as GPUBindGroup,
    geometry: { vertexBuffer: {} as GPUBuffer, indexBuffer: {} as GPUBuffer, indexCount: 36 },
  };
  const resolveTargets = { outputView: {} as GPUTextureView, bindGroup: {} as GPUBindGroup };

  it('records a draw-indexed opaque pass', () => {
    const { backend } = makeBackend();
    const pipeline = backend.createForwardPipeline();
    const pass = mockPass();
    const encoder = { beginRenderPass: vi.fn(() => pass) };
    backend.recordOpaquePass(encoder as unknown as GPUCommandEncoder, opaqueTargets);
    expect(encoder.beginRenderPass).toHaveBeenCalledOnce();
    expect(pass.setPipeline).toHaveBeenCalledWith(pipeline);
    expect(pass.setVertexBuffer).toHaveBeenCalledWith(0, opaqueTargets.geometry.vertexBuffer);
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
    backend.createForwardPipeline();
    backend.createResolvePipeline();
    const pass = mockPass();
    const encoder = { beginRenderPass: vi.fn(() => pass) };
    backend.recordFrame(encoder as unknown as GPUCommandEncoder, opaqueTargets, resolveTargets);
    expect(encoder.beginRenderPass).toHaveBeenCalledTimes(2);
    expect(pass.drawIndexed).toHaveBeenCalledWith(36);
    expect(pass.draw).toHaveBeenCalledWith(3);
  });
});
