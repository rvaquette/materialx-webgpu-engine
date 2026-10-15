// Mobile USD render harness (plan section 9, T053). Unlike scene-device.harness
// (which shades a shader-ball fixture with canned control-scene materials), this
// harness renders the REAL geometry of a text USDA stage on the device GPU: it
// fetches the .usda + referenced .mtlx layers over HTTP, imports the composed
// stage (src/usd/importer.ts), builds device-neutral SceneResources, then drives
// the WebGPU compute path tracer (src/render/pathtracing/compute.ts) fed by the
// packed scene buffers (scene-buffers.ts) with progressive accumulation. The path
// tracer -- not the raster forward pass -- is used here on purpose: a pure metal
// (the gold cube/sphere) only looks metallic when it reflects the ground and the
// environment through traced rays, whereas the raster forward model reflects a
// single constant environment radiance and therefore renders metal flat. The
// preview camera and neutral fill mirror scripts/validate-disney-gold.ts so the
// subject is legible. The accumulated mean is read back, tonemapped through the
// shared output pipeline, and exposed as a PNG data URL on globalThis.__MX_IMAGE__.

import {
  NEUTRAL_SURFACE,
  buildSceneFrame,
  buildSceneFrameUniform,
  buildSceneMaterialUniform,
  type FrameCamera,
  type RasterSurface,
} from '../../src/render/raster/scene-frame.ts';
import {
  RasterBackend,
  RESOLVE_UNIFORM_SIZE,
  SCENE_FRAME_UNIFORM_SIZE,
  SCENE_MATERIAL_UNIFORM_SIZE,
  type ScenePassKind,
  type SceneDrawCall,
} from '../../src/render/raster/backend.ts';
import {
  buildSceneResources,
  createSceneBindGroups,
  uploadGeometry,
  type MaterialResource,
  type MeshSource,
} from '../../src/render/scene-resources.ts';
import { buildPathTraceScene } from '../../src/render/pathtracing/scene-buffers.ts';
import { buildPathTraceUniform, PathTraceBackend, PT_UNIFORM_SIZE } from '../../src/render/pathtracing/compute.ts';
import { buildMaterialDispatch } from '../../src/render/pathtracing/material-variant.ts';
import { buildPtDeviceBindings, type PtImageProvider } from '../../src/render/pathtracing/device-bindings.ts';
import { createGraphMaterialCompiler } from '../../src/render/graph-material-compiler.ts';
import { loadMaterialXDocuments } from '../../src/materialx/document-source.ts';
import { loadMaterialXCore } from '../../src/materialx/wasm.ts';
import { MaterialXLibraries, defaultLibrarySources } from '../../src/materialx/libraries.ts';
import type { DecodedPixelImage } from '../../src/assets/images.ts';
import {
  parseSurfaceInputsFromMtlx,
  parsedSurfaceToCanonical,
} from '../../src/materialx/surface-from-inputs.ts';
import { resolvePixel } from '../../src/render/output.ts';
import { importCameras } from '../../src/usd/cameras.ts';
import { importLights } from '../../src/usd/lights.ts';
import { importUsdStage, type UsdLayerReader } from '../../src/usd/importer.ts';
import { lookAt4, multiply4, perspective4, type Vec3 } from '../../src/scene/transforms.ts';
import type { RawMesh, Primvar, PrimvarInterpolation } from '../../src/geometry/prepare.ts';
import type { SceneAsset, ScenePrim } from '../../src/scene/types.ts';

export interface UsdSceneImage {
  entry: string;
  width: number;
  height: number;
  samples: number;
  dataUrl: string;
  /** Which backend produced the image. */
  backend: 'raster' | 'pathtracing';
  /** GPU render wall-clock in milliseconds (submit -> onSubmittedWorkDone). */
  renderMs: number;
}

/** Directory portion of a URL-ish path, keeping the trailing slash. */
function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(0, i + 1) : '';
}

