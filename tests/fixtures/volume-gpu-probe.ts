import { FLOAT, IrModuleBuilder, shaderType, vector } from '../../src/compiler/ir.ts';
import { bakeVolumeGrid, bakeVolumeGridGpu, volumeDomainsWgsl, volumeFieldWgsl, volumeMixtureWgsl, VOLUME_TRANSPORT_WGSL } from '../../src/render/volume-field.ts';
import { phaseHG } from '../../src/render/pathtracing/media.ts';
import { PT_MATERIAL_RECORD_FLOATS } from '../../src/render/pathtracing/material-record.ts';
import { bvhTraversalWgsl, BVH_NODE_STRIDE, BVH_TRI_STRIDE } from '../../src/render/pathtracing/bvh-wgsl.ts';
import { pathTraceClosureDispatch, pathTraceComputeWgsl, PT_UNIFORM_FLOATS } from '../../src/render/pathtracing/compute.ts';
import { buildMaterialDispatch } from '../../src/render/pathtracing/material-variant.ts';
import { rasterVolumeWgsl } from '../../src/render/raster/volume-pass.ts';

function probeVolumeTriangles(offsets: readonly number[]) {
  const vertices = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ];
  const faces = [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4], [3, 7, 6], [3, 6, 2],
    [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5],
  ];
  const triangles = new Float32Array(offsets.length * 12 * BVH_TRI_STRIDE);
  for (const [instance, offset] of offsets.entries()) {
    for (const [face, indices] of faces.entries()) {
      for (const [slot, index] of indices.entries()) {
        const vertex = vertices[index]!;
        triangles.set([vertex[0]! + offset, vertex[1]!, vertex[2]!], (instance * 12 + face) * BVH_TRI_STRIDE + slot * 3);
      }
    }
  }
  return triangles;
}

/**
 * Emissive box beside a scattering box, rendered by the full integrate() with and without
 * per-instance domain tracking: both transports must agree (camera rays through each box).
 */
