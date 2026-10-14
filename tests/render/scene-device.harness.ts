// T035d/T045 device harness: evaluate the real OpenPBR raster surface on the GPU
// over the shared visibility samples (T035c2) and report the shaded colours so
// the independent analytic reference (src/render/bsdf/reference.ts evaluateSurface)
// can be compared at scene level. T058d: the device shading now runs through the
// SAME shared IR source the raster/path-tracer backends use -- a compiled layered
// surface module (emitLayeredSurface) reconstructed into a LayeredClosure and
// evaluated with mx_closure_eval, mirroring the forward fragment's direct term
// (ir-forward.ts) -- so the comparison isolates GPU fp32 arithmetic of the IR
// closure from rasterisation/visibility (the samples are shared with the oracle).
// Nothing here runs under Node: it is served to the device exactly like the
// corpus harness (T034e).
import fixture from '../fixtures/shader-ball.json' with { type: 'json' };
import scenes from '../fixtures/control-scenes.json' with { type: 'json' };
import materials from '../fixtures/scene-materials.json' with { type: 'json' };
import { fitShaderBall, sampleSurface, type CameraParams } from './scene-samples.ts';
import type { CanonMaterial } from './scene-shade.ts';
import { emitLayeredSurface } from '../../src/compiler/surface-wgsl.ts';
import { resolveSurface } from '../../src/materialx/surface-graph.ts';
import type { ResolvedGraph, ResolvedInput, ResolvedNode, ResolvedValueSource } from '../../src/materialx/graph.ts';
import { resolvePixel } from '../../src/render/output.ts';

export interface SceneDeviceResult {
  readonly id: string;
  /** Flat rgb over the hit samples, in grid hit order. */
  readonly shaded: readonly number[];
}

export interface SceneDeviceReport {
  readonly userAgent: string;
  readonly adapter: Record<string, string>;
  readonly width: number;
  readonly height: number;
  readonly hitCount: number;
  readonly scenes: readonly SceneDeviceResult[];
}

const RES = 32;

/** A folded standard_surface input literal for the canonical material value. */
function value(name: string, type: string, raw: string): ResolvedInput {
  const source: ResolvedValueSource = { kind: 'value', value: raw, type };
  return { name, type, source, provenance: { namePath: `/mat/${name}` } };
}

/** Build a standard_surface graph from the canonical scene material: every input
 *  is a literal, so emitLayeredSurface folds them into the shader (no uniforms). */
function surfaceGraphFor(mat: CanonMaterial): ResolvedGraph {
  const inputs: ResolvedInput[] = [
    value('base_color', 'color3', `${mat.baseColor[0]}, ${mat.baseColor[1]}, ${mat.baseColor[2]}`),
    value('metalness', 'float', `${mat.metalness}`),
    value('specular', 'float', `${mat.specular}`),
    value('specular_roughness', 'float', `${mat.roughness}`),
    value('specular_IOR', 'float', `${mat.ior}`),
    value('transmission', 'float', `${mat.transmission}`),
    value('subsurface', 'float', `${mat.subsurface}`),
  ];
  const surface: ResolvedNode = {
    id: 'SR',
    category: 'standard_surface',
    type: 'surfaceshader',
    inputs,
    provenance: { namePath: '/mat/SR' },
  };
  return {
    terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: 'SR', provenance: { namePath: '/mat/SR' } }],
    nodes: new Map<string, ResolvedNode>([['SR', surface]]),
  };
}

/**
 * Compose the compute shade shader from the compiled layered surface module: the
 * module carries the shared closure library + mx_surface_layered; this wrapper
 * reconstructs the LayeredClosure per sample and evaluates the same direct term
 * as the forward fragment (delta light, no shadow, one constant-env sample). The
 * material constants are folded into the module, so the uniform only carries the
 * light and environment (the baseColor/material/coat slots stay for layout parity
 * with the oracle packing but are unread).
 */
