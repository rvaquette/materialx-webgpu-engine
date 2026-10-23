// Executable WebGPU raster backend (plan sections 7.5, 9.1, T026b). This is the
// real GPU layer: it compiles the WGSL entry-point shaders from shaders.ts into
// render pipelines via the injected GPUDevice, and records a frame of GPU
// commands -- a forward opaque pass into a linear HDR target followed by a
// fullscreen tonemap resolve to the swapchain. The device is injected so the
// command sequence can be verified without a physical GPU.

import type { Tonemap } from '../output.ts';
import { tonemapResolveWgsl } from './shaders.ts';
import { IR_FORWARD_FRAME_GROUP, IR_FORWARD_VERTEX_ENTRY, IR_FORWARD_FRAGMENT_ENTRY } from './ir-forward.ts';

/** exposure(4) padded to the 16-byte uniform alignment. */
export const RESOLVE_UNIFORM_SIZE = 16;

/**
 * Scene forward frame uniform (T058c): a per-instance model(64) matrix followed
 * by viewProj(64) + eye(16) + lightDir(16) + lightColor(16) + environment(16) =
 * 192 bytes. Kept in sync with the IR forward shader's Frame struct
 * (ir-forward.ts) and buildSceneFrameUniform in scene-frame.ts.
 */
export const SCENE_FRAME_UNIFORM_SIZE = 368;
/**
 * Scene forward material uniform: baseColor(16) + params(16: metalness,
 * roughness, transmission, subsurface) + coat(16: ior, specular) = 48 bytes, at
 * the @group(0) @binding(0) slot a compiled variant's MxUniforms occupies.
 */
export const SCENE_MATERIAL_UNIFORM_SIZE = 48;

/** Bind group index of the dedicated per-frame uniform (distinct from the
 *  material MxUniforms at group 0), shared with the IR-forward shader (T058b). */
export const FRAME_BIND_GROUP = IR_FORWARD_FRAME_GROUP;

/** Position(loc 0) + normal(loc 1) + texcoord(loc 2) buffers for the per-variant
 *  IR scene forward pipeline: the assembled IR shader (ir-forward.ts) reads a
 *  texcoord input at location 2 for the MxVaryings the surface closure consumes. */