export async function volumePathModesProbe(samples = 65536, depth = 8) {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const triangles = probeVolumeTriangles([-1.5, 1.5]);
  for (let triangle = 12; triangle < 24; triangle++) triangles[triangle * BVH_TRI_STRIDE + 18] = 1;
  const nodes = new Float32Array([-2.5, -1, -1, 0, 2.5, 1, 1, 0, 0, 24, 0, 0]);
  const order = Uint32Array.from({ length: 24 }, (_, i) => i);
  const materials = new Float32Array(2 * PT_MATERIAL_RECORD_FLOATS);
  const b = PT_MATERIAL_RECORD_FLOATS;
  materials[29] = 1; materials[37] = 1;
  materials.set([0.5, 0.5, 0.5], 30);
  materials.set([2, 1, 0.5], 38);
  materials.set([-2.5, -1, -1], 43);
  materials.set([0.5, 0.5, 0.5], 46);
  materials[50] = 1;
  materials[b + 29] = 1; materials[b + 37] = 1;
  materials.set([0.1, 0.1, 0.1], b + 30);
  materials.set([0.8, 0.8, 0.8], b + 33);
  materials[b + 36] = 0.3;
  const uniforms = new Float32Array(PT_UNIFORM_FLOATS);
  uniforms.set([depth, 4, 0, 0], 100);
  const closureDispatch = pathTraceClosureDispatch(buildMaterialDispatch([]), materials);
  const volumeDomains = [0, 1].map(i => ({ materialIndex: i, firstTriangle: i * 12, triangleCount: 12 }));
  const buffers: GPUBuffer[] = [];
  const upload = (data: Float32Array | Uint32Array, usage: GPUBufferUsageFlags) => {
    const buffer = device.createBuffer({ size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST });
    buffers.push(buffer);
    device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  };
  try {
    const inputs = [upload(uniforms, GPUBufferUsage.UNIFORM), upload(nodes, GPUBufferUsage.STORAGE),
      upload(triangles, GPUBufferUsage.STORAGE), upload(order, GPUBufferUsage.STORAGE), upload(materials, GPUBufferUsage.STORAGE)];
    const results: number[][] = [];
    for (const domains of [false, true]) {
      const bytes = samples * 2 * 16;
      const output = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const readback = device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      buffers.push(output, readback);
      const code = pathTraceComputeWgsl({ media: true, volumeEmission: true, maxLobes: 1, closureDispatch,
        pruneUnusedFunctions: true, ...(domains ? { volumeDomains } : {}) }) + `
@compute @workgroup_size(64) fn probe(@builtin(global_invocation_id) id: vec3u) {
  mx_begin_sample(id.x % ${samples}u, id.x);
  var state = pcg_hash(id.x + 777u);
  let origin = select(vec3f(1.5, 0.121, -3.0), vec3f(-1.5, 0.121, -3.0), id.x >= ${samples}u);
  accum[id.x] = vec4f(integrate(origin, vec3f(0, 0, 1), vec3f(0, 0, 1), &state), 1.0);
}`;
      const module = device.createShaderModule({ code });
      const errors = (await module.getCompilationInfo()).messages.filter(message => message.type === 'error');
      if (errors.length) throw new Error(errors.map(error => `${error.lineNum}:${error.linePos} ${error.message}`).join('\n'));
      const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'probe' } });
      const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries:
        [...inputs, output].map((buffer, binding) => ({ binding, resource: { buffer } })) });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(samples * 2 / 64);
      pass.end();
      encoder.copyBufferToBuffer(output, 0, readback, 0, bytes);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const data = new Float32Array(readback.getMappedRange());
      // Per ray family: RGB mean and the standard error of the red channel.
      for (let family = 0; family < 2; family++) {
        const mean = [0, 0, 0];
        let square = 0;
        for (let i = family * samples; i < (family + 1) * samples; i++) {
          for (let c = 0; c < 3; c++) mean[c]! += data[i * 4 + c]! / samples;
          square += data[i * 4]! ** 2 / samples;
        }
        results.push([...mean, Math.sqrt(Math.max(0, square - mean[0]! ** 2) / samples)]);
      }
      readback.unmap();
    }
    return { reference: results.slice(0, 2), domains: results.slice(2, 4) };
  } finally {
    for (const buffer of buffers) buffer.destroy();
    device.destroy();
  }
}

