import { COLOR4, IrModuleBuilder, vector } from '../../src/compiler/ir.ts';
import { emitWgsl } from '../../src/compiler/wgsl.ts';
import { decodeUdimImage } from '../../src/assets/udim.ts';
import { uploadMaterialImage } from '../../src/gpu/material-texture.ts';
import { sceneDeviceDescriptor } from '../../src/gpu/device.ts';

/** Read back generated UDIM sampling in fragment and compute pipelines. */
export async function runUdimDeviceCheck(): Promise<{ raster: string; compute: string; samples: number }> {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter for UDIM validation.');
  const device = await adapter.requestDevice(sceneDeviceDescriptor(adapter));
  const resources: { destroy(): void }[] = [];
  const own = <T extends { destroy(): void }>(resource: T): T => { resources.push(resource); return resource; };
  const uvs = [[0.5, 0.5], [1.5, 0.5], [1.5, 1.25], [1.5, 1.75], [2.5, 0.5], [-0.5, 0.5], [2.5, 1.5]];
  const expected = [
    [1, 0, 0, 1], [0, 1, 0, 1], [0, 0, 1, 1], [1, 1, 1, 1],
    [0.2, 0.3, 0.4, 1], [0.2, 0.3, 0.4, 1],
    [0.2158605, 0.2158605, 0.2158605, 1],
  ];
  try {
    const colors: Record<string, number[]> = {
      'c.1001.png': [255, 0, 0, 255, 255, 0, 0, 255],
      'c.1002.png': [0, 255, 0, 255, 0, 255, 0, 255],
      'c.1012.png': [255, 255, 255, 255, 0, 0, 255, 255],
      'c.1013.png': [128, 128, 128, 255, 128, 128, 128, 255],
    };
    const image = await decodeUdimImage('c.<UDIM>.png', [1001, 1002, 1012, 1013], async file => {
      const data = colors[file];
      if (!data) throw new Error(`Unknown fixture tile: ${file}`);
      return {
        kind: 'pixels', componentType: 'uint8', channels: 4, width: 1, height: 2,
        data: new Uint8Array(data), colorSpace: 'srgb_texture',
      };
    });
    const builder = new IrModuleBuilder();
    builder.declareTexture({ name: 'image', valueType: COLOR4, fileRef: 'c.<UDIM>.png', colorSpace: 'srgb_texture' });
    builder.declareSampler({ name: 'image', addressU: 'clamp', addressV: 'clamp', filter: 'closest' });
    const uv = builder.add({ kind: 'input', name: 'texcoord', type: vector(2, 'float', 'texcoord') });
    const fallback = builder.constant(COLOR4, [0.2, 0.3, 0.4, 1]);
    const ref = builder.add({ kind: 'texture', type: COLOR4, texture: 'image', sampler: 'image', uv, fallback });
    builder.output({ name: 'color', type: COLOR4, ref });
    const module = emitWgsl(builder.build());
    const coordinates = `const UVS = array<vec2f, ${uvs.length}>(${uvs.map(uv => `vec2f(${uv.join(', ')})`).join(', ')});`;
    const code = `${module.code}
${coordinates}
@group(0) @binding(0) var<storage, read_write> output: array<vec4f>;
@compute @workgroup_size(1) fn cs(@builtin(global_invocation_id) id: vec3u) {
  var vary: MxVaryings; vary.texcoord = UVS[id.x]; output[id.x] = mx_shade(vary).color;
}
@vertex fn vs(@builtin(vertex_index) id: u32) -> @builtin(position) vec4f {
  let points = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(points[id], 0.0, 1.0);
}
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f {
  var vary: MxVaryings; vary.texcoord = UVS[u32(p.x)]; return mx_shade(vary).color;
}`;
    const shader = device.createShaderModule({ code });
    const info = await shader.getCompilationInfo();
    const errors = info.messages.filter(message => message.type === 'error');
    if (errors.length) throw new Error(errors.map(error => error.message).join('\n'));
    const color = own(uploadMaterialImage(device, image, 'rgba8unorm-srgb', 'udim'));
    const index = own(uploadMaterialImage(device, image, 'r32uint', 'udim-index'));
    const sampler = device.createSampler({ addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', magFilter: 'nearest', minFilter: 'nearest' });
    const groups = (pipeline: GPUComputePipeline | GPURenderPipeline): GPUBindGroup[] => [
      device.createBindGroup({ layout: pipeline.getBindGroupLayout(1), entries: [
        { binding: 0, resource: color.createView({ dimension: '2d-array' }) },
        { binding: 1, resource: index.createView() },
      ] }),
      device.createBindGroup({ layout: pipeline.getBindGroupLayout(2), entries: [{ binding: 0, resource: sampler }] }),
    ];
    const verify = async (readback: GPUBuffer, backend: string): Promise<void> => {
      await readback.mapAsync(GPUMapMode.READ);
      const pixels = new Float32Array(readback.getMappedRange().slice(0));
      readback.unmap();
      expected.forEach((color, sample) => color.forEach((value, channel) => {
        const actual = pixels[sample * 4 + channel]!;
        // GPU sRGB lookup precision is implementation-dependent.
        const tolerance = sample === 6 ? 1e-3 : 1e-5;
        if (!Number.isFinite(actual) || Math.abs(actual - value) > tolerance) {
          throw new Error(`${backend}: sample ${sample}, channel ${channel}: expected ${value}, got ${actual}`);
        }
      }));
    };
    const bytes = uvs.length * 16;
    const output = own(device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }));
    const computeReadback = own(device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }));
    const compute = await device.createComputePipelineAsync({ layout: 'auto', compute: { module: shader, entryPoint: 'cs' } });
    const computeGroups = groups(compute);
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(compute);
    pass.setBindGroup(0, device.createBindGroup({ layout: compute.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: output } }] }));
    pass.setBindGroup(1, computeGroups[0]!);
    pass.setBindGroup(2, computeGroups[1]!);
    pass.dispatchWorkgroups(uvs.length);
    pass.end();
    encoder.copyBufferToBuffer(output, 0, computeReadback, 0, bytes);
    device.queue.submit([encoder.finish()]);
    await verify(computeReadback, 'compute');
    const raster = await device.createRenderPipelineAsync({
      layout: 'auto', vertex: { module: shader, entryPoint: 'vs' },
      fragment: { module: shader, entryPoint: 'fs', targets: [{ format: 'rgba32float' }] },
    });
    const target = own(device.createTexture({ size: [uvs.length, 1], format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC }));
    const rasterReadback = own(device.createBuffer({ size: 256, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }));
    const rasterGroups = groups(raster);
    const rasterEncoder = device.createCommandEncoder();
    const draw = rasterEncoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
    draw.setPipeline(raster);
    draw.setBindGroup(1, rasterGroups[0]!);
    draw.setBindGroup(2, rasterGroups[1]!);
    draw.draw(3);
    draw.end();
    rasterEncoder.copyTextureToBuffer({ texture: target }, { buffer: rasterReadback, bytesPerRow: 256 }, [uvs.length, 1]);
    device.queue.submit([rasterEncoder.finish()]);
    await verify(rasterReadback, 'raster');
    return { raster: 'PASS', compute: 'PASS', samples: uvs.length };
  } finally {
    resources.reverse().forEach(resource => resource.destroy());
    device.destroy();
  }
}
