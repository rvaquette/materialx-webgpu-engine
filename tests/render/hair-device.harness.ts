import { LAYERED_CLOSURE_PRELUDE } from '../../src/compiler/surface-wgsl.ts';
import { CLOSURE_LIBRARY_PRELUDE } from '../../src/compiler/closure-library.ts';
import { hairEval, hairSample, type HairParameters } from '../../src/render/bsdf/hair.ts';

export async function validateHairOnDevice(device: GPUDevice): Promise<{ cases: number; maxRelativeError: number }> {
  const cases: { params: HairParameters; wo: [number, number, number]; wi: [number, number, number]; u: [number, number, number] }[] = [];
  for (const roughness of [0.1, 0.35, 0.8]) {
    for (const absorption of [[0, 0, 0], [0.2, 0.5, 1]] as const) {
      for (const z of [-1, 1]) {
        for (const wo of [[0.2, 0.3, Math.sqrt(0.87)], [0.95, -0.2, Math.sqrt(0.0575)]] as const) {
          for (const pathRandom of [0.00001, 0.237, 0.99999]) {
            cases.push({
              params: {
                absorption, tintR: [0.8, 0.9, 1], tintTT: [0.9, 1, 0.7], tintTRT: [1, 0.8, 0.6],
                longitudinalRoughness: roughness, azimuthalRoughness: roughness,
                ior: 1.55, cuticleAngle: 0.5,
              },
              wo: [...wo], wi: [-0.3, 0.1, z * Math.sqrt(0.9)],
              u: [pathRandom, 0.719, 0.483],
            });
          }
        }
      }
    }
  }
  const inputs = new Float32Array(cases.length * 28);
  cases.forEach(({ params: p, wo, wi, u }, i) => inputs.set([
    ...p.absorption, p.longitudinalRoughness, ...p.tintR, p.azimuthalRoughness,
    ...p.tintTT, p.cuticleAngle, ...p.tintTRT, p.ior, ...wo, 0, ...wi, 0, ...u, 0,
  ], i * 28));
  const module = device.createShaderModule({ code: `${LAYERED_CLOSURE_PRELUDE}
${CLOSURE_LIBRARY_PRELUDE}
@group(0) @binding(0) var<storage, read> data: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> results: array<vec4f>;
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let base = id.x * 7u;
  var lobe: MxBsdfLobe;
  lobe.extinction = data[base].xyz;
  lobe.roughness = data[base].w;
  lobe.color = data[base + 1u].xyz;
  lobe.anisotropy = data[base + 1u].w;
  lobe.color90 = data[base + 2u].xyz;
  lobe.rotation = data[base + 2u].w;
  lobe.hairTintTRT = data[base + 3u].xyz;
  lobe.ior = data[base + 3u].w;
  let wo = data[base + 4u].xyz;
  let wi = data[base + 5u].xyz;
  let ev = mx_hair_eval(lobe, wo, wi);
  let sample = mx_hair_sample(lobe, wo, data[base + 6u].xyz);
  results[id.x * 3u] = vec4f(ev.value, ev.pdf);
  results[id.x * 3u + 1u] = vec4f(sample.wi, select(0.0, 1.0, sample.valid));
  results[id.x * 3u + 2u] = vec4f(sample.value, sample.pdf);
}` });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter(message => message.type === 'error');
  if (errors.length) throw new Error(`Hair WGSL: ${errors.map(message => message.message).join('; ')}`);
  const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
  const input = device.createBuffer({ size: inputs.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const size = cases.length * 48;
  const output = device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readback = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  try {
    device.queue.writeBuffer(input, 0, inputs);
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: input } }, { binding: 1, resource: { buffer: output } }],
    }));
    pass.dispatchWorkgroups(cases.length);
    pass.end();
    encoder.copyBufferToBuffer(output, 0, readback, 0, size);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const values = new Float32Array(readback.getMappedRange().slice(0));
    readback.unmap();
    let maxRelativeError = 0;
    cases.forEach(({ params, wo, wi, u }, i) => {
      const ev = hairEval(params, wo, wi);
      const sample = hairSample(params, wo, u);
      const expected = [...ev.value, ev.pdf, ...sample.wi, sample.valid ? 1 : 0, ...sample.value, sample.pdf];
      expected.forEach((value, j) => {
        const actual = values[i * 12 + j]!;
        const relative = Math.abs(actual - value) / Math.max(1e-4, Math.abs(value));
        maxRelativeError = Math.max(maxRelativeError, relative);
        if (!Number.isFinite(actual) || relative > 0.025 && Math.abs(actual - value) > 2e-5) {
          throw new Error(`Hair CPU/GPU mismatch case ${i}, component ${j}: GPU=${actual}, CPU=${value}`);
        }
      });
    });
    return { cases: cases.length, maxRelativeError };
  } finally {
    input.destroy();
    output.destroy();
    readback.destroy();
  }
}
