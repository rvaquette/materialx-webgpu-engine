import type { HdrImage } from '../../assets/hdr.ts';
import type { PtImageProvider } from './device-bindings.ts';
import { buildDisneyEnvironmentCdf } from './disney-environment.ts';
import { DISNEY_ENVIRONMENT_WGSL } from './disney-environment-wgsl.ts';
import { uploadDisneyGeometryTextures, type DisneyGpuGeometryTextures } from './disney-geometry-textures.ts';
import type { DisneyTexelWrite } from './disney-dynamics.ts';
import { DISNEY_INTEGRATOR_WGSL } from './disney-integrator-wgsl.ts';
import { DISNEY_LIGHTS_WGSL } from './disney-lights-wgsl.ts';
import { DISNEY_MATERIAL_WGSL } from './disney-material-wgsl.ts';
import { packDisneyMaterials, uploadDisneyMaterials, type DisneyMaterial } from './disney-material.ts';
import { DISNEY_ALPHA_WGSL } from './disney-alpha-wgsl.ts';
import { DISNEY_BSDF_WGSL } from './disney-bsdf-wgsl.ts';
import { DISNEY_CAMERA_WGSL } from './disney-camera-wgsl.ts';
import { DISNEY_RENDER_PIXEL_BYTES, DISNEY_RENDER_UNIFORM_BYTES, DISNEY_RENDER_WGSL, packDisneyRenderSettings, type DisneyRenderSettings } from './disney-render.ts';
import type { DisneySceneData } from './disney-scene.ts';
import { DISNEY_SURFACE_WGSL } from './disney-surface-wgsl.ts';
import {
  assertDisneyShaderSpecialization, specializeDisneyShader, type DisneyShaderSpecialization,
} from './disney-shader-specialization.ts';
import { uploadDisneyTextureArray } from './disney-texture-array.ts';
import { DISNEY_TRAVERSAL_WGSL } from './disney-traversal-wgsl.ts';
import { displayTransformWgsl } from '../raster/shaders.ts';
import { tonemapIndex, type Tonemap } from '../output.ts';

export interface DisneyGpuBackendOptions {
  width: number;
  height: number;
  textureSize: number;
  imageProvider: PtImageProvider;
  outputFormat: GPUTextureFormat;
  /** Five RGBA texels per light, matching DisneyPathOptions.lightCount. */
  lights: Float32Array;
  /** Scene-constant options that may be compiled into the path shader. */
  specialization?: DisneyShaderSpecialization;
  environment?: HdrImage;
}

export interface DisneyGpuPixel {
  color: Float32Array;
  samples: Uint32Array;
}

const DISNEY_RENDER_SHADER = /* wgsl */ `
@group(0) @binding(0) var disneyNodes: texture_2d<f32>;
@group(0) @binding(1) var disneyTriangles: texture_2d<i32>;
@group(0) @binding(2) var disneyVertices: texture_2d<f32>;
@group(0) @binding(3) var disneyInverseTransforms: texture_2d<f32>;
@group(0) @binding(4) var disneyNormals: texture_2d<f32>;
@group(0) @binding(5) var disneyTransforms: texture_2d<f32>;
@group(0) @binding(6) var<storage, read> disneyMaterials: array<vec4f>;
@group(0) @binding(7) var disneyTextureMaps: texture_2d_array<u32>;
@group(0) @binding(8) var disneyEnvTexture: texture_2d<f32>;
@group(0) @binding(9) var<storage, read> disneyEnvCdf: array<f32>;
@group(0) @binding(10) var<storage, read> disneyLights: array<vec4f>;
@group(0) @binding(11) var disneySubsetMaterials: texture_2d<i32>;
${DISNEY_CAMERA_WGSL}
${DISNEY_TRAVERSAL_WGSL}
${DISNEY_SURFACE_WGSL}
${DISNEY_MATERIAL_WGSL}
${DISNEY_ALPHA_WGSL}
${DISNEY_BSDF_WGSL}
${DISNEY_ENVIRONMENT_WGSL}
${DISNEY_LIGHTS_WGSL}
${DISNEY_INTEGRATOR_WGSL}
${DISNEY_RENDER_WGSL}
`;

