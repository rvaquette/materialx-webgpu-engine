// T059c device harness: shade every T059a bxdf-family case (bxdf-families.ts) on
// the real GPU in BOTH backends through the SAME shared compiler output, and
// publish the shaded colours so the independent CPU oracle referenceClosureDirect
// (src/render/bsdf/reference.ts) can be compared at device level. Each case's full
// LayeredClosure is packed into the flat material record (material-record.ts) and
// rebuilt in-shader by the shared reader mx_material_closure, which reads the same
// closure struct (LAYERED_CLOSURE_PRELUDE) and shading library (mx_closure_eval,
// CLOSURE_LIBRARY_PRELUDE) both backends emit. Two compute passes mirror the two
// backends' direct term: the raster forward term clamps the light cosine to zero
// (ir-forward.ts), the path-tracer next-event term uses the absolute cosine
// (compute.ts); both add one constant-environment sample along the normal. Above
// the surface the two agree, so each is compared against the oracle and against
// one another. Nothing here runs under Node -- it is served to the device exactly
// like the scene harness (T035d/T045).
import {
  BXDF_FAMILY_CASES,
  BXDF_DEVICE_GEOMS,
  BXDF_DEVICE_LIGHT,
} from '../fixtures/bxdf-families.ts';
import {
  packLayeredMaterial,
  materialClosureReaderWgsl,
  PT_MATERIAL_RECORD_FLOATS,
} from '../../src/render/pathtracing/material-record.ts';
import { LAYERED_CLOSURE_PRELUDE } from '../../src/compiler/surface-wgsl.ts';
import { CLOSURE_LIBRARY_PRELUDE } from '../../src/compiler/closure-library.ts';
import { MEDIA_HELPERS_PRELUDE } from '../../src/render/pathtracing/compute.ts';

export interface BxdfDeviceCaseResult {
  readonly name: string;
  readonly family: string;
  /** Flat rgb over the device geoms, raster forward direct term (max-cos). */
  readonly raster: readonly number[];
  /** Flat rgb over the device geoms, path-tracer next-event direct term (abs-cos). */
  readonly pathtracing: readonly number[];
}

export interface BxdfDeviceReport {
  readonly userAgent: string;
  readonly adapter: Record<string, string>;
  readonly geomCount: number;
  readonly cases: readonly BxdfDeviceCaseResult[];
}

/** Compose a shade shader that rebuilds the packed closure via the shared reader
 *  and evaluates one backend's direct term (cos clamp selects raster vs pt). */
