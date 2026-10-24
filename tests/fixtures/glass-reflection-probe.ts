import { CLOSURE_LIBRARY_PRELUDE } from '../../src/compiler/closure-library.ts';
import { LAYERED_CLOSURE_PRELUDE } from '../../src/compiler/surface-wgsl.ts';

export function glassReflectionProbe(prelude = CLOSURE_LIBRARY_PRELUDE): string {
  return `${LAYERED_CLOSURE_PRELUDE}
${prelude}
@group(0) @binding(0) var<storage, read_write> results: array<vec4f>;
@compute @workgroup_size(1)
fn probe(@builtin(global_invocation_id) id: vec3u) {
  let inside = id.x != 0u;
  let tir = id.x == 2u;
  let wo = select(vec3f(0.0, 0.0, 1.0), select(vec3f(0.0, 0.0, -1.0), vec3f(0.8, 0.0, -0.6), tir), inside);
  let ctx = MxLobeCtx(wo, vec3f(1.0), 0.01, 1.52, 0.0, 0.0, 0.0);
  let s = mx_dielectric_transmission_sample(ctx, vec3f(0.0));
  let throughput = s.value.x * abs(s.wi.z) / max(s.pdf, 1e-20);
  results[id.x] = vec4f(select(0.0, 1.0, s.valid), throughput, s.wi.z, s.pdf);
}`;
}

export async function runGlassReflectionProbe(device: GPUDevice, prelude?: string): Promise<number[][]> {
  const pipeline = await device.createComputePipelineAsync({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code: glassReflectionProbe(prelude) }), entryPoint: 'probe' },
  });
  const output = device.createBuffer({ size: 48, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readback = device.createBuffer({ size: 48, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  try {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: output } }] }));
    pass.dispatchWorkgroups(3);
    pass.end();
    encoder.copyBufferToBuffer(output, 0, readback, 0, 48);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const values = new Float32Array(readback.getMappedRange().slice(0));
    readback.unmap();
    const rows = [0, 1, 2].map((i) => Array.from(values.slice(i * 4, i * 4 + 4)));
    for (const [i, row] of rows.entries()) {
      if (row[0] !== 1 || !Number.isFinite(row[1]) || Math.abs(row[1]! - 1) > 1e-4 || !(row[3]! > 0)) {
        throw new Error(`Glass reflection case ${i} lost energy or terminated: ${JSON.stringify(row)}`);
      }
    }
    return rows;
  } finally {
    output.destroy();
    readback.destroy();
  }
}
