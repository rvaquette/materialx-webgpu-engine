// Executable WebGPU raster backend (plan sections 7.5, 9.1, T026b). This is the
// real GPU layer: it compiles the WGSL entry-point shaders from shaders.ts into
// render pipelines via the injected GPUDevice, and records a frame of GPU
// commands -- a forward opaque pass into a linear HDR target followed by a
// fullscreen tonemap resolve to the swapchain. The device is injected so the
// command sequence can be verified without a physical GPU.

import type { Tonemap } from '../output.ts';
import { forwardOpaqueWgsl, sceneForwardWgsl, tonemapResolveWgsl } from './shaders.ts';

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

/**
 * Scene forward uniform (T051): the single-object forward uniform prefixed with a
 * per-instance model(64) matrix: model(64) + viewProj(64) + eye(16) + lightDir(16)
 * + lightColor(16) + baseColor(16) + material(16) + coat(16) + environment(16) =
 * 240 bytes. Kept in sync with sceneForwardWgsl's Uniforms struct and the frame
 * assembler in scene-frame.ts.
 */
export const SCENE_FORWARD_UNIFORM_SIZE = 240;

export const FORWARD_VERTEX_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: FORWARD_VERTEX_STRIDE,
  attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' },
    { shaderLocation: 1, offset: 12, format: 'float32x3' },
  ],
};

/** Separate position(loc 0) and normal(loc 1) buffers for the scene forward pass. */
export const SCENE_VERTEX_LAYOUTS: GPUVertexBufferLayout[] = [
  { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
  { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
];

/** Active raster pass kinds driven by a material's effective render passes. */
export type ScenePassKind = 'opaque' | 'transmission';


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

/** One instance draw in the scene forward pass: its bind group + split streams. */
export interface SceneDrawCall {
  bindGroup: GPUBindGroup;
  positionBuffer: GPUBuffer;
  normalBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  indexCount: number;
}

export interface ScenePassTargets {
  pass: ScenePassKind;
  hdrView: GPUTextureView;
  depthView: GPUTextureView;
  draws: readonly SceneDrawCall[];
  /** Clear the HDR/depth target (first pass) or load the previous contents. */
  clear?: boolean;
}


export class RasterBackend {
  readonly hdrFormat: GPUTextureFormat;
  readonly outputFormat: GPUTextureFormat;
  readonly depthFormat: GPUTextureFormat;
  readonly tonemap: Tonemap;

  private readonly device: GPUDevice;
  private forward: GPURenderPipeline | undefined;
  private resolve: GPURenderPipeline | undefined;
  private sceneOpaque: GPURenderPipeline | undefined;
  private sceneTransmission: GPURenderPipeline | undefined;

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
  scenePipeline(pass: ScenePassKind): GPURenderPipeline | undefined {
    return pass === 'transmission' ? this.sceneTransmission : this.sceneOpaque;
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

  /**
   * Compiles and caches a scene forward pipeline for the given pass. The opaque
   * variant writes depth; the transmission variant alpha-blends over the opaque
   * result and leaves depth read-only so overlapping transparent objects accrue.
   */
  createSceneForwardPipeline(pass: ScenePassKind): GPURenderPipeline {
    const module = this.device.createShaderModule({ code: sceneForwardWgsl() });
    const transparent = pass === 'transmission';
    const target: GPUColorTargetState = transparent
      ? {
          format: this.hdrFormat,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }
      : { format: this.hdrFormat };
    const pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs_main', buffers: SCENE_VERTEX_LAYOUTS },
      fragment: { module, entryPoint: 'fs_main', targets: [target] },
      primitive: { topology: 'triangle-list', cullMode: transparent ? 'none' : 'back' },
      depthStencil: { format: this.depthFormat, depthWriteEnabled: !transparent, depthCompare: 'less' },
    });
    if (transparent) this.sceneTransmission = pipeline;
    else this.sceneOpaque = pipeline;
    return pipeline;
  }

  /** Records a scene forward pass that draws every instance of a pass kind. */
  recordScenePass(encoder: GPUCommandEncoder, targets: ScenePassTargets): void {
    const pipeline = this.scenePipeline(targets.pass);
    if (!pipeline) throw new Error(`scene ${targets.pass} pipeline not created`);
    const clear = targets.clear ?? true;
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: targets.hdrView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: clear ? 'clear' : 'load',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: targets.depthView,
        depthClearValue: 1,
        depthLoadOp: clear ? 'clear' : 'load',
        depthStoreOp: 'store',
      },
    });
    pass.setPipeline(pipeline);
    for (const draw of targets.draws) {
      pass.setBindGroup(0, draw.bindGroup);
      pass.setVertexBuffer(0, draw.positionBuffer);
      pass.setVertexBuffer(1, draw.normalBuffer);
      pass.setIndexBuffer(draw.indexBuffer, 'uint32');
      pass.drawIndexed(draw.indexCount);
    }
    pass.end();
  }

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
