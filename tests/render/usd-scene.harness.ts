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

import { emitWgsl } from '../../src/compiler/wgsl.ts';
import { FLOAT, IrModuleBuilder, shaderType } from '../../src/compiler/ir.ts';
import {
  NEUTRAL_SURFACE,
  type FrameCamera,
  type RasterSurface,
} from '../../src/render/raster/scene-frame.ts';
import {
  buildSceneResources,
  type MaterialBuild,
  type MaterialCompiler,
  type MaterialResource,
  type MeshSource,
} from '../../src/render/scene-resources.ts';
import { buildPathTraceScene } from '../../src/render/pathtracing/scene-buffers.ts';
import { buildPathTraceUniform, PathTraceBackend, PT_UNIFORM_SIZE } from '../../src/render/pathtracing/compute.ts';
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

/** Placeholder baked-map texture edge length (texels); the GPU keeps a single
 *  unused layer now that the CPU nodegraph bake path is retired (T055e5). */
const BAKE_SIZE = 256;

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

/** Minimal opaque material compiler (surface params come from the .mtlx files). */
function stubCompiler(): MaterialCompiler {
  return {
    compile(): MaterialBuild {
      const b = new IrModuleBuilder();
      const opacity = b.constant(FLOAT, 1);
      const ref = b.add({ kind: 'closure', type: shaderType('surface'), closure: 'bsdf', op: 'surface', params: { opacity } });
      b.output({ name: 'surfaceshader', type: shaderType('surface'), ref });
      const ir = b.build();
      return { ir, module: emitWgsl(ir) };
    },
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

/** Path-traces the real USDA geometry on the device GPU and returns display RGBA. */
async function renderUsdOnDevice(
  device: GPUDevice,
  entry: string,
  res: number,
  samples: number,
  line: (m: string) => void,
): Promise<Uint8ClampedArray> {
  const sink = (d: { level: string; message: string }): void => {
    if (d.level === 'warning' || d.level === 'error') line(`diag: ${d.message}`);
  };

  const reader = httpReader(entry);
  const scene = await importUsdStage(entry, { reader, sink });
  const lights = importLights(scene, { sink });
  const cameras = importCameras(scene, { sink });

  // Resolve the OpenPBR/standard_surface surfaces straight off the referenced
  // .mtlx layers through the shared bridge. The CPU nodegraph bake path is retired
  // (T055e5): textured base_color / specular_roughness fall back to their literal
  // anchor until the path tracer samples the compiled shader directly (T057), so
  // bakedByName stays empty and the GPU keeps a single unused placeholder layer.
  const baseDir = dirOf(entry);
  const surfaces = new Map<string, RasterSurface>();
  const bakedByName = new Map<string, { size: number; rgba: Uint8Array }>();
  for (const ref of scene.materials) {
    const url = joinUrl(baseDir, ref.assetPath);
    try {
      const text = await (await fetch(url)).text();
      surfaces.set(ref.materialName, surfaceFromMtlx(text));
    } catch {
      line(`MaterialX introuvable: ${ref.assetPath}`);
    }
  }
  const surfaceFor = (material: MaterialResource): RasterSurface =>
    surfaces.get(material.materialName) ?? NEUTRAL_SURFACE;

  const resources = await buildSceneResources(scene, {
    meshSource: meshSourceFromScene(scene),
    materialCompiler: stubCompiler(),
    sink,
  });

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
    `diag light dir=[${ptScene.light.direction.map((x) => x.toFixed(2)).join(',')}] ` +
      `col=[${ptScene.light.color.map((x) => x.toFixed(2)).join(',')}] int=${ptScene.light.intensity} ` +
      `env=[${ptScene.environment.radiance.map((x) => x.toFixed(2)).join(',')}]`,
  );

  // Compute path tracer on the packed scene buffers, progressive accumulation.
  const backend = new PathTraceBackend(device, { textures: true });
  const { pipeline } = backend.createPipeline();
  const storage = (data: Float32Array | Uint32Array | Int32Array): GPUBuffer => {
    const buf = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(buf, 0, data);
    return buf;
  };
  const nodesBuffer = storage(ptScene.nodes);
  const trisBuffer = storage(ptScene.triangles);
  const triOrderBuffer = storage(ptScene.triangleOrder);
  const materialsBuffer = storage(ptScene.materials);
  const triUvBuffer = storage(ptScene.triangleUv.length > 0 ? ptScene.triangleUv : new Float32Array(6));

  // Map each packed material (keyed by instance material key) to a baked texture layer.
  const bakedLayers: Array<{ size: number; rgba: Uint8Array }> = [];
  const layerForName = new Map<string, number>();
  for (const [name, baked] of bakedByName) {
    layerForName.set(name, bakedLayers.length);
    bakedLayers.push(baked);
  }
  const matLayer = new Int32Array(Math.max(ptScene.materialCount, 1)).fill(-1);
  for (let i = 0; i < ptScene.materialCount; i++) {
    const key = ptScene.materialKeys[i];
    const mat = key !== undefined ? resources.materials.get(key) : undefined;
    const layer = mat ? layerForName.get(mat.materialName) : undefined;
    if (layer !== undefined) matLayer[i] = layer;
  }
  const matLayerBuffer = storage(matLayer);

  // Diagnostics: surface why a scene renders black (black bake vs -1 layer vs UVs).
  line(`diag matLayer=[${Array.from(matLayer).join(',')}] layers=${bakedLayers.length} exposure=${exposure}`);
  for (let l = 0; l < bakedLayers.length; l++) {
    const px = bakedLayers[l]!.rgba;
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    const n = px.length / 4;
    for (let i = 0; i < px.length; i += 4) {
      r += px[i]!;
      g += px[i + 1]!;
      b += px[i + 2]!;
      a += px[i + 3]!;
    }
    line(`diag bake[${l}] mean rgba=${(r / n).toFixed(1)},${(g / n).toFixed(1)},${(b / n).toFixed(1)},${(a / n).toFixed(1)}`);
  }
  let uvNonZero = 0;
  for (let i = 0; i < ptScene.triangleUv.length; i++) if (ptScene.triangleUv[i] !== 0) uvNonZero++;
  line(`diag uv: ${uvNonZero}/${ptScene.triangleUv.length} nonzero`);

  // Baked nodegraph maps as a 2D texture array (RGB = base color, A = roughness).
  const layerCount = Math.max(bakedLayers.length, 1);
  const bakedTex = device.createTexture({
    size: [BAKE_SIZE, BAKE_SIZE, layerCount],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    dimension: '2d',
  });
  for (let l = 0; l < bakedLayers.length; l++) {
    const baked = bakedLayers[l]!;
    device.queue.writeTexture(
      { texture: bakedTex, origin: [0, 0, l] },
      baked.rgba,
      { bytesPerRow: baked.size * 4, rowsPerImage: baked.size },
      [baked.size, baked.size, 1],
    );
  }
  const bakedSampler = device.createSampler({
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    magFilter: 'linear',
    minFilter: 'linear',
  });

  const accumBytes = res * res * 16;
  const accumBuffer = device.createBuffer({
    size: accumBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  device.queue.writeBuffer(accumBuffer, 0, new Float32Array(res * res * 4));
  const uniform = device.createBuffer({ size: PT_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniform } },
      { binding: 1, resource: { buffer: nodesBuffer } },
      { binding: 2, resource: { buffer: trisBuffer } },
      { binding: 3, resource: { buffer: triOrderBuffer } },
      { binding: 4, resource: { buffer: materialsBuffer } },
      { binding: 5, resource: { buffer: accumBuffer } },
      { binding: 6, resource: { buffer: triUvBuffer } },
      { binding: 7, resource: { buffer: matLayerBuffer } },
      { binding: 8, resource: bakedTex.createView({ dimension: '2d-array' }) },
      { binding: 9, resource: bakedSampler },
    ],
  });
  const [wgX, wgY] = PathTraceBackend.workgroupCount(res, res);

  backend.resetAccumulation();
  for (let f = 0; f < samples; f++) {
    const frameIndex = backend.advanceFrame();
    device.queue.writeBuffer(uniform, 0, buildPathTraceUniform(ptScene, frameIndex, 1, res, res));
    const encoder = device.createCommandEncoder();
    const compute = encoder.beginComputePass();
    compute.setPipeline(pipeline);
    compute.setBindGroup(0, bindGroup);
    compute.dispatchWorkgroups(wgX, wgY, 1);
    compute.end();
    device.queue.submit([encoder.finish()]);
  }

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
  return rgba;
}

export async function bootstrapUsdImage(
  entry = '/scenes/test_material_disney_gold/test_material_disney_gold.usda',
  res = 256,
  samples = 192,
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
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    line('Aucun adaptateur WebGPU.');
    return fail();
  }
  const device = await adapter.requestDevice();

  line(`Rendu path-trace GPU de ${entry} (${res}x${res}, ${samples} spp)...`);
  const rgba = await renderUsdOnDevice(device, entry, res, samples, line);

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
  const image: UsdSceneImage = { entry, width: res, height: res, samples, dataUrl };
  (globalThis as { __MX_IMAGE__?: UsdSceneImage | null }).__MX_IMAGE__ = image;
  line(`${info?.vendor ?? 'gpu'} / ${info?.architecture ?? '?'} - image prete.`);
  return image;
}