function displayShader(): string {
  return /* wgsl */ `
struct DisneyRenderPixel {
  sum: vec4f,
  samples: u32,
  error: u32,
  padding: vec2u,
};
struct DisneyDisplayParameters {
  size: vec2u,
  exposure: f32,
  tonemap: f32,
};
@group(0) @binding(0) var<storage, read> disneyDisplayPixels: array<DisneyRenderPixel>;
@group(0) @binding(1) var<uniform> disneyDisplayParameters: DisneyDisplayParameters;
struct DisneyDisplayVertex { @builtin(position) position: vec4f };
@vertex fn disneyDisplayVertex(@builtin(vertex_index) index: u32) -> DisneyDisplayVertex {
  let uv = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  return DisneyDisplayVertex(vec4f(uv * 2.0 - 1.0, 0.0, 1.0));
}
${displayTransformWgsl('acesFilmic', 'disneyDisplayParameters.tonemap')}
@fragment fn disneyDisplayFragment(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let p = vec2u(position.xy);
  let index = p.y * disneyDisplayParameters.size.x + p.x;
  let pixel = disneyDisplayPixels[index];
  if (pixel.samples == 0u) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  return vec4f(display_color(pixel.sum.xyz / f32(pixel.samples), disneyDisplayParameters.exposure), 1.0);
}`;
}

function validateOptions(device: GPUDevice, scene: DisneySceneData, options: DisneyGpuBackendOptions): number {
  if (!Number.isSafeInteger(options.width) || options.width <= 0 ||
      !Number.isSafeInteger(options.height) || options.height <= 0 ||
      options.width * options.height > 0xffffffff) {
    throw new Error('Invalid Disney render target dimensions.');
  }
  if (!Number.isSafeInteger(options.textureSize) || options.textureSize <= 0 ||
      options.textureSize > device.limits.maxTextureDimension2D) {
    throw new Error('Invalid Disney material texture size.');
  }
  if (!options.lights.length || options.lights.length % 20 !== 0 ||
      options.lights.some(value => !Number.isFinite(value) || !Number.isFinite(Math.fround(value)))) {
    throw new Error('Disney lights must contain finite five-texel records.');
  }
  const pixelBytes = options.width * options.height * DISNEY_RENDER_PIXEL_BYTES;
  if (pixelBytes > device.limits.maxStorageBufferBindingSize || pixelBytes > device.limits.maxBufferSize) {
    throw new Error(`Disney accumulation buffer exceeds GPU limits: ${pixelBytes} bytes.`);
  }
  if (options.lights.byteLength > device.limits.maxStorageBufferBindingSize ||
      options.lights.byteLength > device.limits.maxBufferSize) {
    throw new Error('Disney light buffer exceeds GPU limits.');
  }
  if (scene.materials.length === 0) throw new Error('Disney scene has no materials.');
  return pixelBytes;
}

/** Owns uploaded scene resources, the compute pipeline and progressive pixel accumulation. */
export class DisneyGpuBackend {
  readonly #device: GPUDevice;
  readonly #pipeline: GPUComputePipeline;
  readonly #displayPipeline: GPURenderPipeline;
  readonly #sceneGroup: GPUBindGroup;
  readonly #renderGroup: GPUBindGroup;
  readonly #displayGroup: GPUBindGroup;
  readonly #parameters: GPUBuffer;
  readonly #displayParameters: GPUBuffer;
  readonly #pixels: GPUBuffer;
  readonly #error: GPUBuffer;
  readonly #errorReadback: GPUBuffer;
  readonly #pixelReadback: GPUBuffer;
  readonly #width: number;
  readonly #height: number;
  readonly #pixelCount: number;
  readonly #owned: Array<{ destroy(): void }>;
  readonly #specialization: DisneyShaderSpecialization | undefined;
  readonly #scene: { geometry: DisneyGpuGeometryTextures; materials: GPUBuffer; lights: GPUBuffer; textureCount: number };
  #disposed = false;