function irShadeWgsl(mat: CanonMaterial): string {
  const module = emitLayeredSurface(surfaceGraphFor(mat), resolveSurface(surfaceGraphFor(mat), {})!);
  return `${module.code}

struct P {
  baseColor : vec4<f32>,
  material : vec4<f32>,
  coat : vec4<f32>,
  lightDir : vec4<f32>,
  lightColor : vec4<f32>,
  environment : vec4<f32>,
  count : u32,
};
@group(0) @binding(0) var<storage, read> inN : array<f32>;
@group(0) @binding(1) var<storage, read> inV : array<f32>;
@group(0) @binding(2) var<storage, read_write> outC : array<f32>;
@group(0) @binding(3) var<uniform> u : P;

fn basis(n : vec3<f32>) -> mat3x3<f32> {
  let s = select(-1.0, 1.0, n.z >= 0.0);
  let a = -1.0 / (s + n.z);
  let b = n.x * n.y * a;
  let t = vec3<f32>(1.0 + s * n.x * n.x * a, s * b, -s * n.x);
  let bt = vec3<f32>(b, s + n.y * n.y * a, -n.y);
  return mat3x3<f32>(t, bt, n);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i >= u.count) { return; }
  let bi = i * 3u;
  let n = normalize(vec3<f32>(inN[bi], inN[bi + 1u], inN[bi + 2u]));
  let v = normalize(vec3<f32>(inV[bi], inV[bi + 1u], inV[bi + 2u]));
  var vary : MxVaryings;
  vary.position = vec3<f32>(0.0);
  vary.normal = n;
  vary.viewDir = v;
  vary.texcoord = vec2<f32>(0.0);
  let c = mx_surface_layered(vary);
  let sframe = basis(n);
  let wo = transpose(sframe) * v;
  let toLight = normalize(-u.lightDir.xyz);
  let wiLight = transpose(sframe) * toLight;
  let ev = mx_closure_eval(c, wo, wiLight);
  let cosL = max(dot(n, toLight), 0.0);
  var radiance = ev.value * (u.lightColor.xyz * u.lightColor.w) * cosL;
  let wiEnv = vec3<f32>(0.0, 0.0, 1.0);
  let evEnv = mx_closure_eval(c, wo, wiEnv);
  radiance = radiance + evEnv.value * u.environment.xyz * MX_PI;
  if (c.hasEmission != 0u) { radiance = radiance + c.emission; }
  outC[bi] = radiance.x;
  outC[bi + 1u] = radiance.y;
  outC[bi + 2u] = radiance.z;
}`;
}

function material(id: string): CanonMaterial {
  const m = (materials.scenes as Record<string, {
    family: string; focus: string[]; baseColor: number[]; metalness: number; roughness: number;
    transmission: number; subsurface: number; ior: number; specular: number;
  }>)[id]!;
  return {
    family: m.family,
    focus: m.focus,
    baseColor: [m.baseColor[0]!, m.baseColor[1]!, m.baseColor[2]!],
    metalness: m.metalness,
    roughness: m.roughness,
    transmission: m.transmission,
    subsurface: m.subsurface,
    ior: m.ior,
    specular: m.specular,
  };
}

/** Shade the hit-sample normals on the GPU for one scene's uniforms. */
async function shadeOnDevice(
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  normalBuffer: GPUBuffer,
  viewBuffer: GPUBuffer,
  count: number,
  bytes: number,
  mat: CanonMaterial,
  lightDir: readonly number[],
  lightColor: readonly number[],
  intensity: number,
  environment: readonly number[],
): Promise<Float32Array> {
  const outBuffer = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readBuffer = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });

  const params = new ArrayBuffer(112);
  const dv = new DataView(params);
  dv.setFloat32(0, mat.baseColor[0]!, true);
  dv.setFloat32(4, mat.baseColor[1]!, true);
  dv.setFloat32(8, mat.baseColor[2]!, true);
  dv.setFloat32(16, mat.metalness, true);
  dv.setFloat32(20, mat.roughness, true);
  dv.setFloat32(24, mat.transmission, true);
  dv.setFloat32(28, mat.subsurface, true);
  dv.setFloat32(32, mat.ior, true);
  dv.setFloat32(36, mat.specular, true);
  dv.setFloat32(48, lightDir[0]!, true);
  dv.setFloat32(52, lightDir[1]!, true);
  dv.setFloat32(56, lightDir[2]!, true);
  dv.setFloat32(64, lightColor[0]!, true);
  dv.setFloat32(68, lightColor[1]!, true);
  dv.setFloat32(72, lightColor[2]!, true);
  dv.setFloat32(76, intensity, true);
  dv.setFloat32(80, environment[0]!, true);
  dv.setFloat32(84, environment[1]!, true);
  dv.setFloat32(88, environment[2]!, true);
  dv.setUint32(96, count, true);
  const uniform = device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(uniform, 0, params);

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: normalBuffer } },
      { binding: 1, resource: { buffer: viewBuffer } },
      { binding: 2, resource: { buffer: outBuffer } },
      { binding: 3, resource: { buffer: uniform } },
    ],
  });

  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(count / 64));
  pass.end();
  enc.copyBufferToBuffer(outBuffer, 0, readBuffer, 0, bytes);
  device.queue.submit([enc.finish()]);

  await readBuffer.mapAsync(GPUMapMode.READ);
  const out = new Float32Array(readBuffer.getMappedRange().slice(0));
  readBuffer.unmap();
  outBuffer.destroy();
  readBuffer.destroy();
  uniform.destroy();
  return out;
}

