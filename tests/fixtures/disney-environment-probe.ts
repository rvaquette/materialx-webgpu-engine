import { buildDisneyEnvironmentCdf } from '../../src/render/pathtracing/disney-environment.ts';
import { DISNEY_ENVIRONMENT_WGSL } from '../../src/render/pathtracing/disney-environment-wgsl.ts';

/** Compare environment sampling and evaluation to the original GLSL on WebGL2. */
export async function runDisneyEnvironmentProbe(device: GPUDevice, source: string): Promise<number> {
  if (!source.includes('vec4 SampleEnvMap') || !source.includes('vec4 EvalEnvMap')) {
    throw new Error('Invalid original environment shader.');
  }
  const width = 4, height = 4;
  const data = new Float32Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    data.set([0.3 + i * 0.17, 0.4 + (i % 5) * 0.21, 0.2 + (i % 3) * 0.31], i * 3);
  }
  const { cdf, totalSum } = buildDisneyEnvironmentCdf({ width, height, data });
  const rgba = new Float32Array(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set([...data.slice(i * 3, i * 3 + 3), 1], i * 4);
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) throw new Error('WebGL2 float framebuffer unavailable.');
  const modes = gl.getExtension('OES_texture_float_linear') ? [false, true] : [false];
  const cases: { direction: number[]; random: number; rotation: number; sample: boolean; linear: boolean }[] = [];
  for (const linear of modes) for (const rotation of [-0.3, 0, 0.25, 1.2]) {
    for (const random of [0, 0.05, 0.3, 0.5, 0.75, 0.99999, 1]) {
      cases.push({ direction: [0, 0, 1], random, rotation, sample: true, linear });
    }
    for (const v of [[0.9797959, 0.2, 0], [0, -0.2, -0.9797959], [0.3, 0.4, 0.8660254], [-0.6, -0.8, 0], [0, 1, 0], [0, -1, 0]]) {
      cases.push({ direction: v, random: 0.5, rotation, sample: false, linear });
    }
  }
  const compile = (type: number, text: string) => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Cannot create environment shader.');
    gl.shaderSource(shader, text); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`Environment GLSL: ${gl.getShaderInfoLog(shader)}`);
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, `#version 300 es
void main() { vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2)); gl_Position=vec4(p*2.-1.,0.,1.); }`);
  const fragment = compile(gl.FRAGMENT_SHADER, `#version 300 es
precision highp float; precision highp int;
#define OPT_ENVMAP
#define PI 3.14159265358979323
#define TWO_PI 6.28318530717958648
#define INV_PI 0.31830988618379067
#define INV_TWO_PI 0.15915494309189534
struct Ray { vec3 direction; };
uniform sampler2D envMapTex, envMapCDFTex;
uniform vec2 envMapRes;
uniform float envMapTotalSum, envMapRot, randomValue;
uniform vec3 direction;
uniform bool sampleMode, directionOnly;
float rand() { return randomValue; }
float Luminance(vec3 c) { return 0.212671*c.x+0.715160*c.y+0.072169*c.z; }
${source}
out vec4 outColor;
void main() {
  if (sampleMode) { vec3 c; vec4 d=SampleEnvMap(c); outColor=directionOnly ? d : vec4(c,d.w); }
  else { outColor=EvalEnvMap(Ray(direction)); }
}`);
  const program = gl.createProgram(), env = gl.createTexture(), cdfTex = gl.createTexture();
  const target = gl.createTexture(), framebuffer = gl.createFramebuffer();
  if (!program || !env || !cdfTex || !target || !framebuffer) throw new Error('Cannot create environment probe resources.');
  const input = device.createBuffer({ size: (cases.length + 3) * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const output = device.createBuffer({ size: (cases.length + 3) * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readback = device.createBuffer({ size: (cases.length + 3) * 32, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const envGpu = device.createTexture({ size: [width, height], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const cdfGpu = device.createBuffer({ size: cdf.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  try {
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Environment link: ${gl.getProgramInfoLog(program)}`);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, env);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, rgba);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, cdfTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, cdf);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, target);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 1, 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Environment framebuffer incomplete.');
    gl.useProgram(program); gl.viewport(0, 0, 1, 1);
    const loc = (name: string) => {
      const location = gl.getUniformLocation(program, name);
      if (!location) throw new Error(`Missing environment uniform ${name}`);
      return location;
    };
    gl.uniform1i(loc('envMapTex'), 0); gl.uniform1i(loc('envMapCDFTex'), 1);
    gl.uniform2f(loc('envMapRes'), width, height); gl.uniform1f(loc('envMapTotalSum'), totalSum);
    const reference: number[][] = [];
    for (const item of cases) {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, env);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, item.linear ? gl.LINEAR : gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, item.linear ? gl.LINEAR : gl.NEAREST);
      gl.uniform1f(loc('envMapRot'), item.rotation); gl.uniform1f(loc('randomValue'), item.random);
      gl.uniform3fv(loc('direction'), item.direction); gl.uniform1i(loc('sampleMode'), Number(item.sample));
      gl.uniform1i(loc('directionOnly'), 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
      const color = new Float32Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, color);
      let direction: number[] = [];
      if (item.sample) {
        gl.uniform1i(loc('directionOnly'), 1); gl.drawArrays(gl.TRIANGLES, 0, 3);
        const d = new Float32Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, d); direction = [...d.slice(0, 3)];
      }
      if (gl.getError() !== gl.NO_ERROR || [...color, ...direction].some(x => !Number.isFinite(x))) {
        throw new Error(`Invalid GLSL environment output for case ${reference.length}.`);
      }
      reference.push([...color, ...direction]);
    }
    const records = cases.map(c => [...c.direction, c.random, c.rotation, Number(c.sample), Number(c.linear), totalSum]);
    records.push(
      [0, 0, 1, -0.1, 0, 1, 0, totalSum], [0, 0, 1, 0.5, 3e38, 1, 0, totalSum],
      [1e30, 0, 0, 0.5, 0, 0, 0, totalSum],
    );
    device.queue.writeBuffer(input, 0, new Float32Array(records.flat()));
    device.queue.writeBuffer(cdfGpu, 0, cdf);
    device.queue.writeTexture({ texture: envGpu }, rgba, { bytesPerRow: width * 16 }, [width, height]);
    const module = device.createShaderModule({ code: `
@group(0) @binding(0) var disneyEnvTexture: texture_2d<f32>;
@group(0) @binding(1) var<storage, read> disneyEnvCdf: array<f32>;
@group(0) @binding(2) var<storage, read> inputs: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> outputs: array<vec4f>;
${DISNEY_ENVIRONMENT_WGSL}
@compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id: vec3u) {
  let a=inputs[id.x*2u]; let b=inputs[id.x*2u+1u];
  var sample: DisneyEnvironmentSample;
  if (b.y > 0.5) { sample=disneySampleEnvironment(a.w,b.w,b.x,b.z>0.5); }
  else { sample=disneyEvalEnvironment(a.xyz,b.w,b.x,b.z>0.5); }
  outputs[id.x*2u]=vec4f(sample.color,sample.pdf);
  outputs[id.x*2u+1u]=vec4f(sample.direction,f32(sample.error));
}` });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter(m => m.type === 'error');
    if (errors.length) throw new Error(errors.map(m => m.message).join('\n'));
    const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: envGpu.createView() }, { binding: 1, resource: { buffer: cdfGpu } },
      { binding: 2, resource: { buffer: input } }, { binding: 3, resource: { buffer: output } },
    ] });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(records.length); pass.end();
    encoder.copyBufferToBuffer(output, 0, readback, 0, records.length * 32);
    device.queue.submit([encoder.finish()]); await readback.mapAsync(GPUMapMode.READ);
    const actual = Array.from(new Float32Array(readback.getMappedRange().slice(0))); readback.unmap();
    for (const [i, expected] of reference.entries()) {
      const got = actual.slice(i * 8, i * 8 + expected.length);
      // WebGL's hardware linear interpolation can quantize texture coordinates.
      const tolerance = cases[i]!.linear ? 0.003 : 0.0002;
      if (actual[i * 8 + 7] !== 0 || expected.some((x, j) =>
        !Number.isFinite(got[j]!) || Math.abs(got[j]! - x) > tolerance * Math.max(1, Math.abs(x)))) {
        throw new Error(`Disney environment case ${i}: GLSL ${expected}, WGSL ${got}, error ${actual[i * 8 + 7]}.`);
      }
    }
    for (const [i, expected] of [1, 2, 1].entries()) {
      if (actual[(cases.length + i) * 8 + 7] !== expected) {
        throw new Error(`Disney environment invalid case ${i}: expected error ${expected}.`);
      }
    }
    return cases.length;
  } finally {
    input.destroy(); output.destroy(); readback.destroy(); envGpu.destroy(); cdfGpu.destroy();
    gl.deleteFramebuffer(framebuffer); gl.deleteTexture(target); gl.deleteTexture(env); gl.deleteTexture(cdfTex);
    gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
  }
}