export async function volumeRasterRenderProbe() {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const triangles = probeVolumeTriangles([0, 0]);
  const nodes = new Float32Array([-1, -1, -1, 0, 1, 1, 1, 0, 0, 24, 0, 0]);
  const order = Uint32Array.from({ length: 24 }, (_, i) => i);
  const materials = new Float32Array(PT_MATERIAL_RECORD_FLOATS);
  materials[29] = 1;
  materials.set([0.3, 0.3, 0.3], 30);
  materials[37] = 1;
  materials.set([0.05, 0.05, 0.05], 38);
  const uniforms = new Float32Array(36);
  uniforms.set([0, 0, 5, 0], 8);
  uniforms.set([0.173, 0.121, -2, 1], 12);
  uniforms.set([1, 1, 64, 0], 32);
  const domains = [0, 1].map(i => ({ materialIndex: 0, firstTriangle: i * 12, triangleCount: 12 }));
  const buffers: GPUBuffer[] = [];
  const textures: GPUTexture[] = [];
  const upload = (data: Float32Array | Uint32Array, usage: GPUBufferUsageFlags) => {
    const buffer = device.createBuffer({ size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST });
    buffers.push(buffer);
    device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  };
  try {
    const nodeBuffer = upload(nodes, GPUBufferUsage.STORAGE);
    const triangleBuffer = upload(triangles, GPUBufferUsage.STORAGE);
    const orderBuffer = upload(order, GPUBufferUsage.STORAGE);
    const materialBuffer = upload(materials, GPUBufferUsage.STORAGE);
    const uniformBuffer = upload(uniforms, GPUBufferUsage.UNIFORM);
    const hdr = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    const target = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    textures.push(hdr, target);
    device.queue.writeTexture({ texture: hdr }, new Uint8Array([64, 64, 64, 255]), { bytesPerRow: 4 }, [1, 1]);
    const readback = device.createBuffer({ size: 288, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const shadowOutput = device.createBuffer({ size: 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    buffers.push(readback, shadowOutput);
    const code = rasterVolumeWgsl(false, false, domains) + `
@group(0) @binding(6) var<storage, read_write> shadowOutput: array<vec4f>;
@compute @workgroup_size(1) fn probeShadow(@builtin(global_invocation_id) id: vec3u) {
  let origin = select(vec3f(0.173, 0.121, -2.0), vec3f(0.173, 0.121, 0.0), id.x == 1u);
  var counts: array<u32, 2>;
  _ = mx_update_volume_domains(origin, &counts);
  for (var i = 0u; i < 2u; i++) { mx_march_volumes[i] = counts[i]; }
  shadowOutput[id.x] = vec4f(shadow_volume(origin, vec3f(0, 0, 1), 5.0, 0xffffffffu), 1.0);
}`;
    const module = device.createShaderModule({ code });
    const errors = (await module.getCompilationInfo()).messages.filter(message => message.type === 'error');
    if (errors.length) throw new Error(errors.map(error => `${error.lineNum}:${error.linePos} ${error.message}`).join('\n'));
    const pipeline = await device.createRenderPipelineAsync({
      layout: 'auto', vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
    });
    const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: hdr.createView() },
      ...[nodeBuffer, triangleBuffer, orderBuffer, materialBuffer, uniformBuffer]
        .map((buffer, i) => ({ binding: i + 1, resource: { buffer } })),
    ] });
    const shadowPipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'probeShadow' } });
    const shadowGroup = device.createBindGroup({ layout: shadowPipeline.getBindGroupLayout(0), entries: [
      ...[nodeBuffer, triangleBuffer, orderBuffer, materialBuffer]
        .map((buffer, i) => ({ binding: i + 1, resource: { buffer } })),
      { binding: 6, resource: { buffer: shadowOutput } },
    ] });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.draw(3);
    pass.end();
    const shadowPass = encoder.beginComputePass();
    shadowPass.setPipeline(shadowPipeline);
    shadowPass.setBindGroup(0, shadowGroup);
    shadowPass.dispatchWorkgroups(2);
    shadowPass.end();
    encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: 256 }, [1, 1]);
    encoder.copyBufferToBuffer(shadowOutput, 0, readback, 256, 32);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const mapped = readback.getMappedRange();
    const pixel = Array.from(new Uint8Array(mapped.slice(0, 4)));
    const shadowData = new Float32Array(mapped.slice(256, 288));
    const shadows = [shadowData[0]!, shadowData[4]!];
    readback.unmap();
    return { pixel, shadows };
  } finally {
    for (const texture of textures) texture.destroy();
    for (const buffer of buffers) buffer.destroy();
    device.destroy();
  }
}