function cameraParams(): CameraParams {
  return {
    eye: [scenes.camera.eye[0]!, scenes.camera.eye[1]!, scenes.camera.eye[2]!],
    target: [scenes.camera.target[0]!, scenes.camera.target[1]!, scenes.camera.target[2]!],
    up: [scenes.camera.up[0]!, scenes.camera.up[1]!, scenes.camera.up[2]!],
    fovYRadians: scenes.camera.fovYRadians,
    aspect: scenes.camera.aspect,
  };
}

/** Run the device shading pass for every raster+pathtracing scene. */
export async function runScenesOnDevice(device: GPUDevice): Promise<Omit<SceneDeviceReport, 'userAgent' | 'adapter'>> {
  const surface = fitShaderBall(fixture);
  const grid = sampleSurface(surface, cameraParams(), RES, RES);
  const hitNormals: number[] = [];
  const hitViews: number[] = [];
  for (const s of grid.samples) {
    if (!s.hit) continue;
    hitNormals.push(s.normal[0], s.normal[1], s.normal[2]);
    hitViews.push(s.viewDir[0], s.viewDir[1], s.viewDir[2]);
  }
  const normals = new Float32Array(hitNormals);
  const views = new Float32Array(hitViews);
  const count = normals.length / 3;
  const bytes = normals.byteLength;
  const normalBuffer = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const viewBuffer = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(normalBuffer, 0, normals);
  device.queue.writeBuffer(viewBuffer, 0, views);

  // Reference semantics (src/render/bsdf/reference.ts): L = normalize(-direction),
  // radiance = color * intensity, environment added once per lobe.
  const lightDir = [scenes.light.direction[0]!, scenes.light.direction[1]!, scenes.light.direction[2]!];
  const lightColor = [scenes.light.color[0]!, scenes.light.color[1]!, scenes.light.color[2]!];
  const intensity = scenes.light.intensity;
  const environment = [
    scenes.environment.constantRadiance[0]!,
    scenes.environment.constantRadiance[1]!,
    scenes.environment.constantRadiance[2]!,
  ];

  const results: SceneDeviceResult[] = [];
  for (const id of Object.keys(materials.scenes)) {
    const mat = material(id);
    // One pipeline per material: constants are folded into the IR shader.
    const module = device.createShaderModule({ code: irShadeWgsl(mat) });
    const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    const shaded = await shadeOnDevice(
      device, pipeline, normalBuffer, viewBuffer, count, bytes, mat, lightDir, lightColor, intensity, environment,
    );
    results.push({ id, shaded: Array.from(shaded) });
  }
  normalBuffer.destroy();
  viewBuffer.destroy();
  return { width: RES, height: RES, hitCount: count, scenes: results };
}

export interface SceneDeviceImage {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  /** PNG data URL produced on the device from the GPU-shaded frame. */
  readonly dataUrl: string;
}

/**
 * Render a full raster frame of the shader ball for one scene on the device GPU
 * and return it as an RGBA8 buffer (row-major, length res*res*4). Visibility is
 * sampled on the CPU exactly like the oracle grid (scene-samples.ts) but at full
 * image resolution; every hit is shaded by the same OpenPBR WGSL the oracle uses,
 * so the pixels come straight off the mobile GPU.
 */
export async function renderSceneImageOnDevice(
  device: GPUDevice,
  sceneId: string,
  res: number,
): Promise<Uint8ClampedArray> {
  const surface = fitShaderBall(fixture);
  const grid = sampleSurface(surface, cameraParams(), res, res);
  const hitNormals: number[] = [];
  const hitViews: number[] = [];
  const hitIndex: number[] = [];
  grid.samples.forEach((s, i) => {
    if (!s.hit) return;
    hitNormals.push(s.normal[0], s.normal[1], s.normal[2]);
    hitViews.push(s.viewDir[0], s.viewDir[1], s.viewDir[2]);
    hitIndex.push(i);
  });
  const normals = new Float32Array(hitNormals);
  const views = new Float32Array(hitViews);
  const count = normals.length / 3;
  const bytes = Math.max(normals.byteLength, 4);
  const normalBuffer = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const viewBuffer = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(normalBuffer, 0, normals);
  device.queue.writeBuffer(viewBuffer, 0, views);

  const mat = material(sceneId);
  const module = device.createShaderModule({ code: irShadeWgsl(mat) });
  const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });

  const lightDir = [scenes.light.direction[0]!, scenes.light.direction[1]!, scenes.light.direction[2]!];
  const lightColor = [scenes.light.color[0]!, scenes.light.color[1]!, scenes.light.color[2]!];
  const intensity = scenes.light.intensity;
  const environment = [
    scenes.environment.constantRadiance[0]!,
    scenes.environment.constantRadiance[1]!,
    scenes.environment.constantRadiance[2]!,
  ];

  const shaded = count > 0
    ? await shadeOnDevice(
        device, pipeline, normalBuffer, viewBuffer, count, bytes, mat,
        lightDir, lightColor, intensity, environment,
      )
    : new Float32Array(0);
  normalBuffer.destroy();
  viewBuffer.destroy();

  const rgba = new Uint8ClampedArray(res * res * 4);
  for (let p = 0; p < res * res; p++) {
    rgba[p * 4 + 3] = 255; // opaque dark background
  }
  for (let h = 0; h < count; h++) {
    const px = hitIndex[h]!;
    const b = h * 3;
    const enc = resolvePixel([[shaded[b]!, shaded[b + 1]!, shaded[b + 2]!]]);
    const o = px * 4;
    rgba[o] = Math.round(enc.color[0] * 255);
    rgba[o + 1] = Math.round(enc.color[1] * 255);
    rgba[o + 2] = Math.round(enc.color[2] * 255);
    rgba[o + 3] = 255;
  }
  return rgba;
}