  private constructor(
    device: GPUDevice, pipeline: GPUComputePipeline, displayPipeline: GPURenderPipeline,
    sceneGroup: GPUBindGroup, renderGroup: GPUBindGroup, displayGroup: GPUBindGroup,
    parameters: GPUBuffer, displayParameters: GPUBuffer, pixels: GPUBuffer, error: GPUBuffer, errorReadback: GPUBuffer,
    pixelReadback: GPUBuffer, width: number, height: number, owned: Array<{ destroy(): void }>,
    specialization: DisneyShaderSpecialization | undefined,
    scene: { geometry: DisneyGpuGeometryTextures; materials: GPUBuffer; lights: GPUBuffer; textureCount: number },
  ) {
    this.#scene = scene;
    this.#device = device;
    this.#pipeline = pipeline;
    this.#displayPipeline = displayPipeline;
    this.#sceneGroup = sceneGroup;
    this.#renderGroup = renderGroup;
    this.#displayGroup = displayGroup;
    this.#parameters = parameters;
    this.#displayParameters = displayParameters;
    this.#pixels = pixels;
    this.#error = error;
    this.#errorReadback = errorReadback;
    this.#pixelReadback = pixelReadback;
    this.#width = width;
    this.#height = height;
    this.#pixelCount = width * height;
    this.#owned = owned;
    this.#specialization = specialization;
  }

