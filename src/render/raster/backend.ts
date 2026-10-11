// Executable WebGPU raster backend (plan sections 7.5, 9.1, T026b). This is the
// real GPU layer: it compiles the WGSL entry-point shaders from shaders.ts into
// render pipelines via the injected GPUDevice, and records a frame of GPU
// commands -- a forward opaque pass into a linear HDR target followed by a
// fullscreen tonemap resolve to the swapchain. The device is injected so the
// command sequence can be verified without a physical GPU.

import type { Tonemap } from '../output.ts';
import { forwardOpaqueWgsl, tonemapResolveWgsl } from './shaders.ts';

/** Interleaved position(3) + normal(3) float32 vertex, 24 bytes. */
export const FORWARD_VERTEX_STRIDE = 24;
/**
 * Forward OpenPBR uniform (T045): viewProj(64) + eye(16) + lightDir(16) +
 * lightColor(16, rgb color + w intensity) + baseColor(16) + material(16:
 * metalness, roughness, transmission, subsurface) + coat(16: ior, specular) +
 * environment(16) = 176 bytes.
 */
export const FORWARD_UNIFORM_SIZE = 176;
/** exposure(4) padded to the 16-byte uniform alignment. */
export const RESOLVE_UNIFORM_SIZE = 16;

export const FORWARD_VERTEX_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: FORWARD_VERTEX_STRIDE,
  attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' },
    { shaderLocation: 1, offset: 12, format: 'float32x3' },
  ],
};

export interface RasterBackendOptions {
  device: GPUDevice;
  outputFormat: GPUTextureFormat;
  hdrFormat?: GPUTextureFormat;
  depthFormat?: GPUTextureFormat;
  tonemap?: Tonemap;
}

export interface ForwardGeometry {
  vertexBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  indexCount: number;
}

export interface OpaquePassTargets {
  hdrView: GPUTextureView;
  depthView: GPUTextureView;
  bindGroup: GPUBindGroup;
  geometry: ForwardGeometry;
}

export interface ResolvePassTargets {
  outputView: GPUTextureView;
  bindGroup: GPUBindGroup;
}

export class RasterBackend {
  readonly hdrFormat: GPUTextureFormat;
  readonly outputFormat: GPUTextureFormat;
  readonly depthFormat: GPUTextureFormat;
  readonly tonemap: Tonemap;

  private readonly device: GPUDevice;
  private forward: GPURenderPipeline | undefined;
  private resolve: GPURenderPipeline | undefined;

  constructor(options: RasterBackendOptions) {
    this.device = options.device;
    this.outputFormat = options.outputFormat;
    this.hdrFormat = options.hdrFormat ?? 'rgba16float';
    this.depthFormat = options.depthFormat ?? 'depth24plus';
    this.tonemap = options.tonemap ?? 'acesFilmic';
  }

  get forwardPipeline(): GPURenderPipeline | undefined {
    return this.forward;
  }
  get resolvePipeline(): GPURenderPipeline | undefined {
    return this.resolve;
  }

  /** Compiles and caches the forward opaque pipeline (HDR target + depth). */
  createForwardPipeline(): GPURenderPipeline {
    const module = this.device.createShaderModule({ code: forwardOpaqueWgsl() });
    this.forward = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs_main', buffers: [FORWARD_VERTEX_LAYOUT] },
      fragment: { module, entryPoint: 'fs_main', targets: [{ format: this.hdrFormat }] },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: { format: this.depthFormat, depthWriteEnabled: true, depthCompare: 'less' },
    });
    return this.forward;
  }

  /** Compiles and caches the fullscreen tonemap resolve pipeline. */
  createResolvePipeline(): GPURenderPipeline {
    const module = this.device.createShaderModule({ code: tonemapResolveWgsl(this.tonemap) });
    this.resolve = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs_main' },
      fragment: { module, entryPoint: 'fs_main', targets: [{ format: this.outputFormat }] },
      primitive: { topology: 'triangle-list' },
    });
    return this.resolve;
  }

  /** Records the forward opaque pass into the HDR target. */
  recordOpaquePass(encoder: GPUCommandEncoder, targets: OpaquePassTargets): void {
    if (!this.forward) throw new Error('forward pipeline not created');
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: targets.hdrView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' },
      ],
      depthStencilAttachment: {
        view: targets.depthView,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    pass.setPipeline(this.forward);
    pass.setBindGroup(0, targets.bindGroup);
    pass.setVertexBuffer(0, targets.geometry.vertexBuffer);
    pass.setIndexBuffer(targets.geometry.indexBuffer, 'uint32');
    pass.drawIndexed(targets.geometry.indexCount);
    pass.end();
  }

  /** Records the fullscreen tonemap resolve pass to the swapchain view. */
  recordResolvePass(encoder: GPUCommandEncoder, targets: ResolvePassTargets): void {
    if (!this.resolve) throw new Error('resolve pipeline not created');
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: targets.outputView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' },
      ],
    });
    pass.setPipeline(this.resolve);
    pass.setBindGroup(0, targets.bindGroup);
    pass.draw(3);
    pass.end();
  }

  /** Records a full frame: opaque pass then resolve, in order. */
  recordFrame(encoder: GPUCommandEncoder, opaque: OpaquePassTargets, resolve: ResolvePassTargets): void {
    this.recordOpaquePass(encoder, opaque);
    this.recordResolvePass(encoder, resolve);
  }
}