/** Resolves a relative layer uri against a base directory (no .. handling needed). */
function joinUrl(baseDir: string, rel: string): string {
  if (rel.startsWith('/') || /^https?:/.test(rel)) return rel;
  return baseDir + rel.replace(/^\.\//, '');
}

/** Reads USD layers over HTTP, resolving relative sublayers against the entry dir. */
function httpReader(entry: string): UsdLayerReader {
  const baseDir = dirOf(entry);
  return {
    async read(uri: string): Promise<string> {
      const url = uri.startsWith('/') || /^https?:/.test(uri) ? uri : joinUrl(baseDir, uri);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return res.text();
    },
  };
}

/** Flat numeric attribute array (point3f[]/int[] flatten to number[]). */
function numArray(prim: ScenePrim, name: string): number[] {
  const value = prim.attributes.get(name)?.value;
  return Array.isArray(value) ? (value as readonly unknown[]).map((v) => Number(v)) : [];
}

/** Supplies inline USDA mesh geometry per prototype prim path. */
function meshSourceFromScene(scene: SceneAsset): MeshSource {
  return {
    meshFor(primPath: string): RawMesh | undefined {
      const prim = scene.prims.get(primPath);
      if (!prim) return undefined;
      const points = numArray(prim, 'points');
      const faceVertexCounts = numArray(prim, 'faceVertexCounts');
      const faceVertexIndices = numArray(prim, 'faceVertexIndices');
      if (points.length === 0 || faceVertexCounts.length === 0 || faceVertexIndices.length === 0) {
        return undefined;
      }
      const orientation = prim.attributes.get('orientation')?.value;
      const leftHanded = orientation === 'leftHanded';
      // Pass authored normals through so hard-edged meshes (e.g. the cube) keep
      // their per-face normals instead of being smooth-averaged into a blob.
      const normalValues = numArray(prim, 'normals');
      const normalInterp = prim.attributes.get('normals')?.interpolation as PrimvarInterpolation | undefined;
      const normals: Primvar | undefined =
        normalValues.length > 0
          ? { name: 'normals', interpolation: normalInterp ?? 'faceVarying', values: normalValues, elementSize: 3 }
          : undefined;
      // Pass the st texture coordinates through so textured nodegraph materials
      // (evaluated + baked per UV) sample correctly in the path tracer.
      const stValues = numArray(prim, 'primvars:st');
      const stInterp = prim.attributes.get('primvars:st')?.interpolation as PrimvarInterpolation | undefined;
      const st: Primvar | undefined =
        stValues.length > 0
          ? { name: 'st', interpolation: stInterp ?? 'faceVarying', values: stValues, elementSize: 2 }
          : undefined;
      return {
        points,
        faceVertexCounts,
        faceVertexIndices,
        ...(leftHanded ? { leftHanded: true } : {}),
        ...(normals ? { normals } : {}),
        ...(st ? { primvars: [st] } : {}),
      };
    },
  };
}

/** Resolve a .mtlx surface to the canonical raster surface via the shared bridge.
 *  T055e5: the regex parseOpenPbr is gone -- the raw text is parsed into a
 *  ParsedSurfaceInputs (parseSurfaceInputsFromMtlx) then reduced to the shared
 *  seven-parameter anchor (parsedSurfaceToCanonical), the same path the fixture
 *  builder uses, until the path tracer is wired on the LayeredClosure (T057). */
function surfaceFromMtlx(text: string): RasterSurface {
  const spec = parseSurfaceInputsFromMtlx(text);
  if (!spec) return { ...NEUTRAL_SURFACE, baseColor: [...NEUTRAL_SURFACE.baseColor] };
  const c = parsedSurfaceToCanonical(spec);
  return {
    baseColor: [c.baseColor[0], c.baseColor[1], c.baseColor[2]],
    metalness: c.metalness,
    roughness: c.roughness,
    transmission: c.transmission,
    subsurface: c.subsurface,
    ior: c.ior,
    specular: c.specular,
  };
}

/** Preview camera + fill that frame the cube/sphere cluster legibly (validate-disney-gold). */
function previewCamera(exposure: number): FrameCamera {
  const target: Vec3 = [0, 0.3, 0];
  const dir: Vec3 = [0.657, 0.438, 0.613];
  const dist = 7;
  const eye: Vec3 = [target[0] + dir[0] * dist, target[1] + dir[1] * dist, target[2] + dir[2] * dist];
  return { viewProj: multiply4(perspective4(0.62, 1, 0.1, 100), lookAt4(eye, target, [0, 1, 0])), eye, exposure };
}

const PREVIEW_ENV: Vec3 = [0.65, 0.68, 0.72];

// Served dev-server paths for the MaterialX Core WASM and standard libraries the
// graph material compiler path consumes (T057m3b). The device matrix run (T057m4)
// provides the static serving; the module and libraries roots are overridable here.
const MATERIALX_CORE_URL = '/materialx/JsMaterialXCore.js';
const MATERIALX_WASM_DIR = '/materialx/';
const MATERIALX_LIBRARIES_ROOT = '/materialx/libraries';

interface MtlxSceneContext {
  documents: Awaited<ReturnType<typeof loadMaterialXDocuments>>;
  imageProvider: PtImageProvider;
  surfaceFor: (material: MaterialResource) => RasterSurface;
}

/** Load the MaterialX Core WASM + standard libraries, read every referenced .mtlx
 *  into a document source, and return the graph-compiler document set plus an image
 *  provider that decodes texture files off a 2D canvas. Shared by both backends so
 *  raster and the path tracer compile the SAME procedural/textured materials. */
async function loadMtlxSceneContext(
  scene: SceneAsset,
  entry: string,
  line: (m: string) => void,
  sink: (d: { level: string; message: string; detail?: unknown }) => void,
): Promise<MtlxSceneContext> {
  const baseDir = dirOf(entry);
  const surfaces = new Map<string, RasterSurface>();
  const texts = new Map<string, string>();
  const materialDirs: string[] = [];
  for (const ref of scene.materials) {
    const url = joinUrl(baseDir, ref.assetPath);
    const dir = dirOf(url);
    if (!materialDirs.includes(dir)) materialDirs.push(dir);
    try {
      const text = await (await fetch(url)).text();
      texts.set(ref.assetPath, text);
      surfaces.set(ref.materialName, surfaceFromMtlx(text));
    } catch {
      line(`MaterialX introuvable: ${ref.assetPath}`);
    }
  }
  const core = await loadMaterialXCore({
    moduleUrl: MATERIALX_CORE_URL,
    locateFile: (path) => MATERIALX_WASM_DIR + path,
    onDiagnostic: sink,
  });
  line('diag step: core loaded');
  const libraries = new MaterialXLibraries(core);
  await libraries.load({
    sources: defaultLibrarySources(MATERIALX_LIBRARIES_ROOT),
    fetchText: async (url) => (await fetch(url)).text(),
    onDiagnostic: sink,
  });
  line('diag step: libraries loaded');
  const documents = await loadMaterialXDocuments({ core, libraries, texts, sink });
  line('diag step: documents loaded');
  const imageProvider: PtImageProvider = {
    async decode(fileRef: string): Promise<DecodedPixelImage | undefined> {
      for (const dir of materialDirs) {
        try {
          const resp = await fetch(joinUrl(dir, fileRef));
          if (!resp.ok) continue;
          const bitmap = await createImageBitmap(await resp.blob());
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            bitmap.close();
            return undefined;
          }
          ctx.drawImage(bitmap, 0, 0);
          const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
          bitmap.close();
          return {
            kind: 'pixels',
            data: new Uint8Array(pixels.data),
            componentType: 'uint8',
            channels: 4,
            width: pixels.width,
            height: pixels.height,
            colorSpace: 'lin_rec709',
          };
        } catch {
          // try the next candidate material directory
        }
      }
      line(`Texture introuvable: ${fileRef}`);
      return undefined;
    },
  };
  const surfaceFor = (material: MaterialResource): RasterSurface => surfaces.get(material.materialName) ?? NEUTRAL_SURFACE;
  return { documents, imageProvider, surfaceFor };
}