  static async create(
    device: GPUDevice, scene: DisneySceneData, options: DisneyGpuBackendOptions,
  ): Promise<DisneyGpuBackend> {
    const pixelBytes = validateOptions(device, scene, options);
    const created: Array<{ destroy(): void }> = [];
    const own = <T extends { destroy(): void }>(resource: T): T => { created.push(resource); return resource; };
    try {
      const geometry = own(uploadDisneyGeometryTextures(device, scene.geometry));
      const materials = own(uploadDisneyMaterials(device, scene.materials, scene.textures.references().length));
      let materialMaps = await uploadDisneyTextureArray(
        device, scene.textures, options.imageProvider, options.textureSize, options.textureSize,
      );
      if (materialMaps) own(materialMaps);
      else {
        const dummyMaps = own(device.createTexture({
          label: 'Disney empty texture array', size: [1, 1, 1], format: 'rgba8uint',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        }));
        device.queue.writeTexture({ texture: dummyMaps }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1, 1]);
        materialMaps = dummyMaps;
      }

      let environment: GPUTexture;
      let environmentCdf: GPUBuffer;
      let cdf: Float32Array;
      if (options.environment) {
        const packed = buildDisneyEnvironmentCdf(options.environment);
        if (packed.width > device.limits.maxTextureDimension2D || packed.height > device.limits.maxTextureDimension2D ||
            packed.cdf.byteLength > device.limits.maxBufferSize) {
          throw new Error('Disney environment exceeds GPU texture or buffer limits.');
        }
        cdf = packed.cdf;
        const rgba = new Float32Array(packed.width * packed.height * 4);
        for (let i = 0; i < packed.width * packed.height; i++) {
          rgba.set(options.environment.data.subarray(i * 3, i * 3 + 3), i * 4);
          rgba[i * 4 + 3] = 1;
        }
        environment = own(device.createTexture({
          label: 'Disney HDR environment', size: [packed.width, packed.height], format: 'rgba32float',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        }));
        device.queue.writeTexture({ texture: environment }, rgba, { bytesPerRow: packed.width * 16 }, [packed.width, packed.height]);
      } else {
        cdf = new Float32Array([1]);
        environment = own(device.createTexture({
          label: 'Disney empty environment', size: [1, 1], format: 'rgba32float',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        }));
        device.queue.writeTexture({ texture: environment }, new Float32Array([0, 0, 0, 1]), { bytesPerRow: 16 }, [1, 1]);
      }
      if (cdf.byteLength > device.limits.maxStorageBufferBindingSize) throw new Error('Disney environment CDF exceeds GPU limits.');
      environmentCdf = own(device.createBuffer({
        label: 'Disney environment CDF', size: Math.max(4, cdf.byteLength),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      }));
      device.queue.writeBuffer(environmentCdf, 0, cdf);
      const lightBuffer = own(device.createBuffer({
        label: 'Disney lights', size: options.lights.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      }));
      device.queue.writeBuffer(lightBuffer, 0, options.lights);

      const specialization = options.specialization ? { ...options.specialization } : undefined;
      const shader = specialization
        ? specializeDisneyShader(DISNEY_RENDER_SHADER, specialization)
        : DISNEY_RENDER_SHADER;
      const module = device.createShaderModule({ label: 'Disney path tracer', code: shader });
      const displayModule = device.createShaderModule({ label: 'Disney display shader', code: displayShader() });
      const [compilation, displayCompilation] = await Promise.all([
        module.getCompilationInfo(),
        displayModule.getCompilationInfo(),
      ]);
      const errors = compilation.messages.filter(message => message.type === 'error');
      if (errors.length) throw new Error(`Disney WGSL compilation failed:\n${errors.map(error => `${error.lineNum}: ${error.message}`).join('\n')}`);
      const displayErrors = displayCompilation.messages.filter(message => message.type === 'error');
      if (displayErrors.length) {
        throw new Error(`Disney display WGSL compilation failed:\n${displayErrors.map(error => `${error.lineNum}: ${error.message}`).join('\n')}`);
      }
      const [pipeline, displayPipeline] = await Promise.all([
        device.createComputePipelineAsync({
          label: 'Disney progressive path tracer', layout: 'auto',
          compute: { module, entryPoint: 'disneyRenderTile' },
        }).catch(error => {
          throw new Error(`Disney compute pipeline creation failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
        }),
        device.createRenderPipelineAsync({
          label: 'Disney display pipeline', layout: 'auto',
          vertex: { module: displayModule, entryPoint: 'disneyDisplayVertex' },
          fragment: { module: displayModule, entryPoint: 'disneyDisplayFragment', targets: [{ format: options.outputFormat }] },
          primitive: { topology: 'triangle-list' },
        }).catch(error => {
          throw new Error(`Disney display pipeline creation failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
        }),
      ]);
      const sceneGroup = device.createBindGroup({
        label: 'Disney scene resources', layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: geometry.nodes.createView() },
          { binding: 1, resource: geometry.triangleIndices.createView() },
          { binding: 2, resource: geometry.vertices.createView() },
          { binding: 3, resource: geometry.inverseTransforms.createView() },
          { binding: 4, resource: geometry.normals.createView() },
          { binding: 5, resource: geometry.transforms.createView() },
          { binding: 6, resource: { buffer: materials } },
          { binding: 7, resource: materialMaps.createView({ dimension: '2d-array' }) },
          { binding: 8, resource: environment.createView() },
          { binding: 9, resource: { buffer: environmentCdf } },
          { binding: 10, resource: { buffer: lightBuffer } },
          { binding: 11, resource: geometry.subsetMaterials.createView() },
        ],
      });
      const createBuffer = (label: string, size: number, usage: GPUBufferUsageFlags) =>
        own(device.createBuffer({ label, size, usage }));
      const parameters = createBuffer('Disney render parameters', DISNEY_RENDER_UNIFORM_BYTES,
        GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
      const pixels = createBuffer('Disney progressive accumulation', pixelBytes,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
      const error = createBuffer('Disney render error', 4,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
      const errorReadback = createBuffer('Disney error readback', 4, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
      const pixelReadback = createBuffer('Disney pixel readback', pixelBytes, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
      const renderGroup = device.createBindGroup({
        label: 'Disney tile resources', layout: pipeline.getBindGroupLayout(1),
        entries: [
          { binding: 0, resource: { buffer: parameters } },
          { binding: 1, resource: { buffer: pixels } },
          { binding: 2, resource: { buffer: error } },
        ],
      });
      const displayParameters = createBuffer('Disney display parameters', 16,
        GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
      const displayGroup = device.createBindGroup({
        label: 'Disney display resources', layout: displayPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: pixels } },
          { binding: 1, resource: { buffer: displayParameters } },
        ],
      });
      return new DisneyGpuBackend(device, pipeline, displayPipeline, sceneGroup, renderGroup, displayGroup,
        parameters, displayParameters, pixels, error, errorReadback, pixelReadback, options.width, options.height,
        created, specialization,
        { geometry, materials, lights: lightBuffer, textureCount: scene.textures.references().length });
    } catch (error) {
      for (const resource of created.reverse()) resource.destroy();
      throw error;
    }
  }

  /** Overwrite texels of the packed geometry textures (rows are split as uploaded). */
  writeTexels(writes: readonly DisneyTexelWrite[]): void {
    this.#assertLive();
    for (const { target, firstTexel, data } of writes) {
      const texture = this.#scene.geometry[target];
      const width = texture.width;
      const count = data.length / 4;
      if (!Number.isInteger(count) || firstTexel < 0 || firstTexel + count > width * texture.height) {
        throw new Error(`Disney ${target} write exceeds its texture.`);
      }
      let texel = 0;
      while (texel < count) {
        const index = firstTexel + texel;
        const x = index % width, y = Math.floor(index / width);
        // A partial first row, then whole rows, then a partial last row.
        const rows = x === 0 ? Math.max(1, Math.floor((count - texel) / width)) : 1;
        const columns = rows > 1 ? width : Math.min(width - x, count - texel);
        this.#device.queue.writeTexture({ texture, origin: [x, y] }, data, {
          offset: texel * 16, bytesPerRow: columns * 16, rowsPerImage: rows,
        }, [columns, rows]);
        texel += columns * rows;
      }
    }
  }

  /** Replace the light records; their count is compiled into the shader. */
  writeLights(lights: Float32Array): void {
    this.#assertLive();
    if (lights.byteLength !== this.#scene.lights.size) throw new Error('The Disney light count changed.');
    this.#device.queue.writeBuffer(this.#scene.lights, 0, lights);
  }

  /** Replace the material records; texture layers cannot be added in place. */
  writeMaterials(materials: readonly DisneyMaterial[]): void {
    this.#assertLive();
    if (materials.some(material => material.textures.some(id => id >= this.#scene.textureCount))) {
      throw new Error('The Disney material references a new texture layer.');
    }
    const data = packDisneyMaterials(materials);
    if (data.byteLength !== this.#scene.materials.size) throw new Error('The Disney material count changed.');
    this.#device.queue.writeBuffer(this.#scene.materials, 0, data);
  }

  reset(): void {
    this.#assertLive();
    this.#device.queue.writeBuffer(this.#pixels, 0, new Uint8Array(this.#pixelCount * DISNEY_RENDER_PIXEL_BYTES));
    this.#device.queue.writeBuffer(this.#error, 0, new Uint32Array([0]));
  }

  renderTile(settings: DisneyRenderSettings, targetView?: GPUTextureView, exposure = 0, tonemap: Tonemap = 'acesFilmic'): void {
    this.#assertLive();
    if (settings.resolution[0] !== this.#width || settings.resolution[1] !== this.#height) {
      throw new Error('Disney render tile resolution does not match the backend buffers.');
    }
    if (this.#specialization) assertDisneyShaderSpecialization(settings, this.#specialization);
    const workgroupsX = Math.ceil(settings.tileSize[0] / 8);
    const workgroupsY = Math.ceil(settings.tileSize[1] / 8);
    if (workgroupsX > this.#device.limits.maxComputeWorkgroupsPerDimension ||
        workgroupsY > this.#device.limits.maxComputeWorkgroupsPerDimension) {
      throw new Error('Disney render tile exceeds the GPU dispatch limit.');
    }
    this.#device.queue.writeBuffer(this.#parameters, 0, packDisneyRenderSettings(settings));
    if (targetView) {
      if (!Number.isFinite(exposure) || !Number.isFinite(Math.fround(exposure))) {
        throw new Error('Invalid Disney display exposure.');
      }
      const displayData = new ArrayBuffer(16);
      new Uint32Array(displayData).set(settings.resolution, 0);
      new Float32Array(displayData)[2] = exposure;
      new Float32Array(displayData)[3] = tonemapIndex(tonemap);
      this.#device.queue.writeBuffer(this.#displayParameters, 0, displayData);
    }
    const encoder = this.#device.createCommandEncoder({ label: 'Disney render tile' });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.#pipeline);
    pass.setBindGroup(0, this.#sceneGroup);
    pass.setBindGroup(1, this.#renderGroup);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
    if (targetView) {
      const display = encoder.beginRenderPass({
        colorAttachments: [{ view: targetView, loadOp: 'clear', storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      });
      display.setPipeline(this.#displayPipeline);
      display.setBindGroup(0, this.#displayGroup);
      display.draw(3);
      display.end();
    }
    this.#device.queue.submit([encoder.finish()]);
  }

  display(targetView: GPUTextureView, resolution: readonly [number, number], exposure = 0, tonemap: Tonemap = 'acesFilmic'): void {
    this.#assertLive();
    if (resolution[0] !== this.#width || resolution[1] !== this.#height) {
      throw new Error('Disney display resolution does not match the backend buffers.');
    }
    if (!Number.isFinite(exposure) || !Number.isFinite(Math.fround(exposure))) {
      throw new Error('Invalid Disney display exposure.');
    }
    const displayData = new ArrayBuffer(16);
    new Uint32Array(displayData).set(resolution, 0);
    new Float32Array(displayData)[2] = exposure;
    new Float32Array(displayData)[3] = tonemapIndex(tonemap);
    this.#device.queue.writeBuffer(this.#displayParameters, 0, displayData);
    const encoder = this.#device.createCommandEncoder({ label: 'Disney display' });
    const display = encoder.beginRenderPass({
      colorAttachments: [{ view: targetView, loadOp: 'clear', storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    });
    display.setPipeline(this.#displayPipeline);
    display.setBindGroup(0, this.#displayGroup);
    display.draw(3);
    display.end();
    this.#device.queue.submit([encoder.finish()]);
  }

  async readError(): Promise<number> {
    this.#assertLive();
    const encoder = this.#device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.#error, 0, this.#errorReadback, 0, 4);
    this.#device.queue.submit([encoder.finish()]);
    await this.#errorReadback.mapAsync(GPUMapMode.READ);
    const value = new Uint32Array(this.#errorReadback.getMappedRange())[0]!;
    this.#errorReadback.unmap();
    return value;
  }

  async readPixels(): Promise<DisneyGpuPixel> {
    this.#assertLive();
    const encoder = this.#device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.#pixels, 0, this.#pixelReadback, 0, this.#pixelCount * DISNEY_RENDER_PIXEL_BYTES);
    this.#device.queue.submit([encoder.finish()]);
    await this.#pixelReadback.mapAsync(GPUMapMode.READ);
    const data = this.#pixelReadback.getMappedRange().slice(0);
    this.#pixelReadback.unmap();
    const sums = new Float32Array(data);
    const records = new Uint32Array(data);
    const color = new Float32Array(this.#pixelCount * 4);
    const samples = new Uint32Array(this.#pixelCount);
    for (let i = 0; i < this.#pixelCount; i++) {
      const offset = i * (DISNEY_RENDER_PIXEL_BYTES / 4);
      if (records[offset + 5] !== 0) throw new Error(`Disney pixel ${i} failed with error ${records[offset + 5]}.`);
      const count = records[offset + 4]!;
      samples[i] = count;
      if (count === 0) continue;
      for (let channel = 0; channel < 4; channel++) {
        color[i * 4 + channel] = sums[offset + channel]! / count;
        if (!Number.isFinite(color[i * 4 + channel]!)) throw new Error(`Disney pixel ${i} contains a non-finite result.`);
      }
    }
    return { color, samples };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const resource of this.#owned.reverse()) resource.destroy();
  }

  #assertLive(): void {
    if (this.#disposed) throw new Error('Disney GPU backend has been disposed.');
  }
}