export async function volumePathRenderProbe(differentMaterials = false) {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const samples = 8192;
  const triangles = probeVolumeTriangles([0, differentMaterials ? 1 : 0]);
  if (differentMaterials) {
    for (let triangle = 12; triangle < 24; triangle++) triangles[triangle * BVH_TRI_STRIDE + 18] = 1;
  }
  const nodes = new Float32Array([-1, -1, -1, 0, differentMaterials ? 2 : 1, 1, 1, 0, 0, 24, 0, 0]);
  const order = Uint32Array.from({ length: 24 }, (_, i) => i);
  const materials = new Float32Array((differentMaterials ? 2 : 1) * PT_MATERIAL_RECORD_FLOATS);
  materials[29] = 1;
  materials.set([0.3, 0.3, 0.3], 30);
  materials[37] = 1;
  if (differentMaterials) {
    materials[PT_MATERIAL_RECORD_FLOATS + 29] = 1;
    materials.set([0.8, 0.8, 0.8], PT_MATERIAL_RECORD_FLOATS + 30);
    materials[PT_MATERIAL_RECORD_FLOATS + 37] = 1;
  }
  const uniforms = new Float32Array(PT_UNIFORM_FLOATS);
  uniforms.set([1, 1, 1, 0], 28);
  uniforms.set([8, 4, 0, 0], 100);
  const volumeDomains = [0, 1].map(i => ({ materialIndex: differentMaterials ? i : 0, firstTriangle: i * 12, triangleCount: 12 }));
  const buffers: GPUBuffer[] = [];
  const upload = (data: Float32Array | Uint32Array, usage: GPUBufferUsageFlags) => {
    const buffer = device.createBuffer({ size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST });
    buffers.push(buffer);
    device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  };
  try {
    const uniformBuffer = upload(uniforms, GPUBufferUsage.UNIFORM);
    const nodeBuffer = upload(nodes, GPUBufferUsage.STORAGE);
    const triangleBuffer = upload(triangles, GPUBufferUsage.STORAGE);
    const orderBuffer = upload(order, GPUBufferUsage.STORAGE);
    const materialBuffer = upload(materials, GPUBufferUsage.STORAGE);
    const output = device.createBuffer({ size: samples * 3 * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const readback = device.createBuffer({ size: samples * 3 * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    buffers.push(output, readback);
    const closureDispatch = pathTraceClosureDispatch(buildMaterialDispatch([]), materials);
    const code = pathTraceComputeWgsl({ media: true, volumeDomains, maxLobes: 1, closureDispatch, pruneUnusedFunctions: true }) + `
@compute @workgroup_size(64) fn probe(@builtin(global_invocation_id) id: vec3u) {
  mx_begin_sample(id.x, id.x);
  var state = pcg_hash(id.x + 12345u);
  let direction = vec3f(0, 0, 1);
  let origin = select(vec3f(0.173, 0.121, -2.0), vec3f(-0.5, 0.121, 0.0), id.x >= ${samples}u);
  if (id.x < ${samples * 2}u) {
    accum[id.x] = vec4f(integrate(origin, direction, direction, &state), 1.0);
  } else {
    accum[id.x] = vec4f(mx_transmittance(vec3f(0.173, 0.121, -2.0), direction, 5.0, 0xffffffffu, &state), 1.0);
  }
}`;
    const module = device.createShaderModule({ code });
    const errors = (await module.getCompilationInfo()).messages.filter(message => message.type === 'error');
    if (errors.length) throw new Error(errors.map(error => `${error.lineNum}:${error.linePos} ${error.message}`).join('\n'));
    const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'probe' } });
    const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries:
      [uniformBuffer, nodeBuffer, triangleBuffer, orderBuffer, materialBuffer, output]
        .map((buffer, binding) => ({ binding, resource: { buffer } })) });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(samples * 3 / 64);
    pass.end();
    encoder.copyBufferToBuffer(output, 0, readback, 0, samples * 3 * 16);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(readback.getMappedRange());
    const result = [0, 0, 0];
    for (let i = 0; i < samples * 3; i++) result[Math.floor(i / samples)]! += data[i * 4]! / samples;
    readback.unmap();
    return result;
  } finally {
    for (const buffer of buffers) buffer.destroy();
    device.destroy();
  }
}

