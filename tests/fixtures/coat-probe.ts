import { CLOSURE_LIBRARY_PRELUDE } from '../../src/compiler/closure-library.ts';
import { LAYERED_CLOSURE_PRELUDE } from '../../src/compiler/surface-wgsl.ts';

export async function runCoatProbe(device: GPUDevice, forwardCode: string): Promise<number[][]> {
  const start = forwardCode.indexOf('fn mx_forward_sample_diffuse(');
  const end = forwardCode.indexOf('fn mx_forward_specular_closure(', start);
  if (start < 0 || end < 0) throw new Error('Forward shader lacks coated diffuse integration');
  const code = `${LAYERED_CLOSURE_PRELUDE}
${CLOSURE_LIBRARY_PRELUDE}
struct ProbeFrame { envMap: vec4f, envInfo: vec4f };
var<private> fu: ProbeFrame;
fn mx_forward_environment(d: vec3f) -> vec3f { return vec3f(1.0); }
fn mx_forward_env_pdf(d: vec3f) -> f32 { return 0.0; }
fn mx_forward_env_direction(u: f32) -> vec3f { return vec3f(0.0, 0.0, 1.0); }
${forwardCode.slice(start, end)}
@group(0) @binding(0) var<storage, read_write> results: array<vec4f>;
@compute @workgroup_size(1)
fn probe(@builtin(global_invocation_id) id: vec3u) {
  var c: LayeredClosure;
  c.lobeCount = 1u;
  c.lobes[0].kind = MX_LOBE_BURLEY_DIFFUSE;
  c.lobes[0].weight = 1.0;
  c.lobes[0].color = vec3f(0.8);
  c.hasCoat = 1u;
  c.coat = MxCoatLayer(f32(id.x % 3u) * 0.5, vec3f(0.85, 0.2, 0.25), 0.05, 1.5);
  let z = select(1.0, 0.2, id.x >= 3u);
  let wo = vec3f(sqrt(1.0 - z*z), 0.0, z);
  let frame = mat3x3f(1,0,0, 0,1,0, 0,0,1);
  results[id.x] = vec4f(mx_forward_coated_diffuse(c, wo, frame), 0.0);
}`;
  const count = 6;
  const size = count * 16;
  const pipeline = await device.createComputePipelineAsync({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code }), entryPoint: 'probe' },
  });
  const output = device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readback = device.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  try {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: output } }],
    }));
    pass.dispatchWorkgroups(count);
    pass.end();
    encoder.copyBufferToBuffer(output, 0, readback, 0, size);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const values = new Float32Array(readback.getMappedRange().slice(0));
    readback.unmap();
    const rows = Array.from({ length: count }, (_, i) => Array.from(values.slice(i * 4, i * 4 + 3)));
    for (const [i, row] of rows.entries()) {
      const weight = (i % 3) * 0.5;
      const z = i >= 3 ? 0.2 : 1;
      const fo = 0.04 + 0.96 * (1 - z) ** 5;
      for (const [k, tint] of [0.85, 0.2, 0.25].entries()) {
        const expected = 0.8 * (1 - weight + weight * tint) * (1 - weight * fo)
          * (1 - weight * (0.04 + 0.96 / 21));
        if (!Number.isFinite(row[k]) || Math.abs(row[k]! - expected) > 2e-4) {
          throw new Error(`Coat furnace case ${i}, channel ${k}: ${row[k]} vs ${expected}`);
        }
      }
    }
    return rows;
  } finally {
    output.destroy();
    readback.destroy();
  }
}
