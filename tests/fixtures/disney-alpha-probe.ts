import { buildTlas } from '../../src/geometry/bvh.ts';
import { buildGeometry, type SceneResources } from '../../src/render/scene-resources.ts';
import { translation4 } from '../../src/scene/transforms.ts';
import { buildDisneyAcceleration } from '../../src/render/pathtracing/disney-acceleration.ts';
import { packDisneyGeometryTextures, uploadDisneyGeometryTextures } from '../../src/render/pathtracing/disney-geometry-textures.ts';
import { packDisneyMaterials, uploadDisneyMaterials, type DisneyMaterial } from '../../src/render/pathtracing/disney-material.ts';
import { DISNEY_CAMERA_WGSL } from '../../src/render/pathtracing/disney-camera-wgsl.ts';
import { DISNEY_TRAVERSAL_WGSL } from '../../src/render/pathtracing/disney-traversal-wgsl.ts';
import { DISNEY_SURFACE_WGSL } from '../../src/render/pathtracing/disney-surface-wgsl.ts';
import { DISNEY_MATERIAL_WGSL } from '../../src/render/pathtracing/disney-material-wgsl.ts';
import { DISNEY_ALPHA_WGSL } from '../../src/render/pathtracing/disney-alpha-wgsl.ts';

/** Compare alpha-tested shadow traversal and RNG state with the source AnyHit. */
export async function runDisneyAlphaProbe(
  device: GPUDevice, globals: string, gles: string, intersection: string, anyHit: string,
): Promise<number> {
  const structsStart = globals.indexOf('struct Ray'), structsEnd = globals.indexOf('// Scene material ID');
  const rngStart = globals.indexOf('//internal RNG state'), rngEnd = globals.indexOf('vec3 FaceForward', rngStart);
  if ([structsStart, structsEnd, rngStart, rngEnd].some(i => i < 0) || !anyHit.includes('bool AnyHit')) {
    throw new Error('Invalid original alpha shaders.');
  }
  const geometry = buildGeometry('triangle', '/Triangle', {
    positions: new Float32Array([-2, -2, 0, 2, -2, 0, 0, 2, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([0.1, 0.1, 0.8, 0.1, 0.4, 0.8]), indices: new Uint32Array([0, 1, 2]),
    attributes: new Map(), subsets: [{ name: 'part', material: '/Part', triangles: new Uint32Array([0]) }],
    subdivision: { scheme: 'none', level: 0, applied: false },
    displacement: { required: false },
  });
  const resources: SceneResources = {
    geometries: new Map([['triangle', geometry]]), materials: new Map(),
    instances: [2, 1, 0].map((z, i) => ({
      id: `i${i}`, primPath: `/I${i}`, prototypeId: 'triangle', transform: translation4(0, 0, z), hasGeometry: true,
    })),
    tlas: buildTlas([]), pendingGeometry: [], pendingMaterials: [], unboundGprims: [],
  };
  const packed = packDisneyGeometryTextures(buildDisneyAcceleration(resources), [2, 0, 1],
    [0, 1, 2].map(index => new Map([['/Part', index]])));
  const textures = uploadDisneyGeometryTextures(device, packed);
  const material: DisneyMaterial = {
    baseColor: [1, 1, 1], anisotropic: 0, emission: [0, 0, 0], metallic: 0, roughness: 0.4, subsurface: 0,
    specularTint: 0, sheen: 0, sheenTint: 0, clearcoat: 0, clearcoatGloss: 0, specTrans: 0, ior: 1.5,
    mediumType: 0, mediumDensity: 0, mediumColor: [1, 1, 1], mediumAnisotropy: 0,
    textures: [-1, -1, -1, -1], opacity: 1, alphaMode: 0, alphaCutoff: 0.5,
  };
  const materialList: DisneyMaterial[] = [
    { ...material, opacity: 0.2, alphaMode: 2 },
    { ...material, opacity: 0.8, alphaMode: 1, textures: [0, -1, -1, -1] },
    material,
  ];
  const materials = uploadDisneyMaterials(device, materialList, 1);
  const map = device.createTexture({ size: [1, 1, 1], format: 'rgba8uint', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: map }, new Uint8Array([255, 255, 255, 128]), { bytesPerRow: 4 }, [1, 1, 1]);
  const cases: { x: number; z: number; distance: number; frame: number }[] = [];
  for (const [x, z] of [[0, 3], [0, 1.5], [0, 0.5], [5, 3]]) {
    for (const distance of [0.4, 1.5, 10]) for (let frame = 1; frame <= 16; frame++) {
      cases.push({ x: x!, z: z!, distance, frame });
    }
  }
  const input = device.createBuffer({ size: cases.length * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const output = device.createBuffer({ size: cases.length * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readback = device.createBuffer({ size: cases.length * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) throw new Error('WebGL2 float framebuffer unavailable.');
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Cannot create alpha reference shader.');
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`Alpha GLSL: ${gl.getShaderInfoLog(shader)}`);
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, `#version 300 es
void main() { vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2)); gl_Position=vec4(p*2.-1.,0.,1.); }`);
  const fragment = compile(gl.FRAGMENT_SHADER, `#version 300 es
#define OPT_SHADERTOY
#define OPT_ALPHA_TEST
#define MATERIALS_TEX_STRIDE 8
#define ALPHA_MODE_BLEND 1
#define ALPHA_MODE_MASK 2
#define INF 1000000.0
#define EPS 0.0003
${gles.replace(/^#version[^\n]*\n/, '')}
${globals.slice(structsStart, structsEnd)}
${globals.slice(rngStart, rngEnd)}
uniform sampler2D BVH, verticesTex, normalsTex, transformsTex, materialsTex;
uniform isampler2D vertexIndicesTex;
uniform usampler2D textureMapsArrayTex;
uniform int topBVHIndex, frameNum;
uniform vec2 rayOrigin;
uniform float maxDist;
${intersection}
${anyHit}
out vec4 outColor;
void main() {
  InitRNG(vec2(7,11),frameNum);
  bool hit=AnyHit(Ray(vec3(rayOrigin.x,0,rayOrigin.y),vec3(0,0,-1)),maxDist);
  outColor=vec4(float(hit),rand(),0,0);
}`);
  const program = gl.createProgram(), target = gl.createTexture(), framebuffer = gl.createFramebuffer();
  if (!program || !target || !framebuffer) throw new Error('Cannot create alpha reference resources.');
  const glTextures: WebGLTexture[] = [];
  try {
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Alpha GLSL link: ${gl.getProgramInfoLog(program)}`);
    gl.bindTexture(gl.TEXTURE_2D, target); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 1, 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Alpha framebuffer incomplete.');
    gl.useProgram(program); gl.viewport(0, 0, 1, 1);
    const loc = (name: string) => {
      const location = gl.getUniformLocation(program, name);
      if (!location) throw new Error(`Missing alpha uniform ${name}`);
      return location;
    };
    const upload = (unit: number, name: string, data: Float32Array | Int32Array | Uint8Array) => {
      const tex = gl.createTexture();
      if (!tex) throw new Error('Cannot create alpha data texture.');
      glTextures.push(tex); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex);
      const isInt = data instanceof Int32Array, isByte = data instanceof Uint8Array;
      gl.texImage2D(gl.TEXTURE_2D, 0, isInt ? gl.RGBA32I : isByte ? gl.RGBA8UI : gl.RGBA32F,
        data.length / 4, 1, 0, isInt || isByte ? gl.RGBA_INTEGER : gl.RGBA,
        isInt ? gl.INT : isByte ? gl.UNSIGNED_BYTE : gl.FLOAT, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.uniform1i(loc(name), unit);
    };
    const referenceNodes = packed.nodes.slice();
    for (let offset = 0; offset < referenceNodes.length; offset += 12) {
      if (referenceNodes[offset + 10]! < 0) referenceNodes[offset + 9] = -referenceNodes[offset + 10]! - 1;
    }
    upload(0, 'BVH', referenceNodes); upload(1, 'vertexIndicesTex', packed.triangleIndices);
    upload(2, 'verticesTex', packed.vertices); upload(3, 'normalsTex', packed.normals);
    upload(4, 'transformsTex', packed.transforms); upload(5, 'materialsTex', packDisneyMaterials(materialList));
    upload(6, 'textureMapsArrayTex', new Uint8Array([255, 255, 255, 128]));
    gl.uniform1i(loc('topBVHIndex'), packed.topLevelIndex);
    const reference: number[][] = [];
    for (const c of cases) {
      gl.uniform2f(loc('rayOrigin'), c.x, c.z); gl.uniform1f(loc('maxDist'), c.distance); gl.uniform1i(loc('frameNum'), c.frame);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const value = new Float32Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, value);
      if (gl.getError() !== gl.NO_ERROR || !Number.isFinite(value[1])) throw new Error(`Invalid GLSL alpha output ${reference.length}.`);
      reference.push([...value]);
    }
    device.queue.writeBuffer(input, 0, new Float32Array(cases.flatMap(c => [c.x, c.z, c.distance, c.frame])));
    const module = device.createShaderModule({ code: `
@group(0) @binding(0) var disneyNodes: texture_2d<f32>;
@group(0) @binding(1) var disneyTriangles: texture_2d<i32>;
@group(0) @binding(2) var disneyVertices: texture_2d<f32>;
@group(0) @binding(3) var disneyInverseTransforms: texture_2d<f32>;
@group(0) @binding(4) var disneyNormals: texture_2d<f32>;
@group(0) @binding(5) var disneyTransforms: texture_2d<f32>;
@group(0) @binding(6) var<storage, read> disneyMaterials: array<vec4f>;
@group(0) @binding(7) var disneyTextureMaps: texture_2d_array<u32>;
@group(0) @binding(8) var<storage, read> inputs: array<vec4f>;
@group(0) @binding(9) var<storage, read_write> outputs: array<vec4f>;
@group(0) @binding(10) var disneySubsetMaterials: texture_2d<i32>;
${DISNEY_CAMERA_WGSL}
${DISNEY_TRAVERSAL_WGSL}
${DISNEY_SURFACE_WGSL}
${DISNEY_MATERIAL_WGSL}
${DISNEY_ALPHA_WGSL}
@compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id: vec3u) {
  let a=inputs[id.x];
  var seed=disneyInitRng(vec2u(7,11),u32(a.w));
  let hit=disneyAlphaAnyHit(${packed.topLevelIndex}u,vec3f(a.x,0,a.y),vec3f(0,0,-1),a.z,&seed);
  outputs[id.x]=vec4f(select(0.0,1.0,hit.hit),disneyRandom(&seed),f32(hit.error),0);
}` });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter(m => m.type === 'error');
    if (errors.length) throw new Error(errors.map(m => `${m.lineNum}: ${m.message}`).join('\n'));
    const layout = device.createBindGroupLayout({ entries: [
      ...[0, 2, 3, 4].map(binding => ({ binding, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' as const } })),
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'sint' } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 7, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'uint', viewDimension: '2d-array' } },
      { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 9, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 10, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'sint' } },
    ] });
    const pipeline = await device.createComputePipelineAsync({ layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), compute: { module, entryPoint: 'main' } });
    const group = device.createBindGroup({ layout, entries: [
      { binding: 0, resource: textures.nodes.createView() }, { binding: 1, resource: textures.triangleIndices.createView() },
      { binding: 2, resource: textures.vertices.createView() }, { binding: 3, resource: textures.inverseTransforms.createView() },
      { binding: 4, resource: textures.normals.createView() }, { binding: 6, resource: { buffer: materials } },
      { binding: 7, resource: map.createView({ dimension: '2d-array' }) }, { binding: 8, resource: { buffer: input } },
      { binding: 9, resource: { buffer: output } },
      { binding: 10, resource: textures.subsetMaterials.createView() },
    ] });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(cases.length); pass.end();
    encoder.copyBufferToBuffer(output, 0, readback, 0, cases.length * 16); device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const actual = Array.from(new Float32Array(readback.getMappedRange().slice(0))); readback.unmap();
    for (const [i, expected] of reference.entries()) {
      const got = actual.slice(i * 4, i * 4 + 3);
      if (got[0] !== expected[0] || got[1] !== expected[1] || got[2] !== 0) {
        throw new Error(`Disney alpha shadow ${i}: GLSL ${expected}, WGSL ${got}.`);
      }
    }
    return cases.length;
  } finally {
    textures.destroy(); materials.destroy(); map.destroy(); input.destroy(); output.destroy(); readback.destroy();
    for (const texture of glTextures) gl.deleteTexture(texture);
    gl.deleteFramebuffer(framebuffer); gl.deleteTexture(target); gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
  }
}
