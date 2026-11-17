import type { DecodedPixelImage } from '../../src/assets/images.ts';
import { uploadDisneyMaterials, type DisneyMaterial } from '../../src/render/pathtracing/disney-material.ts';
import { DISNEY_MATERIAL_WGSL } from '../../src/render/pathtracing/disney-material-wgsl.ts';
import { DisneyTextureRegistry, uploadDisneyTextureArray } from '../../src/render/pathtracing/disney-texture-array.ts';

/** Exercise material decoding and periodic, layer-isolated texture lookup on WebGPU. */
export async function runDisneyMaterialProbe(device: GPUDevice): Promise<void> {
  const registry = new DisneyTextureRegistry();
  const pixels = [
    [128, 64, 32, 128, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255],
    [16, 128, 64, 255, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    [255, 128, 255, 255, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    [32, 64, 128, 255, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  ];
  const images: DecodedPixelImage[] = pixels.map(data => ({
    kind: 'pixels', componentType: 'uint8', channels: 4, width: 2, height: 2,
    colorSpace: 'lin_rec709', data: new Uint8Array(data),
  }));
  for (let i = 0; i < images.length; i++) registry.add(String(i), 'albedo');
  const textures = await uploadDisneyTextureArray(device, registry, { decode: file => images[Number(file)] }, 2, 2);
  if (!textures) throw new Error('Disney test texture array was not created.');
  const material: DisneyMaterial = {
    baseColor: [0.8, 0.4, 0.2], anisotropic: 0.5, emission: [3, 2, 1],
    metallic: 0.7, roughness: 0, subsurface: 0.2, specularTint: 0.3,
    sheen: 0.4, sheenTint: 0.5, clearcoat: 0.6, clearcoatGloss: 0.5,
    specTrans: 0.25, ior: 1.5, mediumType: 2, mediumDensity: 0.8,
    mediumColor: [0.1, 0.2, 0.3], mediumAnisotropy: 1,
    textures: [-1, -1, -1, -1], opacity: 0.75, alphaMode: 2, alphaCutoff: 0.4,
  };
  const records = uploadDisneyMaterials(device, [material, { ...material, textures: [0, 1, 2, 3] }], 4);
  const bytes = 27 * 6 * 4 * 4;
  const output = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readback = device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  try {
    const module = device.createShaderModule({ code: /* wgsl */ `
@group(0) @binding(0) var<storage, read> disneyMaterials: array<vec4f>;
@group(0) @binding(1) var disneyTextureMaps: texture_2d_array<u32>;
@group(0) @binding(2) var<storage, read_write> output: array<vec4f>;
${DISNEY_MATERIAL_WGSL}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let base = id.x * 6u;
  if (id.x >= 20u) {
    let coords = array<vec2f, 7>(
      vec2f(-0.1,0), vec2f(0,-0.25), vec2f(bitcast<f32>(0x7f800000u + id.y),0),
      vec2f(0,-0.75), vec2f(0,2), vec2f(-4.75,5.75), vec2f(5.75,-4.75));
    let layer = select(select(0, 1, id.x == 20u), 3, id.x >= 25u);
    let sample = disneySampleTexture(layer, coords[id.x - 20u]);
    output[base] = vec4f(sample.color.rgb, select(-1.0, sample.color.a, sample.valid));
    return;
  }
  if (id.x < 10u) {
    let coords = array<vec2f, 10>(
      vec2f(0.1,0.1), vec2f(0.6,0.1), vec2f(1,0), vec2f(-0.1,0.6), vec2f(0,1),
      vec2f(0,-1), vec2f(0,1), vec2f(0,1.25), vec2f(-0.1,0), vec2f(0,0));
    let layer = select(select(0, 3, id.x == 6u), 4, id.x == 9u);
    let sample = disneySampleTexture(layer, coords[id.x]);
    output[base] = vec4f(sample.color.rgb, select(-1.0, sample.color.a, sample.valid));
    return;
  }
  var ctx: DisneyMaterialContext;
  ctx.uv = select(vec2f(0.1,0.1), vec2f(0,bitcast<f32>(0x7fc00000u + id.y)), id.x == 16u);
  ctx.normal = vec3f(0,0,1); ctx.tangent = vec3f(1,0,0); ctx.bitangent = vec3f(0,1,0);
  ctx.direction = select(vec3f(0,0,-1), vec3f(0,0,1), id.x == 13u);
  if (id.x == 18u) { ctx.direction = vec3f(0); }
  ctx.normalValid = id.x != 17u; ctx.uvValid = id.x != 19u; ctx.tangentValid = id.x != 12u;
  ctx.flipNormalY = id.x == 13u;
  ctx.mollify = id.x == 14u; ctx.previousRoughness = 0.8; ctx.mollificationAmount = 0.5;
  let index = select(select(1u, 0u, id.x == 10u), 2u, id.x == 15u);
  let mat = disneyLoadMaterial(index, ctx);
  output[base] = vec4f(mat.baseColor, mat.opacity);
  output[base + 1u] = vec4f(mat.emission, mat.metallic);
  output[base + 2u] = vec4f(mat.roughness, mat.clearcoatRoughness, mat.mediumAnisotropy, mat.eta);
  output[base + 3u] = vec4f(mat.normal, f32(mat.error));
  output[base + 4u] = vec4f(mat.faceNormal, mat.ax);
  output[base + 5u] = vec4f(mat.ay, mat.subsurface, f32(mat.alphaMode), mat.alphaCutoff);
}` });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter(message => message.type === 'error');
    if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
    const layout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'uint', viewDimension: '2d-array' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ] });
    const pipeline = await device.createComputePipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), compute: { module, entryPoint: 'main' },
    });
    const bindGroup = device.createBindGroup({ layout, entries: [
      { binding: 0, resource: { buffer: records } },
      { binding: 1, resource: textures.createView({ dimension: '2d-array' }) },
      { binding: 2, resource: { buffer: output } },
    ] });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.dispatchWorkgroups(27); pass.end();
    encoder.copyBufferToBuffer(output, 0, readback, 0, bytes);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const result = Array.from(new Float32Array(readback.getMappedRange().slice(0)));
    readback.unmap();
    const approx = (item: number, offset: number, expected: readonly number[]) => {
      const actual = result.slice(item * 24 + offset, item * 24 + offset + expected.length);
      if (expected.some((value, i) => !Number.isFinite(actual[i]!) || Math.abs(actual[i]! - value) > 2e-5)) {
        throw new Error(`Disney material probe ${item}, offset ${offset}: expected ${expected}, got ${actual}.`);
      }
    };
    const texel = (p: number[]) => p.map(v => v / 255);
    approx(0, 0, texel(pixels[0]!.slice(0, 4)));
    approx(1, 0, [1, 0, 0, 1]); approx(2, 0, texel(pixels[0]!.slice(0, 4))); approx(3, 0, [0, 0, 1, 1]);
    approx(4, 0, texel(pixels[0]!.slice(0, 4))); approx(5, 0, texel(pixels[0]!.slice(0, 4)));
    approx(6, 0, texel(pixels[3]!.slice(0, 4))); approx(7, 0, texel(pixels[0]!.slice(0, 4)));
    approx(8, 0, [1, 0, 0, 1]); approx(9, 0, [0, 0, 0, -1]);
    approx(10, 0, [0.8, 0.4, 0.2, 0.75]); approx(10, 4, [3, 2, 1, 0.7]);
    approx(10, 8, [0.001, 0.0505, 0.9, 1 / 1.5]); approx(10, 12, [0, 0, 1, 0]);
    const gamma = (v: number) => (v / 255) ** 2.2;
    const mapped = [1, 1 / 255, 1];
    const length = Math.hypot(...mapped);
    const normal = mapped.map(v => v / length);
    approx(11, 0, [0.8 * gamma(128), 0.4 * gamma(64), 0.2 * gamma(32), 0.75 * 128 / 255]);
    approx(11, 4, [gamma(32), gamma(64), gamma(128), 64 / 255]);
    const roughness = (128 / 255) ** 2;
    approx(11, 8, [roughness, 0.0505, 0.9, 1 / 1.5]);
    approx(11, 12, [...normal, 0]); approx(11, 16, [...normal, roughness / Math.sqrt(0.55)]);
    approx(11, 20, [roughness * Math.sqrt(0.55), 0.2, 2, 0.4]);
    approx(12, 15, [3]);
    approx(13, 12, [normal[0]!, -normal[1]!, normal[2]!, 0]);
    approx(13, 16, [-normal[0]!, normal[1]!, -normal[2]!]);
    approx(13, 11, [1.5]);
    approx(14, 8, [0.4]);
    approx(15, 15, [1]);
    approx(16, 15, [2]);
    approx(17, 15, [3]);
    approx(18, 15, [4]);
    approx(19, 15, [5]);
    approx(20, 0, texel(pixels[1]!.slice(4, 8)));
    approx(21, 0, [0, 1, 0, 1]);
    approx(22, 0, [0, 0, 0, -1]);
    approx(23, 0, texel(pixels[0]!.slice(0, 4)));
    approx(24, 0, texel(pixels[0]!.slice(0, 4)));
    approx(25, 0, texel(pixels[3]!.slice(8, 12)));
    approx(26, 0, texel(pixels[3]!.slice(4, 8)));
  } finally {
    textures.destroy(); records.destroy(); output.destroy(); readback.destroy();
  }
}
