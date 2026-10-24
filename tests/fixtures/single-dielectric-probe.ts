import { CLOSURE_LIBRARY_PRELUDE } from '../../src/compiler/closure-library.ts';
import { LAYERED_CLOSURE_PRELUDE } from '../../src/compiler/surface-wgsl.ts';

export function singleDielectricProbe(forwardCode: string): string {
  const start = forwardCode.indexOf('fn mx_forward_single_dielectric(');
  const end = forwardCode.indexOf('fn mx_forward_simple_coat(', start);
  if (start < 0 || end < 0) throw new Error('Forward shader lacks single-dielectric helpers');
  return `${LAYERED_CLOSURE_PRELUDE}
${CLOSURE_LIBRARY_PRELUDE}
struct ProbeFrame { envMap: vec4f, envInfo: vec4f };
var<private> fu: ProbeFrame;
fn mx_forward_environment(d: vec3f) -> vec3f { return vec3f(1.0) + 0.25 * d; }
fn mx_forward_env_pdf(d: vec3f) -> f32 { return 1.0 / (4.0 * MX_PI); }
fn mx_forward_env_direction(u: f32) -> vec3f {
  let z = 1.0 - 2.0 * u;
  let r = sqrt(max(0.0, 1.0 - z * z));
  return vec3f(r * cos(u * 31.0), r * sin(u * 31.0), z);
}
${forwardCode.slice(start, end)}
fn reference_environment(c: LayeredClosure, wo: vec3f) -> vec3f {
  let deltaSpecular = mx_closure_is_specular(c);
  var radiance = vec3f(0.0);
  for (var i = 0u; i < 64u; i++) {
    let u = vec3f((f32(i) + 0.5) / 64.0,
      f32(reverseBits(i)) * 2.3283064365386963e-10,
      fract((f32(i) + 0.5) * 0.61803398875));
    let bs = mx_closure_sample(c, wo, u);
    if (bs.valid && bs.pdf > 0.0) {
      var mis = 1.0;
      if (!deltaSpecular) {
        let envPdf = mx_forward_env_pdf(bs.wi);
        mis = bs.pdf * bs.pdf / max(bs.pdf * bs.pdf + envPdf * envPdf, 1e-20);
      }
      radiance = radiance + bs.value * mx_forward_environment(bs.wi) * (mis * abs(bs.wi.z) / (64.0 * bs.pdf));
    }
    if (!deltaSpecular && fu.envMap.w != 0.0 && fu.envInfo.z > 0.0) {
      let wi = mx_forward_env_direction((f32(i) + 0.5) / 64.0);
      let envPdf = mx_forward_env_pdf(wi);
      let em = mx_closure_eval(c, wo, wi);
      let mis = envPdf * envPdf / max(envPdf * envPdf + em.pdf * em.pdf, 1e-20);
      radiance = radiance + em.value * mx_forward_environment(wi) * (mis * abs(wi.z) / (64.0 * envPdf));
    }
  }
  return radiance;
}
@group(0) @binding(0) var<storage, read_write> results: array<vec4f>;
@compute @workgroup_size(1)
fn probe(@builtin(global_invocation_id) id: vec3u) {
  fu.envMap.w = 1.0;
  fu.envInfo.z = 1.0;
  var c: LayeredClosure;
  c.lobeCount = 2u;
  c.lobes[1].kind = MX_LOBE_DIELECTRIC_TRANSMISSION;
  c.lobes[1].weight = 1.0;
  c.lobes[1].roughness = 0.15;
  c.lobes[1].ior = 1.54;
  c.lobes[1].color = vec3f(0.2, 0.1, 1.0);
  var wo = vec3f(0.6, 0.0, 0.8);
  switch id.x {
    case 1u: { c.lobes[1].weight = 0.35; }
    case 2u: { wo.z = -wo.z; }
    case 3u: { wo = vec3f(0.8, 0.0, -0.6); }
    case 4u: { c.lobes[1].thin = 1.0; }
    case 5u: { c.lobes[1].roughness = 0.5; }
    case 6u: { c.lobes[1].roughness = 0.01; }
    case 7u: { fu.envMap.w = 0.0; fu.envInfo.z = 0.0; }
    case 8u: { c.lobes[1].weight = 0.0; }
    case 9u: { c.hasCoat = 1u; c.coat.weight = 1.0; }
    case 10u: { c.hasFuzz = 1u; c.fuzz.weight = 1.0; }
    case 11u: { c.hasThinFilm = 1u; c.thinFilm = MxThinFilmLayer(1.0, 500.0, 1.4); }
    case 12u: { c.lobes[0] = c.lobes[1]; c.lobes[0].kind = MX_LOBE_CONDUCTOR; }
    case 13u: { c.lobes[0] = c.lobes[1]; }
    case 14u: { c.lobes[0].roughness = 0.8; }
    case 15u: { c.lobeCount = 0u; }
    case 16u: { c.hasThinFilm = 1u; }
    case 17u: { c.hasCoat = 1u; }
    case 18u: { c.lobes[1].kind = MX_LOBE_DIELECTRIC_REFLECTION; }
    case 19u: { c.lobes[1].kind = MX_LOBE_DIELECTRIC_REFLECTION; c.lobes[1].anisotropy = 0.5; }
    case 20u: { c.lobes[1].kind = MX_LOBE_CONDUCTOR; c.lobes[1].roughness = 1.0; }
    case 21u: { c.lobes[1].kind = MX_LOBE_CONDUCTOR; c.lobes[1].anisotropy = 0.5; }
    case 22u: { c.lobes[1].kind = MX_LOBE_GENERALIZED_SCHLICK; }
    case 23u: { c.lobes[1].kind = MX_LOBE_CONDUCTOR; c.lobes[1].roughness = 0.01; }
    default: {}
  }
  let index = mx_forward_single_dielectric(c);
  var error = vec3f(0.0);
  var reference = vec3f(0.0);
  if (index >= 0) {
    reference = reference_environment(c, wo);
    let actual = mx_forward_dielectric_environment(c.lobes[u32(index)], wo, mat3x3f(1,0,0, 0,1,0, 0,0,1));
    error = actual - reference;
  }
  results[2u * id.x] = vec4f(f32(index), error);
  results[2u * id.x + 1u] = vec4f(reference, 0.0);
}`;
}