export async function volumePathEmitterProbe() {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const triangles = probeVolumeTriangles([0, 0]);
  const nodes = new Float32Array([-1, -1, -1, 0, 1, 1, 1, 0, 0, 24, 0, 0]);
  const order = Uint32Array.from({ length: 24 }, (_, i) => i);
  const materials = new Float32Array(PT_MATERIAL_RECORD_FLOATS);
  materials[29] = 1;
  materials[37] = 1;
  materials.set([1, 2, 3], 38);
  materials.set([-1, -1, -1], 43);
  materials.set([0.5, 0.5, 0.5], 46);
  materials[50] = 1;
  const domains = [0, 1].map(i => ({ materialIndex: 0, firstTriangle: i * 12, triangleCount: 12 }));
  const buffers: GPUBuffer[] = [];
  const upload = (data: Float32Array | Uint32Array) => {
    const buffer = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    buffers.push(buffer);
    device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  };
  try {
    const nodeBuffer = upload(nodes), triangleBuffer = upload(triangles), orderBuffer = upload(order), materialBuffer = upload(materials);
    const output = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const readback = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    buffers.push(output, readback);
    const code = pathTraceComputeWgsl({ media: true, volumeEmission: true, volumeDomains: domains, pruneUnusedFunctions: true }) + `
@compute @workgroup_size(1) fn probeEmitter() {
  mx_begin_sample(4u, 3u);
  var state = 123u;
  let light = mx_sample_volume_light(vec3f(0, 0, 3), &state);
  accum[0] = vec4f(light.emission, light.pdf);
}`;
    const module = device.createShaderModule({ code });
    const errors = (await module.getCompilationInfo()).messages.filter(message => message.type === 'error');
    if (errors.length) throw new Error(errors.map(error => `${error.lineNum}:${error.linePos} ${error.message}`).join('\n'));
    const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'probeEmitter' } });
    const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      ...[nodeBuffer, triangleBuffer, orderBuffer, materialBuffer, output]
        .map((buffer, i) => ({ binding: i + 1, resource: { buffer } })),
    ] });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(1);
    pass.end();
    encoder.copyBufferToBuffer(output, 0, readback, 0, 16);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const result = Array.from(new Float32Array(readback.getMappedRange().slice(0)));
    readback.unmap();
    return result;
  } finally {
    for (const buffer of buffers) buffer.destroy();
    device.destroy();
  }
}

export async function volumePathShaderProbe() {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  try {
    const volumeDomains = [
      { materialIndex: 0, firstTriangle: 0, triangleCount: 12 },
      { materialIndex: 0, firstTriangle: 12, triangleCount: 12 },
    ];
    const options = { media: true, volumeDomains, volumeEmission: true, volumeGrid: true,
      displayAovs: true, analyticLights: true, pruneUnusedFunctions: true };
    const sources = [pathTraceComputeWgsl(options), rasterVolumeWgsl(true, true, volumeDomains)];
    const errors: string[] = [];
    for (const [index, code] of sources.entries()) {
      const info = await device.createShaderModule({ code }).getCompilationInfo();
      errors.push(...info.messages.filter(message => message.type === 'error').map(message =>
        `${index}:${message.lineNum}:${message.linePos} ${message.message}`));
    }
    return errors;
  } finally {
    device.destroy();
  }
}

export async function volumeDomainGpuProbe() {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const triangles = probeVolumeTriangles([0, 1, 0]);
  const nodes = new Float32Array([-1, -1, -1, 0, 2, 1, 1, 0, 0, 36, 0, 0]);
  const order = Uint32Array.from({ length: 36 }, (_, i) => i);
  const domains = [0, 1, 2].map(i => ({ materialIndex: 0, firstTriangle: i * 12, triangleCount: 12 }));
  const points = [[-0.5, 0, 0], [0.5, 0, 0], [1.5, 0, 0], [3, 0, 0], [0.99995, 0.121, 0.173]];
  const buffers: GPUBuffer[] = [];
  const upload = (data: Float32Array | Uint32Array) => {
    const buffer = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    buffers.push(buffer);
    device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  };
  try {
    const nodeBuffer = upload(nodes), triangleBuffer = upload(triangles), orderBuffer = upload(order);
    const output = device.createBuffer({ size: points.length * domains.length * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const readback = device.createBuffer({ size: points.length * domains.length * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    buffers.push(output, readback);
    const code = `
@group(0) @binding(0) var<storage, read> nodes: array<f32>;
@group(0) @binding(1) var<storage, read> tris: array<f32>;
@group(0) @binding(2) var<storage, read> triOrder: array<u32>;
@group(0) @binding(3) var<storage, read_write> output: array<u32>;
const NODE_STRIDE = ${BVH_NODE_STRIDE}u;
const TRI_STRIDE = ${BVH_TRI_STRIDE}u;
const RAY_EPS = 1e-4;
${bvhTraversalWgsl(true)}
${volumeDomainsWgsl(domains)}
@compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id: vec3u) {
  let points = array<vec3f, 5>(${points.map(p => `vec3f(${p.join(',')})`).join(',')});
  var counts: array<u32, 3>;
  _ = mx_update_volume_domains(points[id.x], &counts);
  for (var i = 0u; i < 3u; i++) { output[id.x * 3u + i] = counts[i]; }
}`;
    const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'main' } });
    const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [nodeBuffer, triangleBuffer, orderBuffer, output]
      .map((buffer, binding) => ({ binding, resource: { buffer } })) });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(points.length);
    pass.end();
    encoder.copyBufferToBuffer(output, 0, readback, 0, points.length * domains.length * 4);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const result = Array.from(new Uint32Array(readback.getMappedRange().slice(0)));
    readback.unmap();
    return result;
  } finally {
    for (const buffer of buffers) buffer.destroy();
    device.destroy();
  }
}