/** Decode + upload every texture a compiled surface module samples and key the GPU
 *  views/samplers by the module binding name so createSceneBindGroups can wire
 *  them (T058 raster-sur-IR, textured path). Decoded images are cached by file
 *  reference across materials; the sampler matches the CPU oracle (repeat/linear). */
async function uploadMaterialTextures(
  device: GPUDevice,
  material: MaterialResource,
  imageProvider: PtImageProvider,
  cache: Map<string, DecodedPixelImage | undefined>,
): Promise<{ textureViews: Map<string, GPUTextureView>; samplers: Map<string, GPUSampler> }> {
  const textureViews = new Map<string, GPUTextureView>();
  const samplers = new Map<string, GPUSampler>();
  const module = material.surfaceModule;
  if (!module) return { textureViews, samplers };
  for (const t of module.textures) {
    const fileRef = t.fileRef;
    if (fileRef === undefined) continue;
    let image = cache.get(fileRef);
    if (!cache.has(fileRef)) {
      image = (await imageProvider.decode(fileRef)) ?? undefined;
      cache.set(fileRef, image);
    }
    const width = image?.width ?? 1;
    const height = image?.height ?? 1;
    const gpuTex = device.createTexture({
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    if (image && image.componentType === 'uint8' && image.channels === 4) {
      device.queue.writeTexture({ texture: gpuTex }, image.data, { bytesPerRow: width * 4, rowsPerImage: height }, [width, height, 1]);
    }
    textureViews.set(t.name, gpuTex.createView());
  }
  for (const s of module.samplers) {
    samplers.set(s.name, device.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear' }));
  }
  return { textureViews, samplers };
}

/** Raster-renders the real USDA geometry offscreen on the device GPU (T058 path)
 *  and returns display RGBA plus the GPU wall-clock in milliseconds. */
async function renderUsdRasterOnDevice(
  device: GPUDevice,
  entry: string,
  res: number,
  line: (m: string) => void,
): Promise<{ rgba: Uint8ClampedArray; renderMs: number }> {
  const sink = (d: { level: string; message: string }): void => {
    if (d.level === 'warning' || d.level === 'error') line(`diag: ${d.message}`);
  };

  const reader = httpReader(entry);
  const scene = await importUsdStage(entry, { reader, sink });
  const lights = importLights(scene, { sink });
  const cameras = importCameras(scene, { sink });

  // Compile every material through the real graph material compiler (same path as
  // the path tracer, T057m1): constant, procedural AND textured nodegraphs lower
  // to the shared LayeredClosure, so the raster forward pass shades an arbitrary
  // mtlx faithfully instead of the retired fixed 7-parameter standard_surface.
  const { documents, imageProvider, surfaceFor } = await loadMtlxSceneContext(scene, entry, line, sink);

  const resources = await buildSceneResources(scene, {
    meshSource: meshSourceFromScene(scene),
    materialCompiler: createGraphMaterialCompiler({ documents, sink }),
    sink,
  });
  line('diag step: scene resources built');

  const camera = cameras[0];
  const exposure = camera?.exposure ?? 0;
  const frame = buildSceneFrame(resources, {
    lights,
    frameCamera: previewCamera(exposure),
    environment: { radiance: PREVIEW_ENV },
    surfaceFor,
  });
  line(`${frame.draws.length} draw(s), passes [${frame.passes.join(', ')}], ${frame.skipped.length} ignore(s)`);

  const outputFormat: GPUTextureFormat = 'rgba8unorm';
  const backend = new RasterBackend({ device, outputFormat, tonemap: 'acesFilmic' });
  for (const draw of frame.draws) {
    const material = draw.materialKey ? resources.materials.get(draw.materialKey) : undefined;
    if (material?.sceneShader) {
      backend.createSceneVariantPipeline(draw.pass, material.variant.pipelineKey, material.sceneShader.code);
    }
  }
  const resolvePipeline = backend.createResolvePipeline();

  // Decode + upload each material's sampled textures once, keyed by material unit.
  const imageCache = new Map<string, DecodedPixelImage | undefined>();
  const materialTextures = new Map<string, { textureViews: Map<string, GPUTextureView>; samplers: Map<string, GPUSampler> }>();
  for (const [key, material] of resources.materials) {
    if (material.surfaceModule && material.surfaceModule.textures.length > 0) {
      materialTextures.set(key, await uploadMaterialTextures(device, material, imageProvider, imageCache));
    }
  }

  const hdrTexture = device.createTexture({
    size: [res, res],
    format: backend.hdrFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const depthTexture = device.createTexture({
    size: [res, res],
    format: backend.depthFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const outputTexture = device.createTexture({
    size: [res, res],
    format: outputFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const hdrView = hdrTexture.createView();
  const depthView = depthTexture.createView();
  const outputView = outputTexture.createView();

  const uploaded = new Map<string, ReturnType<typeof uploadGeometry>>();
  for (const [id, geometry] of resources.geometries) uploaded.set(id, uploadGeometry(device, geometry, id));

  const drawsByPass = new Map<ScenePassKind, SceneDrawCall[]>();
  const zeroTexcoords = new Map<string, GPUBuffer>();
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
        texcoord = device.createBuffer({ size: geometry.vertexCount * 8, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(texcoord, 0, new Float32Array(geometry.vertexCount * 2));
        zeroTexcoords.set(draw.prototypeId, texcoord);
      }
    }
    const frameUniform = device.createBuffer({ size: SCENE_FRAME_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(frameUniform, 0, buildSceneFrameUniform(frame, draw));
    const materialUniform = device.createBuffer({ size: SCENE_MATERIAL_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(materialUniform, 0, buildSceneMaterialUniform(draw));
    const textures = draw.materialKey ? materialTextures.get(draw.materialKey) : undefined;
    const bindGroups = createSceneBindGroups(
      device,
      material,
      {
        frame: frameUniform,
        material: materialUniform,
        ...(textures ? { textureViews: textures.textureViews, samplers: textures.samplers } : {}),
      },
      (group) => pipeline.getBindGroupLayout(group),
    );
    const list = drawsByPass.get(draw.pass) ?? [];
    // Collect the texture/sampler groups (everything beyond material 0 and frame)
    // so recordScenePass can bind them alongside the material and frame groups.
    const textureBindGroups = new Map<number, GPUBindGroup>();
    for (const [group, bindGroup] of bindGroups.byGroup) {
      if (bindGroup !== bindGroups.materialBindGroup && bindGroup !== bindGroups.frameBindGroup) {
        textureBindGroups.set(group, bindGroup);
      }
    }
    list.push({
      materialBindGroup: bindGroups.materialBindGroup,
      frameBindGroup: bindGroups.frameBindGroup,
      positionBuffer: position,
      normalBuffer: normal,
      texcoordBuffer: texcoord,
      indexBuffer: buffers.indexBuffer,
      indexCount: buffers.indexCount,
      pipelineKey: material.variant.pipelineKey,
      ...(textureBindGroups.size > 0 ? { textureBindGroups } : {}),
    });
    drawsByPass.set(draw.pass, list);
  }

  const resolveUniform = device.createBuffer({ size: RESOLVE_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
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

  // Record the opaque/transmission scene passes into HDR, then tonemap-resolve
  // into the rgba8unorm output texture and copy it back for PNG encoding.
  const renderStart = performance.now();
  const encoder = device.createCommandEncoder();
  let firstPass = true;
  for (const pass of frame.passes) {
    const draws = drawsByPass.get(pass) ?? [];
    if (draws.length === 0) continue;
    backend.recordScenePass(encoder, { pass, hdrView, depthView, draws, clear: firstPass, clearColor: frame.environment.radiance });
    firstPass = false;
  }
  backend.recordResolvePass(encoder, { outputView, bindGroup: resolveBindGroup });
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  const renderMs = performance.now() - renderStart;

  const bytesPerRow = res * 4;
  const readback = device.createBuffer({ size: bytesPerRow * res, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const copy = device.createCommandEncoder();
  copy.copyTextureToBuffer({ texture: outputTexture }, { buffer: readback, bytesPerRow, rowsPerImage: res }, [res, res, 1]);
  device.queue.submit([copy.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const rgba = new Uint8ClampedArray(new Uint8Array(readback.getMappedRange()).slice(0));
  readback.unmap();
  let lit = 0;
  for (let p = 0; p < res * res; p++) if (Math.max(rgba[p * 4]!, rgba[p * 4 + 1]!, rgba[p * 4 + 2]!) > 0) lit++;
  line(`diag raster lit=${lit}/${res * res} exposure=${exposure} renderMs=${renderMs.toFixed(1)}`);
  return { rgba, renderMs };
}

/** Path-traces the real USDA geometry on the device GPU and returns display RGBA. */
async function renderUsdOnDevice(
  device: GPUDevice,
  entry: string,
  res: number,
  samples: number,
  line: (m: string) => void,
): Promise<{ rgba: Uint8ClampedArray; renderMs: number }> {
  const sink = (d: { level: string; message: string; detail?: unknown }): void => {
    if (d.level === 'warning' || d.level === 'error') {
      line(`diag: ${d.message}`);
      const stack = (d.detail as { stack?: string } | undefined)?.stack;
      if (stack) for (const l of stack.split('\n').slice(0, 6)) if (l.trim()) line(`  at ${l.trim()}`);
    }
  };

  const reader = httpReader(entry);
  const scene = await importUsdStage(entry, { reader, sink });
  const lights = importLights(scene, { sink });
  const cameras = importCameras(scene, { sink });

  // Load the MaterialX Core WASM and standard libraries once, read every
  // referenced .mtlx into a document source (T057m3a), and feed the graph material
  // compiler (T057m1) so the path tracer builds a megakernel variant per
  // procedural/textured material instead of the retired CPU bake path. Constant
  // materials keep the seven-parameter packed record through surfaceFor.
  const { documents, imageProvider, surfaceFor } = await loadMtlxSceneContext(scene, entry, line, sink);

  const resources = await buildSceneResources(scene, {
    meshSource: meshSourceFromScene(scene),
    materialCompiler: createGraphMaterialCompiler({ documents, sink }),
    sink,
  });
  line('diag step: scene resources built');

  const camera = cameras[0];
  const exposure = camera?.exposure ?? 0;
  const ptScene = buildPathTraceScene(resources, {
    lights,
    surfaceFor,
    frameCamera: previewCamera(exposure),
    environment: { radiance: PREVIEW_ENV },
  });
  line(`${resources.instances.length} instance(s), ${samples} spp`);
  line(
    `diag tris=${ptScene.triangleCount} mats=${ptScene.materialCount} ` +
      `bounds min=[${ptScene.bounds.min.map((x) => x.toFixed(2)).join(',')}] max=[${ptScene.bounds.max.map((x) => x.toFixed(2)).join(',')}] ` +
      `eye=[${ptScene.camera.eye.map((x) => x.toFixed(2)).join(',')}]`,
  );
  line(
    `diag light dir=[${ptScene.light.direction.map((x) => x.toFixed(2)).join(',')}] ` +
      `col=[${ptScene.light.color.map((x) => x.toFixed(2)).join(',')}] int=${ptScene.light.intensity} ` +
      `env=[${ptScene.environment.radiance.map((x) => x.toFixed(2)).join(',')}]`,
  );

  // Build the megakernel dispatch from the resolved variant sources and the device
  // bindings plan (T057m2); textures are decoded by the shared image provider.
  const dispatch = buildMaterialDispatch(ptScene.variantSources);
  const bindings = await buildPtDeviceBindings(dispatch, ptScene, imageProvider, { sink });
  line(`diag variants=${dispatch.variants.length} textures=${bindings.textures.length} exposure=${exposure}`);

  // Compute path tracer on the packed scene buffers, progressive accumulation.
  const backend = new PathTraceBackend(device, { dispatch });
  device.pushErrorScope('validation');
  const { pipeline, module } = backend.createPipeline();
  const pipelineError = await device.popErrorScope();
  if (pipelineError) line(`diag pipeline validation error: ${pipelineError.message}`);
  if (typeof module.getCompilationInfo === 'function') {
    const info = await module.getCompilationInfo();
    for (const m of info.messages) {
      if (m.type === 'error' || m.type === 'warning') {
        line(`diag wgsl ${m.type} L${m.lineNum}:${m.linePos} ${m.message}`);
      }
    }
    line(`diag wgsl messages=${info.messages.length}`);
  }
  const storage = (data: Float32Array | Uint32Array | Int32Array): GPUBuffer => {
    const buf = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(buf, 0, data);
    return buf;
  };
  // Zero-length scene streams (no UVs / tangents) would create an invalid empty
  // buffer, so substitute a single-element array of the matching type.
  const storageData = (data: Float32Array | Uint32Array): GPUBuffer =>
    storage(data.byteLength > 0 ? data : data instanceof Uint32Array ? new Uint32Array(1) : new Float32Array(1));

  const accumBytes = res * res * 16;
  const accumBuffer = device.createBuffer({
    size: accumBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  device.queue.writeBuffer(accumBuffer, 0, new Float32Array(res * res * 4));
  const uniform = device.createBuffer({ size: PT_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  // group-0: the per-frame uniform and accumulation buffers are data-less in the
  // plan (harness-sized), every other slot carries packed scene storage data.
  const group0Entries: GPUBindGroupEntry[] = bindings.group0.map((slot) => {
    if (slot.role === 'uniform') return { binding: slot.binding, resource: { buffer: uniform } };
    if (slot.role === 'accum') return { binding: slot.binding, resource: { buffer: accumBuffer } };
    if (slot.role === 'mxUniforms') {
      // MxUniforms packing is not emitted yet (surface-ir folds constants); bind a
      // zeroed placeholder so the layout stays valid if a variant ever needs it.
      const mx = device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      return { binding: slot.binding, resource: { buffer: mx } };
    }
    return { binding: slot.binding, resource: { buffer: storageData(slot.data ?? new Float32Array(1)) } };
  });
  const group0 = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: group0Entries });

  // group-1 textures + group-2 samplers (only bound when a material samples any).
  const textureViews = new Map<number, GPUTextureView>();
  for (const tex of bindings.textures) {
    const image = bindings.images[tex.imageIndex];
    const width = image?.width ?? 1;
    const height = image?.height ?? 1;
    const gpuTex = device.createTexture({
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    if (image && image.componentType === 'uint8' && image.channels === 4) {
      device.queue.writeTexture(
        { texture: gpuTex },
        image.data,
        { bytesPerRow: width * 4, rowsPerImage: height },
        [width, height, 1],
      );
    }
    textureViews.set(tex.binding, gpuTex.createView());
  }
  const group1 =
    bindings.textures.length > 0
      ? device.createBindGroup({
          layout: pipeline.getBindGroupLayout(1),
          entries: bindings.textures.map((tex) => ({ binding: tex.binding, resource: textureViews.get(tex.binding)! })),
        })
      : undefined;
  const group2 =
    bindings.samplers.length > 0
      ? device.createBindGroup({
          layout: pipeline.getBindGroupLayout(2),
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
  const [wgX, wgY] = PathTraceBackend.workgroupCount(res, res);

  backend.resetAccumulation();
  const renderStart = performance.now();
  device.pushErrorScope('validation');
  const batch = 8;
  for (let f = 0; f < samples; f++) {
    const frameIndex = backend.advanceFrame();
    device.queue.writeBuffer(uniform, 0, buildPathTraceUniform(ptScene, frameIndex, 1, res, res));
    const encoder = device.createCommandEncoder();
    const compute = encoder.beginComputePass();
    compute.setPipeline(pipeline);
    compute.setBindGroup(0, group0);
    if (group1) compute.setBindGroup(1, group1);
    if (group2) compute.setBindGroup(2, group2);
    compute.dispatchWorkgroups(wgX, wgY, 1);
    compute.end();
    device.queue.submit([encoder.finish()]);
    // Flush each batch so a GPU hang/TDR is localized instead of silently
    // stalling the whole accumulation behind one trailing onSubmittedWorkDone.
    if ((f + 1) % batch === 0 || f === samples - 1) {
      await device.queue.onSubmittedWorkDone();
      line(`diag pt frame ${f + 1}/${samples} @ ${(performance.now() - renderStart).toFixed(0)} ms`);
    }
  }
  const frameError = await device.popErrorScope();
  if (frameError) line(`diag dispatch validation error: ${frameError.message}`);
  const renderMs = performance.now() - renderStart;

  // Read the accumulated mean back and tonemap through the shared output pipeline.
  const readback = device.createBuffer({ size: accumBytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const copy = device.createCommandEncoder();
  copy.copyBufferToBuffer(accumBuffer, 0, readback, 0, accumBytes);
  device.queue.submit([copy.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const mean = new Float32Array(readback.getMappedRange());
  const rgba = new Uint8ClampedArray(res * res * 4);
  for (let p = 0; p < res * res; p++) {
    const o = p * 4;
    const color = resolvePixel([[mean[o]!, mean[o + 1]!, mean[o + 2]!]], { exposureEv: exposure }).color;
    rgba[o] = Math.round(color[0] * 255);
    rgba[o + 1] = Math.round(color[1] * 255);
    rgba[o + 2] = Math.round(color[2] * 255);
    rgba[o + 3] = 255;
  }
  {
    let accMax = 0;
    let accSum = 0;
    let nan = 0;
    for (let i = 0; i < res * res * 4; i++) {
      const v = mean[i]!;
      if (Number.isNaN(v)) nan++;
      else {
        if (v > accMax) accMax = v;
        accSum += v;
      }
    }
    let outMax = 0;
    let outNonZero = 0;
    for (let p = 0; p < res * res; p++) {
      const o = p * 4;
      const m = Math.max(rgba[o]!, rgba[o + 1]!, rgba[o + 2]!);
      if (m > outMax) outMax = m;
      if (m > 0) outNonZero++;
    }
    line(`diag accum max=${accMax.toFixed(3)} mean=${(accSum / (res * res * 4)).toFixed(4)} nan=${nan} outMax=${outMax} lit=${outNonZero}/${res * res}`);
  }
  readback.unmap();
  return { rgba, renderMs };
}

export async function bootstrapUsdImage(
  entry = '/scenes/test_material_disney_gold/test_material_disney_gold.usda',
  res = 256,
  samples = 192,
  backend: 'raster' | 'pathtracing' = 'pathtracing',
): Promise<UsdSceneImage | null> {
  const root = typeof document !== 'undefined' ? document.getElementById('log') ?? document.body : undefined;
  const line = (msg: string): void => {
    if (!root) return;
    const p = document.createElement('p');
    p.textContent = msg;
    root.appendChild(p);
  };
  const fail = (): null => {
    (globalThis as { __MX_IMAGE__?: UsdSceneImage | null }).__MX_IMAGE__ = null;
    return null;
  };

  if (typeof navigator === 'undefined' || !navigator.gpu) {
    line('WebGPU indisponible sur cet appareil.');
    return fail();
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) {
    line('Aucun adaptateur WebGPU.');
    return fail();
  }
  const device = await adapter.requestDevice();
  // Surface a GPU device loss (e.g. a Windows TDR watchdog reset after a long
  // megakernel dispatch) instead of hanging silently on onSubmittedWorkDone.
  device.lost.then((info) => line(`diag device lost: ${info.reason} ${info.message}`)).catch(() => undefined);
  device.onuncapturederror = (event) => line(`diag uncaptured error: ${event.error.message}`);

  let rgba: Uint8ClampedArray;
  let renderMs: number;
  if (backend === 'raster') {
    line(`Rendu raster GPU de ${entry} (${res}x${res})...`);
    ({ rgba, renderMs } = await renderUsdRasterOnDevice(device, entry, res, line));
  } else {
    line(`Rendu path-trace GPU de ${entry} (${res}x${res}, ${samples} spp)...`);
    ({ rgba, renderMs } = await renderUsdOnDevice(device, entry, res, samples, line));
  }

  const canvas = document.createElement('canvas');
  canvas.width = res;
  canvas.height = res;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    line('Canvas 2D indisponible.');
    return fail();
  }
  ctx.putImageData(new ImageData(rgba, res, res), 0, 0);
  const dataUrl = canvas.toDataURL('image/png');

  const img = document.createElement('img');
  img.src = dataUrl;
  img.width = Math.min(512, res * 2);
  if (root) root.appendChild(img);

  const info = adapter.info;
  const effectiveSamples = backend === 'raster' ? 1 : samples;
  const image: UsdSceneImage = { entry, width: res, height: res, samples: effectiveSamples, dataUrl, backend, renderMs };
  (globalThis as { __MX_IMAGE__?: UsdSceneImage | null }).__MX_IMAGE__ = image;
  line(`${info?.vendor ?? 'gpu'} / ${info?.architecture ?? '?'} - ${backend} prete en ${renderMs.toFixed(0)} ms.`);
  return image;
}
