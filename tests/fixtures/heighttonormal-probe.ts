import { FLOAT, vector, IrModuleBuilder } from '../../src/compiler/ir.ts';
import { lowerExprs } from '../../src/compiler/wgsl.ts';

const VECTOR2 = vector(2);
const VECTOR3 = vector(3);

export async function runHeightToNormalProbe(device: GPUDevice): Promise<number[][]> {
  const preludes = new Set<string>();
  const functions: string[] = [];
  const expected: number[][] = [];
  const cases = [
    { slope: [0, 0], scale: 2, uvScale: 1 },
    { slope: [1, 2], scale: 0, uvScale: 1 },
    { slope: [1, 2], scale: 1, uvScale: 1 },
    { slope: [-2, 1], scale: 2, uvScale: 1 },
    { slope: [1, 2], scale: 2, uvScale: -2 },
    { slope: [1, 2], scale: 2, uvScale: 0 },
    { slope: [32 / 255, 64 / 255], scale: 2, uvScale: 1, image: true },
  ];
  for (const [i, test] of cases.entries()) {
    const builder = new IrModuleBuilder();
    const uv = builder.add({ kind: 'input', type: VECTOR2, name: 'texcoord' });
    const q = builder.add({
      kind: 'call', op: 'multiply', type: VECTOR2, args: [],
      namedArgs: { in1: uv, in2: builder.constant(FLOAT, test.uvScale) },
    });
    const x = builder.add({ kind: 'swizzle', type: FLOAT, source: q, pattern: 'x' });
    const y = builder.add({ kind: 'swizzle', type: FLOAT, source: q, pattern: 'y' });
    const terms = [x, y].map((ref, k) => builder.add({
      kind: 'call', op: 'multiply', type: FLOAT, args: [],
      namedArgs: { in1: ref, in2: builder.constant(FLOAT, test.slope[k]!) },
    }));
    let height = builder.add({ kind: 'call', op: 'add', type: FLOAT, args: [], namedArgs: { in1: terms[0]!, in2: terms[1]! } });
    if ('image' in test) {
      builder.declareTexture({ name: 'height', valueType: FLOAT });
      builder.declareSampler({ name: 'height' });
      height = builder.add({ kind: 'texture', type: FLOAT, texture: 'height', sampler: 'height', uv: q });
    }
    const normal = builder.add({
      kind: 'call', op: 'heighttonormal', type: VECTOR3, args: [],
      namedArgs: { in: height, scale: builder.constant(FLOAT, test.scale), texcoord: q },
    });
    builder.output({ name: 'normal', type: VECTOR3, ref: normal });
    const lowered = lowerExprs(builder.build(), '', true);
    for (const prelude of lowered.preludes) preludes.add(prelude);
    functions.push(`fn case_${i}() -> vec3f {
  var vary: ProbeVaryings;
  vary.texcoord = vec2f(0.375, 0.625);
${lowered.body.join('\n')}
  return ${normal};
}`);
    const n = test.uvScale === 0 ? [0, 0, 1]
      : [-test.slope[0]! * test.scale / 16, -test.slope[1]! * test.scale / 16, 1];
    const length = Math.hypot(...n);
    expected.push(n.map((v) => v / length * 0.5 + 0.5));
  }
  const size = cases.length * 16;
  const code = `${[...preludes].join('\n')}
struct ProbeVaryings { texcoord: vec2f };
@group(1) @binding(0) var tex_height: texture_2d<f32>;
@group(2) @binding(0) var samp_height: sampler;
${functions.join('\n')}
@group(0) @binding(0) var<storage, read_write> results: array<vec4f>;
@compute @workgroup_size(1)
fn probe() {
${cases.map((_, i) => `  results[${i}] = vec4f(case_${i}(), 0.0);`).join('\n')}
}`;
  const pipeline = await device.createComputePipelineAsync({
    layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'probe' },
  });
  const output = device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readback = device.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const texture = device.createTexture({
    size: [8, 8], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  try {
    const pixels = new Uint8Array(8 * 8 * 4);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      pixels[(y * 8 + x) * 4] = 4 * x + 8 * y + 6;
      pixels[(y * 8 + x) * 4 + 3] = 255;
    }
    device.queue.writeTexture({ texture }, pixels, { bytesPerRow: 32 }, [8, 8]);
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: output } }],
    }));
    pass.setBindGroup(1, device.createBindGroup({
      layout: pipeline.getBindGroupLayout(1), entries: [{ binding: 0, resource: texture.createView() }],
    }));
    pass.setBindGroup(2, device.createBindGroup({
      layout: pipeline.getBindGroupLayout(2),
      entries: [{ binding: 0, resource: device.createSampler({ magFilter: 'linear', minFilter: 'linear' }) }],
    }));
    pass.dispatchWorkgroups(1);
    pass.end();
    encoder.copyBufferToBuffer(output, 0, readback, 0, size);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const values = new Float32Array(readback.getMappedRange().slice(0));
    readback.unmap();
    return expected.map((normal, i) => normal.map((value, k) => {
      const actual = values[i * 4 + k]!;
      if (!Number.isFinite(actual) || Math.abs(actual - value) > 2e-5) {
        throw new Error(`Height normal case ${i}, channel ${k}: ${actual} vs ${value}`);
      }
      return actual;
    }));
  } finally {
    output.destroy();
    readback.destroy();
    texture.destroy();
  }
}
