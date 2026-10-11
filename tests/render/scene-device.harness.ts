// T035d device harness: evaluate the raster shading model on the real mobile GPU
// over the shared visibility samples (T035c2) and report the shaded colours so
// the CPU oracle (rasterShade, T035c3) can be compared at scene level. It mirrors
// the forward opaque fragment math (Lambert + ambient) in a compute dispatch so
// the comparison isolates GPU fp32 arithmetic from rasterisation/visibility (the
// samples are shared with the oracle). Nothing here runs under Node: it is served
// to the device exactly like the corpus harness (T034e).
import fixture from '../fixtures/shader-ball.json' with { type: 'json' };
import scenes from '../fixtures/control-scenes.json' with { type: 'json' };
import materials from '../fixtures/scene-materials.json' with { type: 'json' };
import { fitShaderBall, sampleSurface, type CameraParams } from './scene-samples.ts';
import { effectiveAlbedo, type CanonMaterial } from './scene-shade.ts';

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

const SHADE_WGSL = `struct P {
  lightDir : vec4<f32>,
  lightColor : vec4<f32>,
  baseColor : vec4<f32>,
  ambient : f32,
  count : u32,
};
@group(0) @binding(0) var<storage, read> inN : array<f32>;
@group(0) @binding(1) var<storage, read_write> outC : array<f32>;
@group(0) @binding(2) var<uniform> u : P;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i >= u.count) { return; }
  let b = i * 3u;
  let n = normalize(vec3<f32>(inN[b], inN[b + 1u], inN[b + 2u]));
  let l = normalize(u.lightDir.xyz);
  let ndotl = max(dot(n, l), 0.0);
  let lit = u.baseColor.rgb * (u.ambient + u.lightColor.rgb * ndotl);
  outC[b] = lit.x;
  outC[b + 1u] = lit.y;
  outC[b + 2u] = lit.z;
}`;

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
  inBuffer: GPUBuffer,
  normals: Float32Array,
  baseColor: readonly number[],
  lightDir: readonly number[],
  lightColor: readonly number[],
): Promise<Float32Array> {
  const count = normals.length / 3;
  const bytes = normals.byteLength;
  const outBuffer = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readBuffer = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });

  const params = new ArrayBuffer(64);
  const dv = new DataView(params);
  dv.setFloat32(0, lightDir[0]!, true);
  dv.setFloat32(4, lightDir[1]!, true);
  dv.setFloat32(8, lightDir[2]!, true);
  dv.setFloat32(16, lightColor[0]!, true);
  dv.setFloat32(20, lightColor[1]!, true);
  dv.setFloat32(24, lightColor[2]!, true);
  dv.setFloat32(32, baseColor[0]!, true);
  dv.setFloat32(36, baseColor[1]!, true);
  dv.setFloat32(40, baseColor[2]!, true);
  dv.setFloat32(48, 0.03, true);
  dv.setUint32(52, count, true);
  const uniform = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(uniform, 0, params);

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: inBuffer } },
      { binding: 1, resource: { buffer: outBuffer } },
      { binding: 2, resource: { buffer: uniform } },
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
  for (const s of grid.samples) {
    if (!s.hit) continue;
    hitNormals.push(s.normal[0], s.normal[1], s.normal[2]);
  }
  const normals = new Float32Array(hitNormals);
  const inBuffer = device.createBuffer({ size: normals.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(inBuffer, 0, normals);

  const module = device.createShaderModule({ code: SHADE_WGSL });
  const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });

  const lightDir = [-scenes.light.direction[0]!, -scenes.light.direction[1]!, -scenes.light.direction[2]!];
  const inv = scenes.light.intensity / Math.PI;
  const lightColor = [scenes.light.color[0]! * inv, scenes.light.color[1]! * inv, scenes.light.color[2]! * inv];

  const results: SceneDeviceResult[] = [];
  for (const id of Object.keys(materials.scenes)) {
    const albedo = effectiveAlbedo(material(id));
    const shaded = await shadeOnDevice(device, pipeline, inBuffer, normals, albedo, lightDir, lightColor);
    results.push({ id, shaded: Array.from(shaded) });
  }
  inBuffer.destroy();
  return { width: RES, height: RES, hitCount: normals.length / 3, scenes: results };
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
