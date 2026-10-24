import { CLOSURE_LIBRARY_PRELUDE } from '../../src/compiler/closure-library.ts';
import { LAYERED_CLOSURE_PRELUDE } from '../../src/compiler/surface-wgsl.ts';

export async function runDispersionProbe(device: GPUDevice): Promise<number[][]> {
  const count = 15;
  const size = count * 32;
  const code = `${LAYERED_CLOSURE_PRELUDE}
${CLOSURE_LIBRARY_PRELUDE}
@group(0) @binding(0) var<storage, read_write> results: array<vec4f>;
@compute @workgroup_size(1)
fn probe(@builtin(global_invocation_id) id: vec3u) {
  var c: LayeredClosure;
  c.lobeCount = 1u;
  c.lobes[0].kind = MX_LOBE_DIELECTRIC_TRANSMISSION;
  c.lobes[0].weight = 1.0;
  c.lobes[0].roughness = 0.02;
  c.lobes[0].ior = 1.52;
  c.lobes[0].color = vec3f(1.0);
  c.lobes[0].dispersion = 0.35;
  var wo = vec3f(0.6, 0.0, 0.8);
  let group = id.x / 3u;
  if (group == 1u) { wo.z = -wo.z; }
  if (group == 2u) { c.lobes[0].dispersion = 0.0; }
  if (group == 3u) { c.lobes[0].thin = 1.0; }
  if (group == 4u) { wo = vec3f(0.8, 0.0, -0.6); }
  let spectral = mx_closure_spectral_channel(c, id.x % 3u);
  let bs = mx_closure_sample(spectral, wo, vec3f(0.0, 0.0, 0.99));
  results[id.x * 2u] = vec4f(spectral.lobes[0].ior, bs.wi);
  results[id.x * 2u + 1u] = vec4f(select(0.0, 1.0, bs.valid),
    select(0.0, 1.0, mx_closure_has_dispersion(c)), bs.pdf, 0.0);
}`;
  const pipeline = await device.createComputePipelineAsync({
    layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'probe' },
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
    for (const [i, row] of rows.entries()) {
      const group = Math.floor(i / 3);
      const split = group !== 2 && group !== 3;
      // Independent Snell-law oracle, including the dense-side TIR branch.
      const ior = 1.52 + (split ? (i % 3 - 1) * 0.00455 : 0);
      const x = group === 4 ? -0.8 : group === 3 ? -0.6 : -0.6 * (group === 1 ? ior : 1 / ior);
      const z = group === 4 ? -0.6 : (group === 1 ? 1 : -1) * Math.sqrt(1 - x * x);
      const expected = [ior, x, 0, z, 1, Number(split)];
      if (row.some((v) => !Number.isFinite(v)) || row[6]! <= 0
          || expected.some((v, k) => Math.abs(v - row[k]!) > 2e-5)) {
        throw new Error(`Dispersion case ${i} failed Snell/TIR oracle: ${JSON.stringify(row)}, expected ${JSON.stringify(expected)}`);
      }
    }
    return rows;
  } finally {
    output.destroy();
    readback.destroy();
  }
}
