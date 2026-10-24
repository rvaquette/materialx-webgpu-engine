import { CLOSURE_LIBRARY_PRELUDE } from '../../src/compiler/closure-library.ts';
import { LAYERED_CLOSURE_PRELUDE } from '../../src/compiler/surface-wgsl.ts';

export function smoothSheetProbe(forwardCode: string): string {
  const start = forwardCode.indexOf('fn mx_forward_is_smooth_sheet(');
  const end = forwardCode.indexOf('fn mx_forward_single_dielectric(', start);
  if (start < 0 || end < 0) { throw new Error('Forward shader lacks smooth-sheet helpers'); }
  return `${LAYERED_CLOSURE_PRELUDE}
${CLOSURE_LIBRARY_PRELUDE}
fn mx_forward_environment(d: vec3f) -> vec3f { return vec3f(1.0) + 0.25 * d; }
${forwardCode.slice(start, end)}
@group(0) @binding(0) var<storage, read_write> results: array<vec4f>;
@compute @workgroup_size(1)
fn probe(@builtin(global_invocation_id) id: vec3u) {
  var c: LayeredClosure;
  c.lobeCount = 2u;
  c.lobes[0].kind = MX_LOBE_DIELECTRIC_REFLECTION;
  c.lobes[0].weight = 1.0;
  c.lobes[0].ior = 1.0;
  c.lobes[1] = c.lobes[0];
  c.lobes[1].kind = MX_LOBE_DIELECTRIC_TRANSMISSION;
  c.lobes[1].thin = 1.0;
  c.lobes[1].color = vec3f(1.0);
  var wo = vec3f(0.0, 0.0, 1.0);
  switch id.x {
    case 1u: { c.lobes[1].roughness = 0.01; }
    case 2u: { c.lobes[1].anisotropy = 0.1; }
    case 3u: { c.lobes[1].thin = 0.0; }
    case 4u: { c.hasCoat = 1u; c.coat.weight = 1.0; }
    case 5u: { c.lobes[0].kind = MX_LOBE_CONDUCTOR; }
    case 6u: { c.lobeCount = 0u; }
    case 7u: { c.lobeCount = 1u; }
    case 8u: {
      c.lobeCount = 3u;
      c.lobes[2].kind = MX_LOBE_CONDUCTOR;
      c.lobes[2].roughness = 0.5;
    }
    case 9u: { wo.z = -1.0; }
    case 10u: { c.lobes[0].ior = 1.5; c.lobes[1].ior = 1.5; }
    case 11u: {
      c.hasThinFilm = 1u;
      c.thinFilm = MxThinFilmLayer(1.0, 500.0, 1.4);
    }
    default: {}
  }
  let selected = mx_forward_is_smooth_sheet(c);
  var rgb = vec3f(0.0);
  if (selected) {
    rgb = mx_forward_smooth_sheet(c, wo, mat3x3f(1,0,0, 0,1,0, 0,0,1));
  }
  results[id.x] = vec4f(select(0.0, 1.0, selected), rgb);
}`;
}

export async function runSmoothSheetProbe(device: GPUDevice, forwardCode: string): Promise<number[][]> {
  const count = 12;
  const size = count * 16;
  const pipeline = await device.createComputePipelineAsync({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code: smoothSheetProbe(forwardCode) }), entryPoint: 'probe' },
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
    const rows = Array.from({ length: count }, (_, i) => Array.from(values.slice(i * 4, i * 4 + 4)));
    const r = (1 - 1.4) / (1 + 1.4);
    const film = [612, 549, 465].map((lambda) => {
      const phase = 4 * Math.PI * 1.4 * 500 / lambda;
      return 2 * r * r * (1 - Math.cos(phase)) / (1 + r ** 4 - 2 * r * r * Math.cos(phase));
    });
    const expected: number[][] = [
      [1, 1, 1, 0.75],
      ...Array.from({ length: 7 }, () => [0, 0, 0, 0]),
      [1, 1, 1, 0.75],
      [1, 1, 1, 1.25],
      [1, 1, 1, 0.77],
      [1, 1 + film[0]!, 1 + film[1]!, 0.75 + 1.25 * film[2]!],
    ];
    for (const [i, row] of rows.entries()) {
      if (row.some((v, j) => !Number.isFinite(v) || Math.abs(v - expected[i]![j]!) > 1e-5)) {
        throw new Error(`Smooth sheet case ${i}: ${JSON.stringify(row)} != ${JSON.stringify(expected[i])}`);
      }
    }
    return rows;
  } finally {
    output.destroy();
    readback.destroy();
  }
}