export async function runSingleDielectricProbe(device: GPUDevice, forwardCode: string): Promise<number[][]> {
  const count = 24;
  const size = count * 32;
  const pipeline = await device.createComputePipelineAsync({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code: singleDielectricProbe(forwardCode) }), entryPoint: 'probe' },
  });
  const output = device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readback = device.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  try {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: output } }] }));
    pass.dispatchWorkgroups(count);
    pass.end();
    encoder.copyBufferToBuffer(output, 0, readback, 0, size);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const values = new Float32Array(readback.getMappedRange().slice(0));
    readback.unmap();
    const rows = Array.from({ length: count }, (_, i) => Array.from(values.slice(i * 8, i * 8 + 8)));
    const rejected = new Set([8, 9, 10, 11, 12, 13, 15]);
    for (const [i, row] of rows.entries()) {
      const expectedIndex = rejected.has(i) ? -1 : 1;
      if (row[0] !== expectedIndex || row.some((v) => !Number.isFinite(v))
          || row.slice(1, 4).some((v) => Math.abs(v) > 2e-5)
          || (expectedIndex >= 0 && !row.slice(4, 7).some((v) => v > 0))) {
        throw new Error(`Single dielectric case ${i} failed selection or quadrature parity: ${JSON.stringify(row)}`);
      }
    }
    return rows;
  } finally {
    output.destroy();
    readback.destroy();
  }
}
