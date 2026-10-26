const pipelines = new WeakMap<GPUDevice, GPURenderPipeline>();

/** Box-filter a linear HDR texture on the GPU; level zero is never modified. */
export function generateEnvironmentMipmaps(device: GPUDevice, texture: GPUTexture): void {
  if (texture.mipLevelCount <= 1) return;
  let pipeline = pipelines.get(device);
  if (!pipeline) {
    const module = device.createShaderModule({ code: `
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;
struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> Vertex {
  let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var out: Vertex;
  out.position = vec4f(uv * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0), 0.0, 1.0);
  out.uv = uv;
  return out;
}
@fragment fn fs(in: Vertex) -> @location(0) vec4f {
  return textureSampleLevel(source, linearSampler, in.uv, 0.0);
}` });
    pipeline = device.createRenderPipeline({
      label: 'HDR environment mipmaps', layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
      primitive: { topology: 'triangle-list' },
    });
    pipelines.set(device, pipeline);
  }
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
  const encoder = device.createCommandEncoder();
  for (let level = 1; level < texture.mipLevelCount; level++) {
    const group = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: texture.createView({ baseMipLevel: level - 1, mipLevelCount: 1 }) },
        { binding: 1, resource: sampler },
      ],
    });
    const pass = encoder.beginRenderPass({ colorAttachments: [{
      view: texture.createView({ baseMipLevel: level, mipLevelCount: 1 }),
      loadOp: 'clear', storeOp: 'store',
    }] });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.draw(3);
    pass.end();
  }
  device.queue.submit([encoder.finish()]);
}
