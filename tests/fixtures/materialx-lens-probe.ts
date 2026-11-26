import { pathTraceComputeWgsl } from '../../src/render/pathtracing/compute.ts';

export async function materialxLensProbe(): Promise<number[][] | null> {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const source = pathTraceComputeWgsl({ displayAovs: true, environment: true });
  const fullInfo = await device.createShaderModule({ code: source }).getCompilationInfo();
  const fullErrors = fullInfo.messages.filter(message => message.type === 'error');
  if (fullErrors.length) throw new Error(fullErrors.map(message => message.message).join('\n'));
  const start = source.indexOf('struct MxCameraRay {');
  const end = source.indexOf('\n}\n', source.indexOf('fn camera_ray(', start)) + 3;
  if (start < 0 || end < 3) throw new Error('Camera ray function not found.');
  const code = `
struct Uniforms {
  invViewProj: mat4x4f, eye: vec4f, lightDir: vec4f, lightColor: vec4f,
  env: vec4f, frame: vec4f, envExtra: vec4f, sh: array<vec4f, 9>,
  tile: vec4f, envTexture: vec4f, backgroundInvViewProj: mat4x4f,
  transport: vec4f, lens: vec4f, lensExtra: vec4f,
};
@group(0) @binding(0) var<uniform> U: Uniforms;
@group(0) @binding(1) var<storage, read_write> result: array<vec4f>;
const PI: f32 = 3.14159265358979;
${source.slice(start, end)}
@compute @workgroup_size(1) fn main() {
  let ray = camera_ray(U.frame.xy, U.frame.zw, U.tile.xy, U.tile.zw);
  result[0] = vec4f(ray.origin, select(0.0, 1.0, ray.valid));
  result[1] = vec4f(ray.direction, 0.0);
}`;
  const module = device.createShaderModule({ code });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter(message => message.type === 'error');
  if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
  const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
  const uniform = device.createBuffer({ size: 448, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const output = device.createBuffer({ size: 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readback = device.createBuffer({ size: 32, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: { buffer: output } },
  ] });
  const results: number[][] = [];
  for (const [projection, x, y, aperture, blades, sampleX, sampleY, perspective] of [
    [0, 50, 50, 0, 0, 0, 0], [1, 50, 50, 0, 0, 0, 0],
    [1, 100, 50, 0, 0, 0, 0], [1, 100, 0, 0, 0, 0, 0],
    [2, 75, 50, 0, 0, 0, 0], [2, 50, 0, 0, 0, 0, 0],
    [0, 50, 50, 0.5, 0, 0, 1], [0, 50, 50, 0.5, 4, 0.125, 1],
    [0, 75, 50, 0.5, 0, 0, 1, 1],
  ]) {
    const data = new Float32Array(112);
    data.set(perspective
      ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 1]
      : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 0);
    data.set([0, 0, perspective ? 0 : -1, 0], 16);
    data.set([x!, y!, 100, 100], 32);
    data.set([0, 0, sampleX!, sampleY!], 76);
    data[103] = 1;
    data.set([projection!, aperture!, 5, blades!], 104);
    device.queue.writeBuffer(uniform, 0, data);
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(1); pass.end();
    encoder.copyBufferToBuffer(output, 0, readback, 0, 32);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    results.push(Array.from(new Float32Array(readback.getMappedRange().slice(0))));
    readback.unmap();
  }
  uniform.destroy(); output.destroy(); readback.destroy(); device.destroy();
  return results;
}