export async function volumeMixtureGpuProbe(includeInterior = false) {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const samples = 32768;
  const materials = new Float32Array(2 * PT_MATERIAL_RECORD_FLOATS);
  const media = [
    { absorption: [0.2, 0.2, 0.2], scattering: [0.4, 0.1, 0], emission: [0.2, 0.1, 0.05], g: 0.7 },
    { absorption: [0.1, 0.1, 0.1], scattering: [0.1, 0.2, 0.4], emission: [0.1, 0.05, 0.15], g: -0.5 },
  ];
  const interior = { absorption: [0.1, 0.05, 0.1], scattering: [0.05, 0.3, 0.2], emission: [0, 0, 0], g: -0.25 };
  for (const [i, medium] of media.entries()) {
    const base = i * PT_MATERIAL_RECORD_FLOATS;
    materials.set(medium.absorption, base + 30);
    materials.set(medium.scattering, base + 33);
    materials[base + 36] = medium.g;
    materials.set(medium.emission, base + 38);
  }
  const materialBuffer = device.createBuffer({ size: materials.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const output = device.createBuffer({ size: samples * 7 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readback = device.createBuffer({ size: samples * 7 * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  try {
    device.queue.writeBuffer(materialBuffer, 0, materials);
    const code = `
@group(0) @binding(0) var<storage, read> materials: array<f32>;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;
struct MxMedium { sigmaA: vec3f, sigmaS: vec3f, g: f32 };
fn rng_next(state: ptr<function, u32>) -> f32 {
  *state = *state * 747796405u + 2891336453u;
  let word = ((*state >> ((*state >> 28u) + 4u)) ^ *state) * 277803737u;
  return f32(((word >> 22u) ^ word) >> 8u) / 16777216.0;
}
${volumeFieldWgsl(false)}
${VOLUME_TRANSPORT_WGSL}
const MX_VOLUME_DOMAIN_COUNT = 2u;
const mx_volume_domains: array<vec3u, 2> = array<vec3u, 2>(vec3u(0,0,1), vec3u(1,1,2));
${volumeMixtureWgsl(2)}
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
  var state = id.x + 12345u;
  var counts = array<u32, 2>(1u, 1u);
  let m = MxMedium(vec3f(0.1, 0.05, 0.1), vec3f(0.05, 0.3, 0.2), -0.25);
  let sample = volume_sample_mixture(&counts, ${includeInterior}, 0xffffffffu, m, vec3f(0.0), vec3f(0,0,1), 1.0, &state);
  let base = id.x * 7u;
  for (var c = 0u; c < 3u; c++) { output[base+c] = sample.weight[c]; output[base+3u+c] = sample.emission[c]; }
  output[base+6u] = select(0.0, select(select(2.0, 3.0, sample.g > -0.3), 1.0, sample.g > 0.0), sample.scattered);
}`;
    const pipeline = await device.createComputePipelineAsync({
      layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'main' },
    });
    const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: materialBuffer } }, { binding: 1, resource: { buffer: output } },
    ] });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(samples / 64);
    pass.end();
    encoder.copyBufferToBuffer(output, 0, readback, 0, samples * 7 * 4);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(readback.getMappedRange());
    const transmitted = [0, 0, 0], emitted = [0, 0, 0], scattered = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < samples; i++) {
      const event = data[i * 7 + 6]!;
      for (let c = 0; c < 3; c++) {
        emitted[c] = emitted[c]! + data[i * 7 + 3 + c]! / samples;
        if (event === 0) transmitted[c] = transmitted[c]! + data[i * 7 + c]! / samples;
        else scattered[event - 1]![c] = scattered[event - 1]![c]! + data[i * 7 + c]! / samples;
      }
    }
    readback.unmap();
    return { transmitted, emitted, scattered, media: includeInterior ? [...media, interior] : media };
  } finally {
    materialBuffer.destroy();
    output.destroy();
    readback.destroy();
    device.destroy();
  }
}