export const SCENE_IR_VERTEX_LAYOUTS: GPUVertexBufferLayout[] = [
  { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
  { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
  { arrayStride: 8, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] },
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

/** Single-object forward geometry: position(loc 0) + normal(loc 1) + texcoord
 *  (loc 2) streams the IR-assembled shader reads, like the scene variant path. */
export interface ForwardGeometry {
  positionBuffer: GPUBuffer;
  normalBuffer: GPUBuffer;
  texcoordBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  indexCount: number;
}

export interface OpaquePassTargets {
  hdrView: GPUTextureView;
  depthView: GPUTextureView;
  /** Material MxUniforms at group 0; per-frame uniform at the IR frame group. */
  materialBindGroup: GPUBindGroup;
  frameBindGroup: GPUBindGroup;
  geometry: ForwardGeometry;
}

export interface ResolvePassTargets {
  outputView: GPUTextureView;
  bindGroup: GPUBindGroup;
}

/** One instance draw in the scene forward pass: its bind groups + split streams.
 *  The material uniform binds at group 0, the per-frame uniform at the dedicated
 *  frame bind group (FRAME_BIND_GROUP). */
export interface SceneDrawCall {
  materialBindGroup: GPUBindGroup;
  frameBindGroup: GPUBindGroup;
  positionBuffer: GPUBuffer;
  normalBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  indexCount: number;
  /** Variant pipeline key (variant.pipelineKey): selects the per-material IR
   *  pipeline compiled via createSceneVariantPipeline. Every scene draw routes
   *  through its variant pipeline (T058e, no hand-written fallback). */
  pipelineKey: string;
  /** Texcoord stream (loc 2) consumed by the IR variant pipeline, if available. */
  texcoordBuffer?: GPUBuffer;
  /** Texture/sampler bind groups (groups 1/2) the IR variant samples, keyed by
   *  group index; set in addition to material (0) and frame. Absent when the
   *  material folds to constants with no textures. */
  textureBindGroups?: ReadonlyMap<number, GPUBindGroup>;
}

export interface ScenePassTargets {
  pass: ScenePassKind;
  hdrView: GPUTextureView;
  depthView: GPUTextureView;
  draws: readonly SceneDrawCall[];
  /** Clear the HDR/depth target (first pass) or load the previous contents. */
  clear?: boolean;
  /** Linear HDR background for the clear (scene environment radiance), so the
   *  raster background matches the path tracer's env miss; defaults to black. */
  clearColor?: readonly [number, number, number];
}


export class RasterBackend {
  readonly hdrFormat: GPUTextureFormat;
  readonly outputFormat: GPUTextureFormat;
  readonly depthFormat: GPUTextureFormat;
  readonly tonemap: Tonemap;

  private readonly device: GPUDevice;
  private forward: GPURenderPipeline | undefined;
  private resolve: GPURenderPipeline | undefined;
  /** Per-material scene pipelines keyed by `${pass}:${variant.pipelineKey}`. */
  private readonly sceneVariants = new Map<string, GPURenderPipeline>();

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

  /** Per-material scene pipeline compiled by createSceneVariantPipeline, if any. */
  sceneVariantPipeline(pass: ScenePassKind, pipelineKey: string): GPURenderPipeline | undefined {
    return this.sceneVariants.get(`${pass}:${pipelineKey}`);
  }

  /** Compiles and caches the single-object forward pipeline from an IR-assembled
   *  shader (T058e): `code` is the ir-forward.ts WGSL for one material, using the
   *  vs_forward/fs_forward entry points over the position/normal/texcoord streams,
   *  into the HDR target with depth write. */
  createForwardPipeline(code: string): GPURenderPipeline {
    const module = this.device.createShaderModule({ code });
    this.forward = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: IR_FORWARD_VERTEX_ENTRY, buffers: SCENE_IR_VERTEX_LAYOUTS },
      fragment: { module, entryPoint: IR_FORWARD_FRAGMENT_ENTRY, targets: [{ format: this.hdrFormat }] },
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
   * Compiles and caches one scene forward pipeline per material variant (T058d).
   * `code` is the IR-assembled scene-forward WGSL (ir-forward.ts, provided by
   * scene-resources per material); `pipelineKey` is variant.pipelineKey, so two
   * materials that lower to the same shader share a single pipeline. The IR
   * shader uses the vs_forward/fs_forward entry points and reads position/normal/
   * texcoord vertex buffers; blend and depth match the hand-written pass.
   */
  createSceneVariantPipeline(pass: ScenePassKind, pipelineKey: string, code: string, checkedModule?: GPUShaderModule): GPURenderPipeline {
    const cacheKey = `${pass}:${pipelineKey}`;
    const cached = this.sceneVariants.get(cacheKey);
    if (cached) return cached;
    const module = checkedModule ?? this.device.createShaderModule({ code });
    const transparent = pass === 'transmission';
    const pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: IR_FORWARD_VERTEX_ENTRY, buffers: SCENE_IR_VERTEX_LAYOUTS },
      fragment: { module, entryPoint: IR_FORWARD_FRAGMENT_ENTRY, targets: [this.sceneColorTarget(transparent)] },
      primitive: { topology: 'triangle-list', cullMode: transparent ? 'none' : 'back' },
      depthStencil: { format: this.depthFormat, depthWriteEnabled: !transparent, depthCompare: 'less' },
    });
    this.sceneVariants.set(cacheKey, pipeline);
    return pipeline;
  }

  /** Color target for a scene forward pass: opaque writes direct, transmission
   *  alpha-blends over the opaque result. Shared by the hand-written and the
   *  per-variant IR pipelines so both pass kinds composite identically. */
  private sceneColorTarget(transparent: boolean): GPUColorTargetState {
    return transparent
      ? {
          format: this.hdrFormat,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }
      : { format: this.hdrFormat };
  }

  /** Records a scene forward pass that draws every instance of a pass kind.
   *  Each draw routes through its per-material IR variant pipeline (T058e). */
  recordScenePass(encoder: GPUCommandEncoder, targets: ScenePassTargets): void {
    const clear = targets.clear ?? true;
    const bg = targets.clearColor ?? [0, 0, 0];
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: targets.hdrView,
          clearValue: { r: bg[0], g: bg[1], b: bg[2], a: 1 },
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
    let current: GPURenderPipeline | undefined;
    for (const draw of targets.draws) {
      const pipeline = this.sceneVariantPipeline(targets.pass, draw.pipelineKey);
      if (!pipeline) throw new Error(`scene ${targets.pass} variant pipeline not created: ${draw.pipelineKey}`);
      if (pipeline !== current) {
        pass.setPipeline(pipeline);
        current = pipeline;
      }
      pass.setBindGroup(0, draw.materialBindGroup);
      pass.setBindGroup(FRAME_BIND_GROUP, draw.frameBindGroup);
      if (draw.textureBindGroups) {
        for (const [group, bindGroup] of draw.textureBindGroups) pass.setBindGroup(group, bindGroup);
      }
      pass.setVertexBuffer(0, draw.positionBuffer);
      pass.setVertexBuffer(1, draw.normalBuffer);
      if (draw.texcoordBuffer) pass.setVertexBuffer(2, draw.texcoordBuffer);
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
    pass.setBindGroup(0, targets.materialBindGroup);
    pass.setBindGroup(FRAME_BIND_GROUP, targets.frameBindGroup);
    pass.setVertexBuffer(0, targets.geometry.positionBuffer);
    pass.setVertexBuffer(1, targets.geometry.normalBuffer);
    pass.setVertexBuffer(2, targets.geometry.texcoordBuffer);
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
