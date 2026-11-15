import { DISNEY_BSDF_WGSL } from '../../src/render/pathtracing/disney-bsdf-wgsl.ts';
import { DISNEY_MATERIAL_WGSL } from '../../src/render/pathtracing/disney-material-wgsl.ts';

/**
 * Compare the WebGPU evaluation against the actual GLSL source on WebGL2.
 * The caller supplies the original disney.glsl and sampling.glsl contents.
 */
export async function runDisneyBsdfProbe(
  device: GPUDevice, disneySource: string, samplingSource: string,
): Promise<{ compared: number; aligned: number; maxAlignedDirectionDelta: number }> {
  const normalize = (v: readonly number[]) => {
    const length = Math.hypot(...v);
    return v.map(x => x / length);
  };
  const materialCases = [
    { base: [0.8, 0.3, 0.1], metallic: 0, transmission: 0, roughness: 0.35, subsurface: 0, tint: 0, sheen: 0, coat: 0, eta: 1 / 1.5 },
    { base: [0.8, 0.4, 0.1], metallic: 1, transmission: 0, roughness: 0.15, subsurface: 0, tint: 0, sheen: 0, coat: 0, eta: 1 / 1.5 },
    { base: [0.2, 0.6, 0.9], metallic: 0, transmission: 1, roughness: 0.3, subsurface: 0, tint: 0, sheen: 0, coat: 0, eta: 1 / 1.5 },
    { base: [0.9, 0.5, 0.2], metallic: 0.35, transmission: 0.4, roughness: 0.7, subsurface: 0.6, tint: 0.8, sheen: 0.5, coat: 0.7, eta: 1.5 },
    { base: [0.2, 0.3, 0.7], metallic: 0.2, transmission: 0, roughness: 0.03, subsurface: 1, tint: 0.5, sheen: 1, coat: 1, eta: 1 / 1.45 },
  ];
  const views = [[0, 0, 1], normalize([0.3, -0.5, 0.8]), normalize([0.99, 0.1, 0.15])];
  const lights = [[0, 0, 1], normalize([-0.5, 0.2, 0.8]), normalize([0.8, 0.1, -0.6]), normalize([-0.2, 0.9, -0.3])];
  const normals = [[0, 0, 1], normalize([0.3, 0.4, 0.866]), [1, 0, 0], [0, 0, -1]];
  const cross = (a: readonly number[], b: readonly number[]) => [
    a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!,
  ];
  const cases: number[][] = [];
  for (const material of materialCases) for (const normal of normals) for (const view of views) for (const light of lights) {
    const tangent = normalize(cross(Math.abs(normal[2]!) < 0.9999999 ? [0, 0, 1] : [1, 0, 0], normal));
    const bitangent = cross(normal, tangent);
    const world = (v: readonly number[]) => normal.map((n, i) => v[0]! * tangent[i]! + v[1]! * bitangent[i]! + v[2]! * n);
    const aspect = Math.sqrt(1 - 0.7 * 0.9);
    cases.push([
      ...material.base, material.eta,
      material.metallic, material.transmission, material.roughness, material.subsurface,
      material.tint, material.sheen, 0.6, material.coat,
      0.03, 1.5, Math.max(0.001, material.roughness / aspect), Math.max(0.001, material.roughness * aspect),
      ...world(view), 0, ...normal, 0, ...world(light), 0,
    ]);
  }
  const referenceCount = cases.length;
  cases.push([...cases[0]!.slice(0, 16), 0, 0, 0, 0, ...cases[0]!.slice(20)]);
  const blackMetal = [...cases[0]!];
  blackMetal.splice(0, 3, 0, 0, 0); blackMetal[4] = 1;
  cases.push(blackMetal);
  const degenerate = [...cases[0]!];
  degenerate[3] = 1; degenerate.splice(16, 3, 0, 0, 1); degenerate.splice(24, 3, 0, 0, -1);
  cases.push(degenerate);
  for (const item of cases) item.push(0, 0, 0, 0);
  const sampleStart = cases.length;
  const randoms = [[0.13, 0.77, 0.001], [0.35, 0.61, 0.3], [0.82, 0.21, 0.6],
    [0.49, 0.33, 0.9999], [0.01, 0.91, 0.9999999], [0.25, 0.25, 1]];
  const alignedCases: number[][] = [];
  for (let i = 0; i < referenceCount; i += lights.length) {
    const item = cases[i]!.slice(0, 28);
    const n = item.slice(20, 23);
    const v = item.slice(16, 19);
    if (n.every((x, j) => Math.abs(x - v[j]!) < 1e-10) &&
        Math.abs(n[2]!) < 0.999999 && Math.abs(n[0]!) < 0.999999) {
      // The source VNDF basis is discontinuous at exact normal incidence.
      for (const random of randoms) alignedCases.push([...item, ...random, 1]);
      const t = normalize(cross([0, 0, 1], n));
      item.splice(16, 3, ...normalize(n.map((x, j) => x + 0.001 * t[j]!)));
    }
    for (const random of randoms) cases.push([...item, ...random, 1]);
  }
  const alignedStart = cases.length;
  cases.push(...alignedCases);
  const invalidSampleStart = cases.length;
  cases.push([...cases[0]!.slice(0, 28), -0.1, 0.5, 0.5, 1]);
  cases.push([...blackMetal.slice(0, 28), 0.5, 0.5, 0.5, 1]);
  if (cases.some(item => item.length !== 32)) throw new Error('Invalid Disney BSDF probe record.');

  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) throw new Error('WebGL2 floating-point framebuffer unavailable.');
  const sampling = samplingSource.split('void SampleSphereLight')[0];
  if (!sampling || !disneySource.includes('vec3 DisneyEval')) throw new Error('Invalid original GLSL source.');
  const vertexSource = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
  const fragmentSource = `#version 300 es
precision highp float;
#define PI 3.14159265358979323
#define INV_PI 0.31830988618379067
#define TWO_PI 6.28318530717958648
struct Material {
  vec3 baseColor;
  float metallic, specTrans, roughness, subsurface, specularTint, sheen, sheenTint;
  float clearcoat, clearcoatRoughness, ior, ax, ay;
};
struct State { Material mat; float eta; };
float Luminance(vec3 c) { return dot(c, vec3(0.212671, 0.715160, 0.072169)); }
uniform vec3 randomValues;
int randomIndex = 0;
float rand() { return randomValues[randomIndex++]; }
${sampling}
${disneySource}
uniform vec4 data[7];
uniform bool sampleMode;
uniform bool directionOnly;
out vec4 color;
void main() {
  State s;
  s.mat.baseColor=data[0].xyz; s.eta=data[0].w;
  s.mat.metallic=data[1].x; s.mat.specTrans=data[1].y; s.mat.roughness=data[1].z; s.mat.subsurface=data[1].w;
  s.mat.specularTint=data[2].x; s.mat.sheen=data[2].y; s.mat.sheenTint=data[2].z; s.mat.clearcoat=data[2].w;
  s.mat.clearcoatRoughness=data[3].x; s.mat.ior=data[3].y; s.mat.ax=data[3].z; s.mat.ay=data[3].w;
  float pdf;
  if (sampleMode) {
    vec3 direction;
    vec3 f = DisneySample(s, data[4].xyz, data[5].xyz, direction, pdf);
    color = directionOnly ? vec4(direction, 1) : vec4(f, pdf);
  } else {
    vec3 f = DisneyEval(s, data[4].xyz, data[5].xyz, data[6].xyz, pdf);
    color = vec4(f, pdf);
  }
}`;
  const compile = (type: number, source: string): WebGLShader => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Unable to allocate reference shader.');
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Reference GLSL failed: ${log}`);
    }
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  const target = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  if (!program || !target || !framebuffer) throw new Error('Unable to allocate reference framebuffer.');
  const input = device.createBuffer({ size: cases.length * 32 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const output = device.createBuffer({ size: cases.length * 12 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readback = device.createBuffer({ size: cases.length * 12 * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  try {
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Reference GLSL link failed: ${gl.getProgramInfoLog(program)}`);
    gl.bindTexture(gl.TEXTURE_2D, target);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 1, 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Reference framebuffer incomplete.');
    gl.useProgram(program); gl.viewport(0, 0, 1, 1);
    const uniform = gl.getUniformLocation(program, 'data[0]');
    const sampleMode = gl.getUniformLocation(program, 'sampleMode');
    const directionOnly = gl.getUniformLocation(program, 'directionOnly');
    const randomValues = gl.getUniformLocation(program, 'randomValues');
    if (!uniform || !sampleMode || !directionOnly || !randomValues) throw new Error('Reference input uniform unavailable.');
    const reference: number[][] = [];
    for (const item of cases.slice(0, referenceCount)) {
      gl.uniform4fv(uniform, new Float32Array(item.slice(0, 28)));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const value = new Float32Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, value);
      if (gl.getError() !== gl.NO_ERROR || [...value].some(v => !Number.isFinite(v))) {
        throw new Error(`Reference GLSL produced invalid output for case ${reference.length}: ${value}.`);
      }
      reference.push([...value]);
    }
    const sampleReference: { value: number[]; direction: number[] }[] = [];
    gl.uniform1i(sampleMode, 1);
    for (const item of cases.slice(sampleStart, invalidSampleStart)) {
      gl.uniform4fv(uniform, new Float32Array(item.slice(0, 28)));
      gl.uniform3fv(randomValues, new Float32Array(item.slice(28, 31)));
      gl.uniform1i(directionOnly, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
      const value = new Float32Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, value);
      gl.uniform1i(directionOnly, 1); gl.drawArrays(gl.TRIANGLES, 0, 3);
      const direction = new Float32Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, direction);
      if (gl.getError() !== gl.NO_ERROR || [...value, ...direction].some(v => !Number.isFinite(v))) {
        throw new Error(`Reference GLSL produced invalid sample ${sampleReference.length}: ${value}, ${direction}.`);
      }
      sampleReference.push({ value: [...value], direction: [...direction.slice(0, 3)] });
    }
    device.queue.writeBuffer(input, 0, new Float32Array(cases.flat()));
    const module = device.createShaderModule({ code: /* wgsl */ `
@group(0) @binding(0) var<storage, read> disneyMaterials: array<vec4f>;
@group(0) @binding(1) var disneyTextureMaps: texture_2d_array<u32>;
@group(1) @binding(0) var<storage, read> inputs: array<vec4f>;
@group(1) @binding(1) var<storage, read_write> outputs: array<vec4f>;
${DISNEY_MATERIAL_WGSL}
${DISNEY_BSDF_WGSL}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let base=id.x*8u;
  let a=inputs[base]; let b=inputs[base+1u]; let c=inputs[base+2u]; let d=inputs[base+3u];
  var mat: DisneyShadingMaterial;
  mat.baseColor=a.xyz; mat.eta=a.w; mat.metallic=b.x; mat.specTrans=b.y; mat.roughness=b.z; mat.subsurface=b.w;
  mat.specularTint=c.x; mat.sheen=c.y; mat.sheenTint=c.z; mat.clearcoat=c.w;
  mat.clearcoatRoughness=d.x; mat.ior=d.y; mat.ax=d.z; mat.ay=d.w;
  if (inputs[base+7u].w > 0.0) {
    let result=disneySample(mat,inputs[base+4u].xyz,inputs[base+5u].xyz,inputs[base+7u].xyz);
    outputs[id.x*3u]=vec4f(result.value,result.pdf);
    outputs[id.x*3u+1u]=vec4f(result.direction,f32(result.error));
  } else {
    let result=disneyEval(mat,inputs[base+4u].xyz,inputs[base+5u].xyz,inputs[base+6u].xyz);
    outputs[id.x*3u]=vec4f(result.value,result.pdf);
    outputs[id.x*3u+1u]=vec4f(0,0,0,f32(result.error));
  }
}` });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter(message => message.type === 'error');
    if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
    const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(1), entries: [
      { binding: 0, resource: { buffer: input } }, { binding: 1, resource: { buffer: output } },
    ] });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline); pass.setBindGroup(1, group); pass.dispatchWorkgroups(cases.length); pass.end();
    encoder.copyBufferToBuffer(output, 0, readback, 0, cases.length * 12 * 4);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const actual = Array.from(new Float32Array(readback.getMappedRange().slice(0)));
    readback.unmap();
    for (const [i, expected] of reference.entries()) {
      const got = actual.slice(i * 12, i * 12 + 4);
      if (actual[i * 12 + 7] !== 0 || expected.some((x, j) =>
        !Number.isFinite(got[j]!) || Math.abs(got[j]! - x) > 0.00005 + 0.0005 * Math.abs(x))) {
        throw new Error(`Disney BSDF case ${i}: GLSL ${expected}, WGSL ${got}, error ${actual[i * 12 + 7]}.`);
      }
    }
    for (const [i, error] of [1, 2, 3].entries()) {
      if (actual[(referenceCount + i) * 12 + 7] !== error) throw new Error(`Disney BSDF invalid case ${i}: expected error ${error}.`);
    }
    let maxAlignedDirectionDelta = 0;
    for (const [i, expected] of sampleReference.entries()) {
      const offset = (sampleStart + i) * 12;
      const got = actual.slice(offset, offset + 4);
      const direction = actual.slice(offset + 4, offset + 7);
      if (sampleStart + i >= alignedStart) {
        if (actual[offset + 7] !== 0 || [...got, ...direction].some(x => !Number.isFinite(x))) {
          throw new Error(`Disney BSDF aligned sample ${i}: invalid WGSL output.`);
        }
        maxAlignedDirectionDelta = Math.max(maxAlignedDirectionDelta,
          ...expected.direction.map((x, j) => Math.abs(direction[j]! - x)));
        continue;
      }
      if (actual[offset + 7] !== 0 || expected.value.some((x, j) =>
        !Number.isFinite(got[j]!) || Math.abs(got[j]! - x) > 0.00005 + 0.0005 * Math.abs(x)) ||
        expected.direction.some((x, j) => !Number.isFinite(direction[j]!) || Math.abs(direction[j]! - x) > 0.00005)) {
        throw new Error(`Disney BSDF sample ${i}: GLSL ${expected.value}, ${expected.direction}; WGSL ${got}, ${direction}; error ${actual[offset + 7]}.`);
      }
    }
    for (const [i, error] of [1, 2].entries()) {
      if (actual[(invalidSampleStart + i) * 12 + 7] !== error) {
        throw new Error(`Disney BSDF invalid sample ${i}: expected error ${error}.`);
      }
    }
    return { compared: referenceCount + alignedStart - sampleStart, aligned: alignedCases.length, maxAlignedDirectionDelta };
  } finally {
    input.destroy(); output.destroy(); readback.destroy();
    gl.deleteFramebuffer(framebuffer); gl.deleteTexture(target); gl.deleteProgram(program);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
  }
}
