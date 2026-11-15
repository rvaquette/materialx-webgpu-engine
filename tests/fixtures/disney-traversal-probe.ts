import { buildTlas } from '../../src/geometry/bvh.ts';
import { buildGeometry, type InstanceResource, type SceneResources } from '../../src/render/scene-resources.ts';
import { IDENTITY4, multiply4, scaling4, translation4 } from '../../src/scene/transforms.ts';
import { buildDisneyAcceleration } from '../../src/render/pathtracing/disney-acceleration.ts';
import { packDisneyGeometryTextures, uploadDisneyGeometryTextures } from '../../src/render/pathtracing/disney-geometry-textures.ts';
import { DISNEY_TRAVERSAL_WGSL } from '../../src/render/pathtracing/disney-traversal-wgsl.ts';
import { DISNEY_SURFACE_WGSL } from '../../src/render/pathtracing/disney-surface-wgsl.ts';

/** Run actual GPU traversal over a shared triangle with translated and mirrored instances. */
export async function runDisneyTraversalProbe(device: GPUDevice): Promise<number[]> {
  const geometry = buildGeometry('triangle', '/Triangle', {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 1, 1, 1, 0, 1]),
    uvs: new Float32Array([0.1, 0.2, 0.9, 0.2, 0.1, 0.8]),
    indices: new Uint32Array([0, 1, 2]), attributes: new Map(), subsets: [],
    subdivision: { scheme: 'none', level: 0, applied: false }, displacement: { required: false },
  });
  const instance = (id: string, transform: readonly number[]): InstanceResource =>
    ({ id, primPath: `/${id}`, prototypeId: 'triangle', transform, hasGeometry: true });
  const other = buildGeometry('other', '/Other', {
    positions: new Float32Array(Array.from({ length: 5 }, (_, i) =>
      [i, 0, 0, i + 0.5, 0, 0, i, 0.5, 0]).flat()),
    normals: new Float32Array(Array.from({ length: 15 }, (_, i) => i < 3 ? [0, 0, 0] : [0, 0, 1]).flat()),
    uvs: new Float32Array(Array.from({ length: 5 }, (_, i) =>
      i === 4 ? [0, 0, 0, 0, 0, 0] :
        i === 1 ? [0, 0, 0, 1, 1, 0] : [0, 0, 1, 0, 0, 1]).flat()),
    indices: Uint32Array.from({ length: 15 }, (_, i) => i), attributes: new Map(),
    subsets: [
      { name: 'first', material: '/First', triangles: new Uint32Array([1]) },
      { name: 'second', material: '/Second', triangles: new Uint32Array([4]) },
    ],
    subdivision: { scheme: 'none', level: 0, applied: false }, displacement: { required: false },
  });
  const noUv = buildGeometry('noUv', '/NoUv', {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]), attributes: new Map(),
    subsets: [{ name: 'no-uv', material: '/NoUv', triangles: new Uint32Array([0]) }],
    subdivision: { scheme: 'none', level: 0, applied: false }, displacement: { required: false },
  });
  const resources: SceneResources = {
    geometries: new Map([['triangle', geometry], ['other', other], ['noUv', noUv]]), materials: new Map(),
    instances: [instance('a', IDENTITY4), instance('b', multiply4(translation4(2, 0, -1), scaling4(2, 1, 2))),
      instance('c', scaling4(-2, 1, 1)),
      { ...instance('d', translation4(4, 0, 1)), prototypeId: 'other' },
      instance('e', multiply4(translation4(6, 0, 0), scaling4(1, 1, 1e10))),
      instance('f', translation4(0, 0, -1)),
      { ...instance('g', translation4(10, 0, 0)), prototypeId: 'noUv' },
      instance('h', [1, 0, 0, 0, 0.5, 2, 0, 0, 0, 0, 1, 0, 12, 0, 0, 1]),
      { ...instance('i', translation4(20, 0, 1)), prototypeId: 'other' }],
    tlas: buildTlas([]), pendingGeometry: [], pendingMaterials: [], unboundGprims: [],
  };
  const subsetMaps = resources.instances.map(() => new Map<string, number>());
  subsetMaps[3]!.set('/First', 21).set('/Second', 22);
  subsetMaps[6]!.set('/NoUv', 41);
  subsetMaps[8]!.set('/First', 31).set('/Second', 32);
  const packed = packDisneyGeometryTextures(buildDisneyAcceleration(resources), [4, 7, 9, 11, 13, 15, 17, 19, 29], subsetMaps);
  const textures = uploadDisneyGeometryTextures(device, packed);
  const bytes = 17 * 32 * 4;
  const output = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readback = device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  try {
    const module = device.createShaderModule({ code: /* wgsl */ `
@group(0) @binding(0) var disneyNodes: texture_2d<f32>;
@group(0) @binding(1) var disneyTriangles: texture_2d<i32>;
@group(0) @binding(2) var disneyVertices: texture_2d<f32>;
@group(0) @binding(3) var disneyInverseTransforms: texture_2d<f32>;
@group(0) @binding(4) var<storage, read_write> output: array<vec4f>;
@group(0) @binding(5) var disneyNormals: texture_2d<f32>;
@group(0) @binding(6) var disneyTransforms: texture_2d<f32>;
@group(0) @binding(7) var disneySubsetMaterials: texture_2d<i32>;
${DISNEY_TRAVERSAL_WGSL}
${DISNEY_SURFACE_WGSL}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let origins = array<vec3f, 17>(vec3f(0.25,0.25,2), vec3f(2.5,0.25,2),
    vec3f(-0.5,0.25,2), vec3f(-3,0.25,2), vec3f(2,0,2), vec3f(0.25,0.25,2),
    vec3f(4.1,0.1,2), vec3f(6.4,0.25,2), vec3f(2.5,0.25,2), vec3f(0.25,0.25,2),
    vec3f(5.1,0.1,2), vec3f(8.1,0.1,2), vec3f(0.25,0.25,-0.5),
    vec3f(10.25,0.25,2), vec3f(12.375,0.5,2), vec3f(21.1,0.1,2), vec3f(23.1,0.1,2));
  var dir = select(vec3f(0,0,-1), vec3f(0,0,-2), id.x == 1u);
  if (id.x == 12u) { dir = vec3f(0,0,1); }
  let limit = select(10.0, 1.0, id.x == 5u);
  let minT = select(0.0001, 2.5, id.x == 9u);
  let hit = disneyTrace(${packed.topLevelIndex}u, origins[id.x], dir, minT, limit, id.x == 8u || id.x == 15u);
  let surface = disneySurface(hit, origins[id.x], dir);
  let base = id.x * 8u;
  output[base] = vec4f(hit.t, f32(hit.instance), f32(hit.material), select(0.0, 1.0, hit.hit));
  output[base + 1u] = vec4f(hit.barycentric, f32(hit.triangle), select(0.0, 1.0, hit.overflow));
  output[base + 2u] = vec4f(surface.uv, select(0.0, 1.0, surface.normalValid), select(0.0, 1.0, surface.tangentValid));
  output[base + 3u] = vec4f(surface.normal, 0.0);
  output[base + 4u] = vec4f(surface.faceNormal, 0.0);
  output[base + 5u] = vec4f(surface.tangent, 0.0);
  output[base + 6u] = vec4f(surface.bitangent, 0.0);
  output[base + 7u] = vec4f(surface.position, select(0.0, 1.0, surface.uvValid));
}` });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter(message => message.type === 'error');
    if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
    const layout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'sint' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
      { binding: 7, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'sint' } },
    ] });
    const pipeline = await device.createComputePipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), compute: { module, entryPoint: 'main' },
    });
    const bindGroup = device.createBindGroup({ layout, entries: [
      { binding: 0, resource: textures.nodes.createView() },
      { binding: 1, resource: textures.triangleIndices.createView() },
      { binding: 2, resource: textures.vertices.createView() },
      { binding: 3, resource: textures.inverseTransforms.createView() },
      { binding: 4, resource: { buffer: output } },
      { binding: 5, resource: textures.normals.createView() },
      { binding: 6, resource: textures.transforms.createView() },
      { binding: 7, resource: textures.subsetMaterials.createView() },
    ] });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(17);
    pass.end();
    encoder.copyBufferToBuffer(output, 0, readback, 0, bytes);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const result = Array.from(new Float32Array(readback.getMappedRange().slice(0)));
    readback.unmap();
    const expected = [
      [2, 0, 4, 1, 0.25, 0.25, 0], [1.5, 1, 7, 1, 0.25, 0.25, 0],
      [2, 2, 9, 1, 0.25, 0.25, 0], [10, 0, 0, 0, 0, 0, 0],
      [3, 1, 7, 1, 0, 0, 0], [1, 0, 0, 0, 0, 0, 0],
      [1, 3, 11, 1, 0.2, 0.2, 1], [2, 4, 13, 1, 0.4, 0.25, 0],
      [3, 1, 7, 1, 0.25, 0.25, 0], [3, 5, 15, 1, 0.25, 0.25, 0],
      [1, 3, 21, 1, 0.2, 0.2, 2],
      [1, 3, 22, 1, 0.2, 0.2, 5], [0.5, 0, 4, 1, 0.25, 0.25, 0],
      [2, 6, 41, 1, 0.25, 0.25, 6], [2, 7, 19, 1, 0.25, 0.25, 0],
      [1, 8, 31, 1, 0.2, 0.2, 2], [1, 8, 29, 1, 0.2, 0.2, 4],
    ];
    expected.forEach((want, ray) => {
      const actual = result.slice(ray * 32, ray * 32 + 8);
      if (actual[7] !== 0 || actual[3] !== want[3] ||
          Math.abs(actual[0]! - want[0]!) > 1e-5 ||
          (want[3] === 1 && [1, 2, 4, 5, 6].some(i => Math.abs(actual[i]! - want[i]!) > 1e-5))) {
        throw new Error(`Disney traversal ray ${ray}: expected ${want}, got ${actual}.`);
      }
    });
    const approx = (ray: number, offset: number, expected: number[]) => {
      const actual = result.slice(ray * 32 + offset, ray * 32 + offset + expected.length);
      if (expected.some((value, i) => !Number.isFinite(actual[i]!) || Math.abs(actual[i]! - value) > 1e-5)) {
        throw new Error(`Disney surface ray ${ray}, offset ${offset}: expected ${expected}, got ${actual}.`);
      }
    };
    const normalized = (v: number[]) => {
      const length = Math.hypot(...v);
      return v.map(value => value / length);
    };
    for (const [ray, normal, tangent] of [
      [0, [0.25, 0.25, 1], [1, 0, 0]],
      [1, [0.125, 0.25, 0.5], [1, 0, 0]],
      [2, [-0.125, 0.25, 1], [-1, 0, 0]],
    ] as const) {
      approx(ray, 8, [0.3, 0.35, 1, 1]);
      approx(ray, 12, normalized([...normal]));
      approx(ray, 16, normalized([...normal]));
      approx(ray, 20, [...tangent]);
      approx(ray, 24, [0, 1, 0]);
    }
    approx(0, 28, [0.25, 0.25, 0, 1]);
    approx(3, 8, [0, 0, 0, 0]);
    approx(6, 8, [0.2, 0.2, 0, 1]);
    approx(10, 20, [0, 1, 0]);
    approx(10, 24, [1, 0, 0]);
    approx(11, 8, [0, 0, 1, 0]);
    approx(11, 31, [1]);
    approx(12, 12, normalized([0.25, 0.25, 1]));
    approx(12, 16, normalized([-0.25, -0.25, -1]));
    approx(13, 8, [0, 0, 1, 0]);
    approx(13, 31, [0]);
    approx(14, 8, [0.3, 0.35, 1, 1]);
    approx(14, 12, normalized([0.25, 0.0625, 1]));
    approx(14, 20, [1, 0, 0]);
    approx(14, 24, normalized([0.5, 2, 0]));
    return result;
  } finally {
    textures.destroy();
    output.destroy();
    readback.destroy();
  }
}
