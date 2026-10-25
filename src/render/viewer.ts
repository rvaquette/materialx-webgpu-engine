// Interactive on-canvas viewer (T051/T052 live counterpart of the offscreen USD
// capture harness). Loads a USD scene through the shared asset loader (usd-scene-
// assets.ts), builds the raster forward and the compute path-tracer GPU state from
// the SAME resources, and renders either backend to the swap chain with an
// interactive orbit camera. Scenes can be reloaded at runtime (scene selector in
// index.html): each load disposes the previous GPU objects and rebuilds both
// backends so raster [r] and path tracing [p] stay in sync on the new assets.

import {
  buildSceneFrame,
  buildSceneFrameUniform,
  buildSceneMaterialUniform,
  type FrameCamera,
  type SceneFramePlan,
} from './raster/scene-frame.ts';
import {
  RasterBackend,
  RESOLVE_UNIFORM_SIZE,
  SCENE_FRAME_UNIFORM_SIZE,
  SCENE_MATERIAL_UNIFORM_SIZE,
  type ScenePassKind,
  type SceneDrawCall,
} from './raster/backend.ts';
import { createSceneBindGroups, uploadGeometry, type SceneDrawBuffers } from './scene-resources.ts';
import { buildEnvCdf } from '../assets/environment-cdf.ts';
import { buildPathTraceScene, type PathTraceScene } from './pathtracing/scene-buffers.ts';
import { buildPathTraceUniform, pathTraceComputeWgsl, PathTraceBackend, PT_UNIFORM_SIZE } from './pathtracing/compute.ts';
import { buildMaterialDispatch } from './pathtracing/material-variant.ts';
import { buildPtDeviceBindings } from './pathtracing/device-bindings.ts';
import type { DecodedPixelImage } from '../assets/images.ts';
import { loadUsdScene, uploadMaterialTextures, type ObjectMaterialOverride } from './usd-scene-assets.ts';
import { OrbitCamera, attachOrbitControls } from '../scene/orbit-camera.ts';
import { inverse4, lookAt4, multiply4, perspective4, type Vec3 } from '../scene/transforms.ts';
import type { DiagnosticSink } from '../core/diagnostics.ts';
import { compileShaderWithDiagnostics, type ShaderCompilationError } from '../gpu/shader-diagnostics.ts';
import { packHdrTexture } from '../assets/hdr-texture.ts';

/** Preview fill + framing shared with the capture harness so the live view matches. */
const PREVIEW_ENV: Vec3 = [0.65, 0.68, 0.72];
const RASTER_BAND_PIXELS = 256 * 256;
function previewCamera(aspect: number, exposure: number): FrameCamera {
  const target: Vec3 = [0, 0.3, 0];
  const dir: Vec3 = [0.657, 0.438, 0.613];
  const dist = 7;
  const eye: Vec3 = [target[0] + dir[0] * dist, target[1] + dir[1] * dist, target[2] + dir[2] * dist];
  return { viewProj: multiply4(perspective4(0.62, aspect, 0.001, 10000), lookAt4(eye, target, [0, 1, 0])), eye, exposure };
}

export type BackendKind = 'raster' | 'pathtracing';

export type PathTracerState = 'idle' | 'compiling' | 'ready' | 'error';

export interface ViewerStatus {
  backend: BackendKind;
  pathTracingPaused: boolean;
  pathTracer: PathTracerState;
  drawCount: number;
  passes: readonly ScenePassKind[];
  samples: number;
  warnings: number;
}

/** A disposable per-scene GPU render set (raster + lazily built path tracer) for one loaded USD. */
interface SceneRender {
  frame: SceneFramePlan;
  ptScene: PathTraceScene;
  renderRaster: (targetView: GPUTextureView) => void;
  /** Starts the path tracer build on first call; renders nothing until it is ready. */
  renderPathTrace: (targetView: GPUTextureView, tiled: boolean) => void;
  resetPathTrace: () => void;
  applyCamera: (viewProj: readonly number[], eye: Vec3) => void;
  frameCount: () => number;
  pathTracerState: () => PathTracerState;
  dispose: () => void;
}

export class InteractiveViewer {
  readonly #device: GPUDevice;
  readonly #context: GPUCanvasContext;
  readonly #outputFormat: GPUTextureFormat;
  readonly #canvas: HTMLCanvasElement;
  #width: number;
  #height: number;
  #backend: BackendKind = 'raster';
  #pathTracingPaused = false;
  #orbit: OrbitCamera;
  #current: SceneRender | null = null;
  #loaded: Awaited<ReturnType<typeof loadUsdScene>> | undefined;
  #rebuildRender: (() => Promise<SceneRender>) | undefined;
  #sceneEntry: string | undefined;
  #materialOverrides = new Map<string, ObjectMaterialOverride>();
  #objects: ReadonlyArray<{ path: string; material: string; assetPath?: string }> = [];
  #warnings = 0;
  #rasterDirty = true;
  #disposed = false;
  #lastCameraChange = -Infinity;
  #detachControls: () => void;
  #onStatus: ((s: ViewerStatus) => void) | undefined;
  #onShaderErrors: ((errors: readonly ShaderCompilationError[]) => void) | undefined;