/** Browser entry: render one scene's raster frame on the device and publish a PNG data URL. */
export async function bootstrapImage(
  sceneId = 'standard_surface_carpaint',
  res = 256,
): Promise<SceneDeviceImage | null> {
  const root = typeof document !== 'undefined' ? document.getElementById('log') ?? document.body : undefined;
  const line = (msg: string): void => {
    if (!root) return;
    const p = document.createElement('p');
    p.textContent = msg;
    root.appendChild(p);
  };

  if (typeof navigator === 'undefined' || !navigator.gpu) {
    line('WebGPU indisponible sur cet appareil.');
    (globalThis as { __MX_IMAGE__?: SceneDeviceImage | null }).__MX_IMAGE__ = null;
    return null;
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    line('Aucun adaptateur WebGPU.');
    (globalThis as { __MX_IMAGE__?: SceneDeviceImage | null }).__MX_IMAGE__ = null;
    return null;
  }
  const device = await adapter.requestDevice();

  line(`Rendu raster de ${sceneId} (${res}x${res}) sur le GPU...`);
  const rgba = await renderSceneImageOnDevice(device, sceneId, res);

  const canvas = document.createElement('canvas');
  canvas.width = res;
  canvas.height = res;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    line('Canvas 2D indisponible.');
    (globalThis as { __MX_IMAGE__?: SceneDeviceImage | null }).__MX_IMAGE__ = null;
    return null;
  }
  ctx.putImageData(new ImageData(rgba, res, res), 0, 0);
  const dataUrl = canvas.toDataURL('image/png');

  const img = document.createElement('img');
  img.src = dataUrl;
  img.width = Math.min(512, res * 2);
  if (root) root.appendChild(img);

  const image: SceneDeviceImage = { id: sceneId, width: res, height: res, dataUrl };
  (globalThis as { __MX_IMAGE__?: SceneDeviceImage | null }).__MX_IMAGE__ = image;
  line(`${adapterFields(adapter).vendor ?? 'gpu'} / ${adapterFields(adapter).architecture ?? '?'} - image prete.`);
  return image;
}

function adapterFields(adapter: GPUAdapter): Record<string, string> {
  const info = adapter.info;
  if (!info) return {};
  return { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description };
}

function ua(): string {
  return typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
}

async function post(report: SceneDeviceReport): Promise<void> {
  try {
    await fetch('/collect-scenes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
    });
  } catch {
    // The collector may be absent during a manual run; the CDP global still carries the report.
  }
}

/** Browser entry: acquire the device, shade every scene and publish the report. */
export async function bootstrap(): Promise<SceneDeviceReport> {
  const root = typeof document !== 'undefined' ? document.getElementById('log') ?? document.body : undefined;
  const line = (msg: string): void => {
    if (!root) return;
    const p = document.createElement('p');
    p.textContent = msg;
    root.appendChild(p);
  };

  const empty: SceneDeviceReport = { userAgent: ua(), adapter: {}, width: 0, height: 0, hitCount: 0, scenes: [] };
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    line('WebGPU indisponible sur cet appareil.');
    (globalThis as { __MX_SCENE_REPORT__?: SceneDeviceReport }).__MX_SCENE_REPORT__ = empty;
    await post(empty);
    return empty;
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    line('Aucun adaptateur WebGPU.');
    (globalThis as { __MX_SCENE_REPORT__?: SceneDeviceReport }).__MX_SCENE_REPORT__ = empty;
    await post(empty);
    return empty;
  }
  const device = await adapter.requestDevice();

  line('Rendu raster des scenes sur le GPU...');
  const body = await runScenesOnDevice(device);
  const report: SceneDeviceReport = { userAgent: ua(), adapter: adapterFields(adapter), ...body };
  line(`${report.scenes.length} scenes rendues (${report.hitCount} pixels), envoi du rapport...`);
  (globalThis as { __MX_SCENE_REPORT__?: SceneDeviceReport }).__MX_SCENE_REPORT__ = report;
  await post(report);
  line('Rapport envoye.');
  return report;
}