function bxdfShadeWgsl(cosMode: 'max' | 'abs'): string {
  const cosL = cosMode === 'max' ? 'max(dot(n, toLight), 0.0)' : 'abs(dot(n, toLight))';
  return `${LAYERED_CLOSURE_PRELUDE}
${CLOSURE_LIBRARY_PRELUDE}
// The medium helpers' free-flight sampler needs an rng; it is unused by this harness.
fn rng_next(state : ptr<function, u32>) -> f32 { return 0.5; }
${MEDIA_HELPERS_PRELUDE}
${materialClosureReaderWgsl()}

struct P {
  lightDir : vec4<f32>,
  lightColor : vec4<f32>,
  environment : vec4<f32>,
  count : u32,
};
@group(0) @binding(0) var<storage, read> inN : array<f32>;
@group(0) @binding(1) var<storage, read> inV : array<f32>;
@group(0) @binding(2) var<storage, read_write> outC : array<f32>;
@group(0) @binding(3) var<uniform> u : P;
@group(0) @binding(4) var<storage, read> materials : array<f32>;

// Branchless orthonormal basis (Duff et al. 2017); columns (t, bt, n) map local
// +Z to the world normal. Matches basis() in compute.ts and shadingFrame in bsdf.ts.
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
  let c = mx_material_closure(0u);
  let sframe = basis(n);
  let wo = transpose(sframe) * v;
  let toLight = normalize(-u.lightDir.xyz);
  let wiLight = transpose(sframe) * toLight;
  let ev = mx_closure_eval(c, wo, wiLight);
  let cosL = ${cosL};
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

/** Run one shade pass over the shared geoms for the currently packed material. */
async function shadePass(
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  normalBuffer: GPUBuffer,
  viewBuffer: GPUBuffer,
  materialsBuffer: GPUBuffer,
  uniform: GPUBuffer,
  count: number,
  bytes: number,
): Promise<Float32Array> {
  const outBuffer = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readBuffer = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: normalBuffer } },
      { binding: 1, resource: { buffer: viewBuffer } },
      { binding: 2, resource: { buffer: outBuffer } },
      { binding: 3, resource: { buffer: uniform } },
      { binding: 4, resource: { buffer: materialsBuffer } },
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
  return out;
}

/** Shade every bxdf-family case in both backends over the shared device geoms. */
export async function runBxdfOnDevice(
  device: GPUDevice,
): Promise<Omit<BxdfDeviceReport, 'userAgent' | 'adapter'>> {
  const geoms = BXDF_DEVICE_GEOMS;
  const count = geoms.length;
  const normals = new Float32Array(count * 3);
  const views = new Float32Array(count * 3);
  geoms.forEach((g, i) => {
    normals.set(g.normal, i * 3);
    views.set(g.view, i * 3);
  });
  const bytes = normals.byteLength;
  const normalBuffer = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const viewBuffer = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(normalBuffer, 0, normals);
  device.queue.writeBuffer(viewBuffer, 0, views);

  const compile = async (code: string): Promise<GPUComputePipeline> => {
    const module = device.createShaderModule({ code });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter((m) => m.type === 'error');
    if (errors.length > 0) {
      throw new Error(`WGSL: ${errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join(' | ')}`);
    }
    return device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
  };
  device.pushErrorScope('validation');
  const rasterPipeline = await compile(bxdfShadeWgsl('max'));
  const ptPipeline = await compile(bxdfShadeWgsl('abs'));
  const pipelineError = await device.popErrorScope();
  if (pipelineError) throw new Error(`pipeline: ${pipelineError.message}`);

  const params = new ArrayBuffer(64);
  const dv = new DataView(params);
  dv.setFloat32(0, BXDF_DEVICE_LIGHT.direction[0], true);
  dv.setFloat32(4, BXDF_DEVICE_LIGHT.direction[1], true);
  dv.setFloat32(8, BXDF_DEVICE_LIGHT.direction[2], true);
  dv.setFloat32(16, BXDF_DEVICE_LIGHT.color[0], true);
  dv.setFloat32(20, BXDF_DEVICE_LIGHT.color[1], true);
  dv.setFloat32(24, BXDF_DEVICE_LIGHT.color[2], true);
  dv.setFloat32(28, BXDF_DEVICE_LIGHT.intensity, true);
  dv.setFloat32(32, BXDF_DEVICE_LIGHT.environment[0], true);
  dv.setFloat32(36, BXDF_DEVICE_LIGHT.environment[1], true);
  dv.setFloat32(40, BXDF_DEVICE_LIGHT.environment[2], true);
  dv.setUint32(48, count, true);
  const uniform = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(uniform, 0, params);

  const materialsBuffer = device.createBuffer({
    size: PT_MATERIAL_RECORD_FLOATS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  const cases: BxdfDeviceCaseResult[] = [];
  for (const testCase of BXDF_FAMILY_CASES) {
    device.queue.writeBuffer(materialsBuffer, 0, packLayeredMaterial(testCase.closure));
    const raster = await shadePass(device, rasterPipeline, normalBuffer, viewBuffer, materialsBuffer, uniform, count, bytes);
    const pathtracing = await shadePass(device, ptPipeline, normalBuffer, viewBuffer, materialsBuffer, uniform, count, bytes);
    cases.push({
      name: testCase.name,
      family: testCase.family,
      raster: Array.from(raster),
      pathtracing: Array.from(pathtracing),
    });
  }
  normalBuffer.destroy();
  viewBuffer.destroy();
  uniform.destroy();
  materialsBuffer.destroy();
  return { geomCount: count, cases };
}

function adapterFields(adapter: GPUAdapter): Record<string, string> {
  const info = adapter.info;
  if (!info) return {};
  return { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description };
}

function ua(): string {
  return typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
}

/** Browser entry: acquire the device, shade every case and publish the report. */
export async function bootstrap(): Promise<BxdfDeviceReport> {
  const root = typeof document !== 'undefined' ? document.getElementById('log') ?? document.body : undefined;
  const line = (msg: string): void => {
    if (!root) return;
    const p = document.createElement('p');
    p.textContent = msg;
    root.appendChild(p);
  };

  const empty: BxdfDeviceReport = { userAgent: ua(), adapter: {}, geomCount: 0, cases: [] };
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    line('WebGPU indisponible sur cet appareil.');
    (globalThis as { __MX_BXDF_REPORT__?: BxdfDeviceReport }).__MX_BXDF_REPORT__ = empty;
    return empty;
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    line('Aucun adaptateur WebGPU.');
    (globalThis as { __MX_BXDF_REPORT__?: BxdfDeviceReport }).__MX_BXDF_REPORT__ = empty;
    return empty;
  }
  const device = await adapter.requestDevice();

  line('Rendu des familles BxDF sur le GPU (deux backends)...');
  const body = await runBxdfOnDevice(device);
  const report: BxdfDeviceReport = { userAgent: ua(), adapter: adapterFields(adapter), ...body };
  (globalThis as { __MX_BXDF_REPORT__?: BxdfDeviceReport }).__MX_BXDF_REPORT__ = report;
  line(`${report.cases.length} familles rendues (${report.geomCount} frames), rapport pret.`);
  return report;
}