  constructor(opts: {
    device: GPUDevice;
    context: GPUCanvasContext;
    outputFormat: GPUTextureFormat;
    canvas: HTMLCanvasElement;
    onStatus?: (s: ViewerStatus) => void;
    onShaderErrors?: (errors: readonly ShaderCompilationError[]) => void;
  }) {
    this.#device = opts.device;
    this.#context = opts.context;
    this.#outputFormat = opts.outputFormat;
    this.#canvas = opts.canvas;
    this.#width = opts.canvas.width;
    this.#height = opts.canvas.height;
    this.#onStatus = opts.onStatus;
    this.#onShaderErrors = opts.onShaderErrors;
    this.#orbit = OrbitCamera.fromEyeTarget([0, 0.3 + 0.438 * 7, 0], [0, 0.3, 0], this.#width / this.#height);
    this.#detachControls = attachOrbitControls(this.#canvas, this.#orbit, () => this.#onCameraChanged());
    this.#loop();
  }

  get backend(): BackendKind {
    return this.#backend;
  }

  get objects(): ReadonlyArray<{ path: string; material: string; assetPath?: string }> {
    return this.#objects;
  }

  async setObjectMaterial(path: string, assetPath?: string): Promise<void> {
    if (!this.#sceneEntry || !this.#objects.some((object) => object.path === path)) {
      throw new Error(`Unknown object: ${path}`);
    }
    const overrides = new Map(this.#materialOverrides);
    if (assetPath) {
      const response = await fetch(assetPath);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${assetPath}`);
      const document = new DOMParser().parseFromString(await response.text(), 'application/xml');
      if (document.querySelector('parsererror')) throw new Error('Invalid MaterialX XML.');
      const materialName = document.getElementsByTagName('surfacematerial')[0]?.getAttribute('name');
      if (!materialName) throw new Error('No surfacematerial in this MaterialX document.');
      overrides.set(path, { assetPath, materialName });
    } else {
      overrides.delete(path);
    }
    await this.load(this.#sceneEntry, overrides, true);
  }

  get pathTracingPaused(): boolean {
    return this.#pathTracingPaused;
  }

  setPathTracingPaused(paused: boolean): void {
    this.#pathTracingPaused = paused;
    this.#emitStatus();
  }

  setBackend(kind: BackendKind): void {
    if (kind === this.#backend) return;
    this.#backend = kind;
    this.#canvas.style.imageRendering = kind === 'pathtracing' ? 'pixelated' : 'auto';
    if (kind === 'pathtracing') this.#current?.resetPathTrace();
    else this.#rasterDirty = true;
    this.#emitStatus();
  }

  dispose(): void {
    this.#disposed = true;
    this.#detachControls();
    this.#current?.dispose();
    this.#current = null;
    this.#rebuildRender = undefined;
    this.#loaded?.mtlx.documents.delete();
    this.#loaded = undefined;
  }

  async resize(size: number): Promise<void> {
    if (![256, 512, 1024].includes(size)) throw new Error('Unsupported render resolution.');
    if (size === this.#width && size === this.#height) return;
    const previousWidth = this.#width;
    const previousHeight = this.#height;
    this.#width = size;
    this.#height = size;
    // Pipelines are only reclaimed by GC: drop the old set before compiling the new one.
    this.#current?.dispose();
    this.#current = null;
    let render: SceneRender | undefined;
    try {
      render = await this.#rebuildRender?.();
    } catch (error) {
      this.#width = previousWidth;
      this.#height = previousHeight;
      this.#current = (await this.#rebuildRender?.().catch(() => undefined)) ?? null;
      this.#rasterDirty = true;
      throw error;
    }
    this.#canvas.width = size;
    this.#canvas.height = size;
    this.#canvas.style.width = `${size}px`;
    this.#orbit.aspect = 1;
    if (render) this.#current = render;
    this.#onCameraChanged();
    this.#emitStatus();
  }

  /** (Re)load a USD scene entry and rebuild both backends on its resources. */
  async load(
    entry: string,
    overrides: ReadonlyMap<string, ObjectMaterialOverride> = new Map(),
    preserveCamera = false,
  ): Promise<void> {
    this.#warnings = 0;
    const sink: DiagnosticSink = (d) => {
      if (d.level === 'warning' || d.level === 'error') this.#warnings++;
    };
    const loaded = await loadUsdScene(entry, sink, () => {}, overrides);
    const exposure = loaded.cameras[0]?.exposure ?? 0;
    let frame: SceneFramePlan;
    let ptScene: PathTraceScene;
    let render: SceneRender;
    try {
      if (overrides.size > 0 && loaded.resources.pendingMaterials.length > 0) {
        throw new Error('MaterialX compilation failed.');
      }
      const env = loaded.environment;
      const environment = env
        ? { radiance: env.averageRadiance, tint: env.tint, intensity: env.intensity, hasTexture: true, sh: env.sh }
        : { radiance: PREVIEW_ENV };
      frame = buildSceneFrame(loaded.resources, {
        lights: loaded.lights,
        frameCamera: previewCamera(this.#width / this.#height, exposure),
        environment,
        surfaceFor: loaded.mtlx.surfaceFor,
      });
      ptScene = buildPathTraceScene(loaded.resources, {
        lights: loaded.lights,
        surfaceFor: loaded.mtlx.surfaceFor,
        frameCamera: previewCamera(this.#width / this.#height, exposure),
        environment,
      });
      // Pipelines are only reclaimed by GC: drop the old set before compiling the new one.
      this.#current?.dispose();
      this.#current = null;
      this.#rebuildRender = undefined;
      await new Promise((resolve) => setTimeout(resolve, 0));
      render = await this.#buildSceneRender(loaded, frame, ptScene, exposure, sink);
    } catch (error) {
      loaded.mtlx.documents.delete();
      throw error;
    }
    if (this.#disposed) {
      render.dispose();
      loaded.mtlx.documents.delete();
      throw new Error('Viewer disposed during load.');
    }
    this.#rebuildRender = () => this.#buildSceneRender(loaded, frame, ptScene, exposure, sink);
    this.#current = render;
    this.#loaded?.mtlx.documents.delete();
    this.#loaded = loaded;
    this.#sceneEntry = entry;
    this.#materialOverrides = new Map(overrides);
    this.#objects = loaded.resources.instances.filter((instance) => instance.hasGeometry).map((instance) => {
      const material = instance.materialKey ? loaded.resources.materials.get(instance.materialKey) : undefined;
      const override = overrides.get(instance.primPath);
      return {
        path: instance.primPath,
        material: material?.materialName ?? 'Default',
        ...(override ? { assetPath: override.assetPath } : {}),
      };
    });

    // Seed the orbit from the scene bounds so the first frame is framed, then push
    // the camera into both backends and restart accumulation.
    const center: Vec3 = [
      (ptScene.bounds.min[0] + ptScene.bounds.max[0]) / 2,
      (ptScene.bounds.min[1] + ptScene.bounds.max[1]) / 2,
      (ptScene.bounds.min[2] + ptScene.bounds.max[2]) / 2,
    ];
    if (!preserveCamera) {
      const camera = loaded.cameras[0];
      if (camera) {
        const transform = camera.transform;
        const eye: Vec3 = [transform[12]!, transform[13]!, transform[14]!];
        const distance = Math.hypot(eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]);
        const axisLength = Math.hypot(transform[8]!, transform[9]!, transform[10]!) || 1;
        const target: Vec3 = [
          eye[0] - transform[8]! * distance / axisLength,
          eye[1] - transform[9]! * distance / axisLength,
          eye[2] - transform[10]! * distance / axisLength,
        ];
        this.#orbit = OrbitCamera.fromEyeTarget(eye, target, this.#width / this.#height, camera.fovY || 0.62);
      } else {
        this.#orbit = OrbitCamera.fromEyeTarget(frame.camera.eye, center, this.#width / this.#height);
      }
    }
    this.#detachControls();
    this.#detachControls = attachOrbitControls(this.#canvas, this.#orbit, () => this.#onCameraChanged());
    this.#onCameraChanged();
    this.#emitStatus();
  }

  #onCameraChanged(): void {
    if (!this.#current) return;
    this.#lastCameraChange = performance.now();
    this.#current.applyCamera(this.#orbit.viewProj(), this.#orbit.eye);
    this.#rasterDirty = true;
    if (this.#backend === 'pathtracing') this.#current.resetPathTrace();
  }

  #emitStatus(): void {
    if (!this.#onStatus || !this.#current) return;
    this.#onStatus({
      backend: this.#backend,
      pathTracingPaused: this.#pathTracingPaused,
      pathTracer: this.#current.pathTracerState(),
      drawCount: this.#current.frame.draws.length,
      passes: this.#current.frame.passes,
      samples: this.#current.frameCount(),
      warnings: this.#warnings,
    });
  }

  #loop = (): void => {
    if (this.#disposed) return;
    const current = this.#current;
    if (current) {
      if (this.#backend === 'pathtracing' && !this.#pathTracingPaused) {
        const tiled = performance.now() - this.#lastCameraChange >= 200;
        current.renderPathTrace(this.#context.getCurrentTexture().createView(), tiled);
        this.#emitStatus();
      } else if (this.#backend === 'raster' && this.#rasterDirty) {
        this.#rasterDirty = false;
        current.renderRaster(this.#context.getCurrentTexture().createView());
        this.#emitStatus();
      }
    }
    requestAnimationFrame(this.#loop);
  };

  /** Build the raster forward + compute path-trace GPU state for one scene. */
  async #buildSceneRender(
    loaded: Awaited<ReturnType<typeof loadUsdScene>>,
    frame: SceneFramePlan,
    ptScene: PathTraceScene,
    exposure: number,
    sink: DiagnosticSink,
  ): Promise<SceneRender> {
    const trash: Array<{ destroy(): void }> = [];
    try {
      return await this.#createSceneRender(loaded, frame, ptScene, exposure, sink, trash);
    } catch (error) {
      for (const resource of trash) resource.destroy();
      throw error;
    }
  }

  async #createSceneRender(
    loaded: Awaited<ReturnType<typeof loadUsdScene>>,
    frame: SceneFramePlan,
    ptScene: PathTraceScene,
    exposure: number,
    sink: DiagnosticSink,
    trash: Array<{ destroy(): void }>,
  ): Promise<SceneRender> {
    const device = this.#device;
    const width = this.#width;
    const height = this.#height;
    const outputFormat = this.#outputFormat;
    const resources = loaded.resources;
    this.#onShaderErrors?.([]);
    const rasterShaders = new Map<string, { code: string; label: string }>();
    for (const draw of frame.draws) {
      const material = draw.materialKey ? resources.materials.get(draw.materialKey) : undefined;
      if (material?.sceneShader) {
        rasterShaders.set(material.variant.pipelineKey, { code: material.sceneShader.code, label: `Raster: ${material.materialName}` });
      }
    }
    const dispatch = buildMaterialDispatch(ptScene.variantSources);
    const rasterCompilation = await Promise.all([...rasterShaders].map(async ([key, shader]) => ({
      key,
      ...await compileShaderWithDiagnostics(device, shader.code, shader.label),
    })));
    const rasterErrors = rasterCompilation.flatMap((result) => result.errors);
    this.#onShaderErrors?.(rasterErrors);
    if (rasterErrors.length > 0) throw new Error(`WGSL: ${rasterErrors.length} erreur(s) de compilation.`);
    const rasterModules = new Map(rasterCompilation.map((result) => [result.key, result.module]));
    const track = <T extends { destroy(): void }>(o: T): T => {
      trash.push(o);
      return o;
    };

    // Shared equirect environment texture (dome envmap), uploaded once as a
    // filterable rgba16float and consumed by both the raster background pass and
    // the path tracer's group 3. env.w in the PT uniform carries the intensity.
    const envAsset = loaded.environment;
    let envTextureView: GPUTextureView | undefined;
    let envSampler: GPUSampler | undefined;
    let envRadianceScale = 1;
    let envCdfBuffer: GPUBuffer | undefined;
    if (envAsset) {
      const { width: ew, height: eh } = envAsset.image;
      const packed = packHdrTexture(envAsset.image);
      envRadianceScale = packed.radianceScale;
      frame.environment.textureRadianceScale = envRadianceScale;
      const cdf = buildEnvCdf(envAsset.image);
      frame.environment.envResX = cdf.width;
      frame.environment.envResY = cdf.height;
      frame.environment.envTotalSum = cdf.totalSum;
      envCdfBuffer = track(device.createBuffer({ size: Math.max(16, cdf.cdf.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }));
      device.queue.writeBuffer(envCdfBuffer, 0, cdf.cdf);
      ptScene.environment.textureRadianceScale = envRadianceScale;
      const envTexture = track(device.createTexture({
        size: [ew, eh],
        format: 'rgba16float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      }));
      device.queue.writeTexture(
        { texture: envTexture },
        packed.data,
        { bytesPerRow: ew * 8, rowsPerImage: eh },
        [ew, eh, 1],
      );
      envTextureView = envTexture.createView();
      envSampler = device.createSampler({
        addressModeU: 'repeat',
        addressModeV: 'clamp-to-edge',
        magFilter: 'linear',
        minFilter: 'linear',
      });
    }

    // --- raster ---------------------------------------------------------------
    const backend = new RasterBackend({ device, outputFormat, tonemap: 'acesFilmic' });
    for (const draw of frame.draws) {
      const material = draw.materialKey ? resources.materials.get(draw.materialKey) : undefined;
      if (material?.sceneShader) {
        backend.createSceneVariantPipeline(draw.pass, material.variant.pipelineKey, material.sceneShader.code, rasterModules.get(material.variant.pipelineKey));
      }
    }
    const resolvePipeline = backend.createResolvePipeline();

    const imageCache = new Map<string, DecodedPixelImage | undefined>();
    const materialTextures = new Map<string, { textureViews: Map<string, GPUTextureView>; samplers: Map<string, GPUSampler> }>();
    for (const [key, material] of resources.materials) {
      if (material.surfaceModule && material.surfaceModule.textures.length > 0) {
        const uploadedTextures = await uploadMaterialTextures(device, material, loaded.mtlx.imageProvider, imageCache);
        uploadedTextures.textures.forEach(track);
        materialTextures.set(key, uploadedTextures);
      }
    }

    const materialDisplacement = new Map<string, NonNullable<SceneDrawBuffers['displacement']>>();
    for (const [key, material] of resources.materials) {
      const group = material.sceneShader?.displacementGroup;
      if (group === undefined || !material.displacement) continue;
      const file = material.displacement.file;
      if (!imageCache.has(file)) imageCache.set(file, await loaded.mtlx.imageProvider.decode(file));
      const image = imageCache.get(file);
      if (!image || image.componentType !== 'uint8' || image.channels !== 4) {
        throw new Error(`Invalid displacement map: ${file}`);
      }
      const texture = track(device.createTexture({
        size: [image.width, image.height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      }));
      device.queue.writeTexture(
        { texture }, image.data,
        { bytesPerRow: image.width * 4, rowsPerImage: image.height },
        [image.width, image.height, 1],
      );
      const params = track(device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
      device.queue.writeBuffer(params, 0, new Float32Array([material.displacement.scale, 0.5, 0, 0]));
      materialDisplacement.set(key, {
        group,
        params,
        textureView: texture.createView(),
        sampler: device.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear' }),
      });
    }

    const hdrTexture = track(device.createTexture({
      size: [width, height],
      format: backend.hdrFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    }));
    const depthTexture = track(device.createTexture({
      size: [width, height],
      format: backend.depthFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    }));
    const hdrView = hdrTexture.createView();
    const depthView = depthTexture.createView();

    const uploaded = new Map<string, ReturnType<typeof uploadGeometry>>();
    for (const [id, geometry] of resources.geometries) {
      const buffers = uploadGeometry(device, geometry, id);
      track(buffers.indexBuffer);
      for (const vb of buffers.vertexBuffers.values()) track(vb);
      uploaded.set(id, buffers);
    }

    const drawsByPass = new Map<ScenePassKind, SceneDrawCall[]>();
    const zeroTexcoords = new Map<string, GPUBuffer>();
    const zeroTangents = new Map<string, GPUBuffer>();
    const frameUniforms: GPUBuffer[] = [];
    for (const draw of frame.draws) {
      const buffers = uploaded.get(draw.prototypeId);
      const geometry = resources.geometries.get(draw.prototypeId);
      const position = buffers?.vertexBuffers.get('position');
      const normal = buffers?.vertexBuffers.get('normal');
      if (!buffers || !geometry || !position || !normal) continue;
      const material = draw.materialKey ? resources.materials.get(draw.materialKey) : undefined;
      if (!material?.sceneShader) continue;
      const pipeline = backend.sceneVariantPipeline(draw.pass, material.variant.pipelineKey);
      if (!pipeline) continue;
      let texcoord = buffers.vertexBuffers.get('uv');
      if (!texcoord) {
        texcoord = zeroTexcoords.get(draw.prototypeId);
        if (!texcoord) {
          texcoord = track(device.createBuffer({ size: geometry.vertexCount * 8, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }));
          device.queue.writeBuffer(texcoord, 0, new Float32Array(geometry.vertexCount * 2));
          zeroTexcoords.set(draw.prototypeId, texcoord);
        }
      }
      const frameUniform = track(device.createBuffer({ size: SCENE_FRAME_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
      let tangent = buffers.vertexBuffers.get('tangent') ?? zeroTangents.get(draw.prototypeId);
      if (!tangent) {
        tangent = track(device.createBuffer({ size: geometry.vertexCount * 16, usage: GPUBufferUsage.VERTEX }));
        zeroTangents.set(draw.prototypeId, tangent);
      }
      device.queue.writeBuffer(frameUniform, 0, buildSceneFrameUniform(frame, draw));
      frameUniforms.push(frameUniform);
      const materialUniform = track(device.createBuffer({ size: SCENE_MATERIAL_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
      device.queue.writeBuffer(materialUniform, 0, buildSceneMaterialUniform(draw));
      const textures = draw.materialKey ? materialTextures.get(draw.materialKey) : undefined;
      const displacement = draw.materialKey ? materialDisplacement.get(draw.materialKey) : undefined;
      const bindGroups = createSceneBindGroups(
        device,
        material,
        {
          frame: frameUniform,
          material: materialUniform,
          ...(textures ? { textureViews: textures.textureViews, samplers: textures.samplers } : {}),
          ...(displacement ? { displacement } : {}),
          ...(envTextureView && envSampler && envCdfBuffer ? { environment: { textureView: envTextureView, sampler: envSampler, cdf: envCdfBuffer } } : {}),
        },
        (group) => pipeline.getBindGroupLayout(group),
      );
      const textureBindGroups = new Map<number, GPUBindGroup>();
      for (const [group, bindGroup] of bindGroups.byGroup) {
        if (bindGroup !== bindGroups.materialBindGroup && bindGroup !== bindGroups.frameBindGroup) {
          textureBindGroups.set(group, bindGroup);
        }
      }
      const list = drawsByPass.get(draw.pass) ?? [];
      list.push({
        materialBindGroup: bindGroups.materialBindGroup,
        frameBindGroup: bindGroups.frameBindGroup,
        positionBuffer: position,
        normalBuffer: normal,
        texcoordBuffer: texcoord,
        tangentBuffer: tangent,
        indexBuffer: buffers.indexBuffer,
        indexCount: buffers.indexCount,
        pipelineKey: material.variant.pipelineKey,
        ...(textureBindGroups.size > 0 ? { textureBindGroups } : {}),
      });
      drawsByPass.set(draw.pass, list);
    }

    const resolveUniform = track(device.createBuffer({ size: RESOLVE_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
    device.queue.writeBuffer(resolveUniform, 0, new Float32Array([frame.camera.exposure]));
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    const resolveBindGroup = device.createBindGroup({
      layout: resolvePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: hdrView },
        { binding: 1, resource: sampler },
        { binding: 2, resource: { buffer: resolveUniform } },
      ],
    });
    const rasterBackground = frame.environment.radiance;

    // Optional raster environment background: a fullscreen pass that samples the
    // equirect dome texture along each pixel's world ray, cleared behind geometry.
    let envBgUniform: GPUBuffer | undefined;
    let envBgBindGroup: GPUBindGroup | undefined;
    let envBgPipeline: GPURenderPipeline | undefined;
    if (envAsset && envTextureView && envSampler) {
      const envBgModule = device.createShaderModule({
        code: `
struct EnvBg { invViewProj: mat4x4<f32>, eye: vec4<f32>, tint: vec4<f32> };
@group(0) @binding(0) var<uniform> E : EnvBg;
@group(0) @binding(1) var envTex : texture_2d<f32>;
@group(0) @binding(2) var envSamp : sampler;
const PI : f32 = 3.14159265358979;
struct VO { @builtin(position) pos: vec4<f32>, @location(0) ndc: vec2<f32> };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VO {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(-1.0, 1.0), vec2<f32>(3.0, 1.0));
  var o: VO;
  o.pos = vec4<f32>(p[i], 1.0, 1.0);
  o.ndc = p[i];
  return o;
}
fn dir_to_uv(d: vec3<f32>) -> vec2<f32> {
  let n = normalize(d);
  let u = atan2(n.z, n.x) * (0.5 / PI) + 0.5;
  let v = acos(clamp(n.y, -1.0, 1.0)) / PI;
  return vec2<f32>(u, v);
}
@fragment fn fs(in: VO) -> @location(0) vec4<f32> {
  let far = E.invViewProj * vec4<f32>(in.ndc, 1.0, 1.0);
  let world = far.xyz / far.w;
  let dir = world - E.eye.xyz;
  let c = textureSample(envTex, envSamp, dir_to_uv(dir)).xyz;
  return vec4<f32>(c * E.tint.xyz, 1.0);
}
`,
      });
      envBgPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: envBgModule, entryPoint: 'vs' },
        fragment: { module: envBgModule, entryPoint: 'fs', targets: [{ format: backend.hdrFormat }] },
        primitive: { topology: 'triangle-list' },
        depthStencil: { format: backend.depthFormat, depthWriteEnabled: false, depthCompare: 'always' },
      });
      envBgUniform = track(device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
      const inten = envAsset.intensity * envRadianceScale;
      const t = envAsset.tint;
      device.queue.writeBuffer(envBgUniform, 80, new Float32Array([t[0] * inten, t[1] * inten, t[2] * inten, 1]));
      envBgBindGroup = device.createBindGroup({
        layout: envBgPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: envBgUniform } },
          { binding: 1, resource: envTextureView },
          { binding: 2, resource: envSampler },
        ],
      });
    }

    // Heavy MaterialX fragments over a full frame in one submission exceed the
    // mobile GPU watchdog (VK_ERROR_DEVICE_LOST): submit horizontal bands instead.
    const bandRows = Math.max(1, Math.floor(RASTER_BAND_PIXELS / width));
    const renderRaster = (targetView: GPUTextureView): void => {
      let encoder = device.createCommandEncoder();
      let first = true;
      if (envBgPipeline && envBgBindGroup) {
        const pass = encoder.beginRenderPass({
          colorAttachments: [{ view: hdrView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
          depthStencilAttachment: { view: depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
        });
        pass.setPipeline(envBgPipeline);
        pass.setBindGroup(0, envBgBindGroup);
        pass.draw(3);
        pass.end();
        first = false;
      }
      for (let y = 0; y < height; y += bandRows) {
        const scissor = { x: 0, y, width, height: Math.min(bandRows, height - y) };
        for (const pass of frame.passes) {
          const draws = drawsByPass.get(pass) ?? [];
          if (draws.length === 0) continue;
          backend.recordScenePass(encoder, { pass, hdrView, depthView, draws, clear: first, clearColor: rasterBackground, scissor });
          first = false;
        }
        if (y + bandRows < height) {
          device.queue.submit([encoder.finish()]);
          encoder = device.createCommandEncoder();
        }
      }
      backend.recordResolvePass(encoder, { outputView: targetView, bindGroup: resolveBindGroup });
      device.queue.submit([encoder.finish()]);
    };

    // --- path tracer (built on first use: its pipeline costs ~230 MB of driver memory on mobile) ---
    const buildPathTracer = async (ptTrash: Array<{ destroy(): void }>) => {
    const track = <T extends { destroy(): void }>(o: T): T => {
      ptTrash.push(o);
      return o;
    };
    const ptCompilation = await compileShaderWithDiagnostics(
      device, pathTraceComputeWgsl({ dispatch, environment: loaded.environment !== undefined }), 'Path tracing');
    if (ptCompilation.errors.length > 0) {
      this.#onShaderErrors?.([...rasterErrors, ...ptCompilation.errors]);
      throw new Error(`WGSL: ${ptCompilation.errors.length} erreur(s) de compilation (path tracing).`);
    }
    let pixelScale = 1;
    let ptWidth = width;
    let ptHeight = height;
    const bindings = await buildPtDeviceBindings(dispatch, ptScene, loaded.mtlx.imageProvider, { sink });
    const ptBackend = new PathTraceBackend(device, { dispatch, ...(envAsset ? { environment: true } : {}) });
    const { pipeline: ptPipeline } = await ptBackend.createPipelineAsync(ptCompilation.module);
    const storage = (data: Float32Array | Uint32Array): GPUBuffer =>
      track(device.createBuffer({ size: Math.max(data.byteLength, 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }));
    const storageData = (data: Float32Array | Uint32Array): GPUBuffer => {
      const safe = data.byteLength > 0 ? data : data instanceof Uint32Array ? new Uint32Array(1) : new Float32Array(1);
      const buf = storage(safe);
      device.queue.writeBuffer(buf, 0, safe);
      return buf;
    };

    const accumBytes = width * height * 16;
    const accumBuffer = track(device.createBuffer({ size: accumBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }));
    device.queue.writeBuffer(accumBuffer, 0, new Float32Array(width * height * 4));
    const ptUniform = track(device.createBuffer({ size: PT_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));

    const group0Entries: GPUBindGroupEntry[] = bindings.group0.map((slot) => {
      if (slot.role === 'uniform') return { binding: slot.binding, resource: { buffer: ptUniform } };
      if (slot.role === 'accum') return { binding: slot.binding, resource: { buffer: accumBuffer } };
      if (slot.role === 'mxUniforms') {
        const mx = track(device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
        return { binding: slot.binding, resource: { buffer: mx } };
      }
      return { binding: slot.binding, resource: { buffer: storageData(slot.data ?? new Float32Array(1)) } };
    });
    const group0 = device.createBindGroup({ layout: ptPipeline.getBindGroupLayout(0), entries: group0Entries });

    const textureViews = new Map<number, GPUTextureView>();
    for (const tex of bindings.textures) {
      const image = bindings.images[tex.imageIndex];
      const w = image?.width ?? 1;
      const h = image?.height ?? 1;
      const gpuTex = track(device.createTexture({
        size: [w, h],
        format: tex.format,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      }));
      if (image && image.componentType === 'uint8' && image.channels === 4) {
        device.queue.writeTexture({ texture: gpuTex }, image.data, { bytesPerRow: w * 4, rowsPerImage: h }, [w, h, 1]);
      }
      textureViews.set(tex.binding, gpuTex.createView());
    }
    const group1 =
      bindings.textures.length > 0
        ? device.createBindGroup({
            layout: ptPipeline.getBindGroupLayout(1),
            entries: bindings.textures.map((tex) => ({ binding: tex.binding, resource: textureViews.get(tex.binding)! })),
          })
        : undefined;
    const group2 =
      bindings.samplers.length > 0
        ? device.createBindGroup({
            layout: ptPipeline.getBindGroupLayout(2),
            entries: bindings.samplers.map((s) => ({
              binding: s.binding,
              resource: device.createSampler({
                addressModeU: s.descriptor.addressModeU,
                addressModeV: s.descriptor.addressModeV,
                magFilter: s.descriptor.magFilter,
                minFilter: s.descriptor.minFilter,
              }),
            })),
          })
        : undefined;
    const ptEnvGroup =
      envAsset && envTextureView && envSampler
        ? device.createBindGroup({
            layout: ptPipeline.getBindGroupLayout(3),
            entries: [
              { binding: 0, resource: envTextureView },
              { binding: 1, resource: envSampler },
              { binding: 2, resource: { buffer: storageData(new Float32Array([0])) } },
            ],
          })
        : undefined;

    // Fullscreen tonemap of the accumulated mean to the swap chain.
    const ptDisplayModule = device.createShaderModule({
      code: `
struct Info { width: u32, height: u32, exposure: f32, pixelScale: u32 };
@group(0) @binding(0) var<storage, read> accum : array<vec4<f32>>;
@group(0) @binding(1) var<uniform> info : Info;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(-1.0, 1.0), vec2<f32>(3.0, 1.0));
  return vec4<f32>(p[i], 0.0, 1.0);
}
fn tonemap(c: vec3<f32>) -> vec3<f32> {
  let x = c * exp2(info.exposure);
  return x / (x + vec3<f32>(1.0));
}
@fragment fn fs(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let pixel = min(vec2<u32>(frag.xy) / info.pixelScale, vec2<u32>(info.width - 1u, info.height - 1u));
  let idx = pixel.y * info.width + pixel.x;
  return vec4<f32>(tonemap(accum[idx].xyz), 1.0);
}
`,
    });
    const ptDisplayPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: ptDisplayModule, entryPoint: 'vs' },
      fragment: { module: ptDisplayModule, entryPoint: 'fs', targets: [{ format: outputFormat }] },
      primitive: { topology: 'triangle-list' },
    });
    const ptInfo = track(device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
    device.queue.writeBuffer(ptInfo, 0, new Uint32Array([ptWidth, ptHeight, 0, pixelScale]));
    device.queue.writeBuffer(ptInfo, 8, new Float32Array([exposure]));
    const ptDisplayBindGroup = device.createBindGroup({
      layout: ptDisplayPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: accumBuffer } },
        { binding: 1, resource: { buffer: ptInfo } },
      ],
    });

    const zeroAccum = new Float32Array(width * height * 4);
    const resetPathTrace = (): void => {
      ptBackend.resetAccumulation();
      device.queue.writeBuffer(accumBuffer, 0, zeroAccum);
    };
    const renderPathTrace = (targetView: GPUTextureView, tiled: boolean): void => {
      const nextPixelScale = tiled ? 1 : 4;
      if (pixelScale !== nextPixelScale) {
        pixelScale = nextPixelScale;
        ptWidth = Math.max(1, Math.ceil(width / pixelScale));
        ptHeight = Math.max(1, Math.ceil(height / pixelScale));
        resetPathTrace();
        device.queue.writeBuffer(ptInfo, 0, new Uint32Array([ptWidth, ptHeight, 0, pixelScale]));
        device.queue.writeBuffer(ptInfo, 8, new Float32Array([exposure]));
      }
      const { tile, frameIndex } = tiled
        ? ptBackend.advanceTile(ptWidth, ptHeight)
        : { tile: { x: 0, y: 0, width: ptWidth, height: ptHeight }, frameIndex: ptBackend.advanceFrame() };
      const [wgX, wgY] = PathTraceBackend.workgroupCount(tile.width, tile.height);
      device.queue.writeBuffer(ptUniform, 0, buildPathTraceUniform(ptScene, frameIndex, 1, ptWidth, ptHeight, 0, tile));
      const encoder = device.createCommandEncoder();
      const compute = encoder.beginComputePass();
      compute.setPipeline(ptPipeline);
      compute.setBindGroup(0, group0);
      if (group1) compute.setBindGroup(1, group1);
      if (group2) compute.setBindGroup(2, group2);
      if (ptEnvGroup) compute.setBindGroup(3, ptEnvGroup);
      compute.dispatchWorkgroups(wgX, wgY, 1);
      compute.end();
      const renderPass = encoder.beginRenderPass({
        colorAttachments: [{ view: targetView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      });
      renderPass.setPipeline(ptDisplayPipeline);
      renderPass.setBindGroup(0, ptDisplayBindGroup);
      renderPass.draw(3);
      renderPass.end();
      device.queue.submit([encoder.finish()]);
    };
    return { renderPathTrace, resetPathTrace, frameCount: () => ptBackend.frameIndex };
    };

    let disposed = false;
    let ptState: PathTracerState = 'idle';
    let pathTracer: Awaited<ReturnType<typeof buildPathTracer>> | undefined;
    const startPathTracer = (): void => {
      if (ptState !== 'idle') return;
      ptState = 'compiling';
      const ptTrash: Array<{ destroy(): void }> = [];
      buildPathTracer(ptTrash).then((built) => {
        if (disposed) {
          for (const o of ptTrash) o.destroy();
          return;
        }
        trash.push(...ptTrash);
        pathTracer = built;
        ptState = 'ready';
      }, (error: unknown) => {
        for (const o of ptTrash) o.destroy();
        ptState = 'error';
        console.error(`Path tracer: ${(error as Error)?.message ?? error}`);
      });
    };

    const applyCamera = (viewProj: readonly number[], eye: Vec3): void => {
      const viewProjArray = new Float32Array(viewProj);
      const eyeArray = new Float32Array([eye[0], eye[1], eye[2], 0]);
      for (const buf of frameUniforms) {
        device.queue.writeBuffer(buf, 16 * 4, viewProjArray);
        device.queue.writeBuffer(buf, 32 * 4, eyeArray);
      }
      const invViewProj = inverse4(viewProj);
      if (envBgUniform) {
        device.queue.writeBuffer(envBgUniform, 0, new Float32Array(invViewProj));
        device.queue.writeBuffer(envBgUniform, 64, eyeArray);
      }
      ptScene.camera.viewProj = viewProj;
      ptScene.camera.invViewProj = invViewProj;
      ptScene.camera.eye = [eye[0], eye[1], eye[2]];
    };

    return {
      frame,
      ptScene,
      renderRaster,
      renderPathTrace: (targetView, tiled) => {
        if (pathTracer) pathTracer.renderPathTrace(targetView, tiled);
        else startPathTracer();
      },
      resetPathTrace: () => pathTracer?.resetPathTrace(),
      applyCamera,
      frameCount: () => pathTracer?.frameCount() ?? 0,
      pathTracerState: () => ptState,
      dispose: () => {
        disposed = true;
        pathTracer = undefined;
        for (const o of trash) o.destroy();
      },
    };
  }
}