export async function volumeGpuProbe() {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  try {
    const b = new IrModuleBuilder();
    const position = b.add({ kind: 'input', name: 'position', type: vector(3) });
    const noise = b.add({ kind: 'call', type: FLOAT, op: 'noise3d', args: [], namedArgs: {
      position, amplitude: b.constant(FLOAT, 0.25), pivot: b.constant(FLOAT, 1),
    } });
    const density = b.add({ kind: 'convert', source: noise, from: FLOAT, type: vector(3) });
    const ref = b.add({ kind: 'closure', type: shaderType('volume'), closure: 'vdf', op: 'anisotropic_vdf', params: {
      absorption: density, scattering: b.constant(vector(3), [0.1, 0.2, 0.3]),
      anisotropy: b.constant(FLOAT, 0.3), emission: density,
    } });
    b.output({ name: 'volumeshader', type: shaderType('volume'), ref });
    const ir = b.build();
    const bounds = { min: [0, 0, 0] as [number, number, number], max: [1, 2, 3] as [number, number, number] };
    const cpu = bakeVolumeGrid(ir, bounds, 8);
    const gpu = await bakeVolumeGridGpu(device, ir, bounds, [], 8);
    if (!gpu) throw new Error('Procedural volume GPU baking was unavailable.');
    let maximumError = 0;
    for (let i = 0; i < cpu.data.length; i++) maximumError = Math.max(maximumError, Math.abs(cpu.data[i]! - gpu.data[i]!));
    let cdfError = 0;
    for (let i = 0; i < cpu.emissionCdf!.length; i++) {
      cdfError = Math.max(cdfError, Math.abs(cpu.emissionCdf![i]! - gpu.emissionCdf![i]!));
    }

    const code = `
@group(0) @binding(0) var<storage, read> materials: array<f32>;
${volumeFieldWgsl(false)}
@group(0) @binding(1) var<storage, read_write> result: array<f32>;
@compute @workgroup_size(1) fn main() {
  result[0] = volume_phase(-1.0, 0.995);
  result[1] = volume_phase(1.0, -0.995);
  result[2] = volume_phase(0.3, 0.8);
}`;
    const buffer = device.createBuffer({ size: 12, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const readback = device.createBuffer({ size: 12, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    try {
      const pipeline = await device.createComputePipelineAsync({
        layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'main' },
      });
      const group = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 1, resource: { buffer } }],
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(1);
      pass.end();
      encoder.copyBufferToBuffer(buffer, 0, readback, 0, 12);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const phases = Array.from(new Float32Array(readback.getMappedRange().slice(0)));
      readback.unmap();
      return {
        maximumError, cdfError, emissionError: Math.abs(cpu.emissionWeight - gpu.emissionWeight),
        phases, referencePhases: [phaseHG(-1, 0.995), phaseHG(1, -0.995), phaseHG(0.3, 0.8)],
      };
    } finally {
      buffer.destroy();
      readback.destroy();
    }
  } finally {
    device.destroy();
  }
}
