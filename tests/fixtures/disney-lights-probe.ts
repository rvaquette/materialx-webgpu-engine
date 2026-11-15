import { DISNEY_LIGHTS_WGSL } from '../../src/render/pathtracing/disney-lights-wgsl.ts';

/** Compare sampling and emitter intersections with the original GLSL shaders. */
export async function runDisneyLightsProbe(
  device: GPUDevice, samplingSource: string, intersectionSource: string, closestSource: string,
): Promise<number> {
  const samplingStart = samplingSource.indexOf('vec3 UniformSampleHemisphere');
  const samplingEnd = samplingSource.indexOf('vec3 SampleHG', samplingStart);
  const closestEnd = closestSource.indexOf('#if defined(OPT_RAYMARCHING)');
  if (samplingStart < 0 || samplingEnd < 0 || closestEnd < 0 ||
      !intersectionSource.includes('float RectIntersect') || !closestSource.includes('// Intersect Emitters')) {
    throw new Error('Invalid original light shaders.');
  }
  const sampling = samplingSource.slice(samplingStart, samplingEnd);
  const closest = closestSource.slice(0, closestEnd) + '\nstate.hitDist = t; return state.isEmitter;\n}';
  const rect = [[-1, 1, 2], [3, 2, 1], [2, 0, 0], [0, -2, 0], 0, 4, 0] as const;
  const sphere = [[0, 0, 3], [1, 3, 2], [0, 0, 0], [0, 0, 0], 0.6, 4 * Math.PI * 0.6 ** 2, 1] as const;
  const distant = [[0, 0, 4], [2, 1, 0.5], [0, 0, 0], [0, 0, 0], 0, 0, 2] as const;
  type Light = typeof rect | typeof sphere | typeof distant;
  const cases: { light: Light; origin: number[]; direction: number[]; random: number[]; sample: boolean }[] = [];
  for (const light of [rect, sphere, distant]) {
    for (const origin of [[0, 0, 0], [1, -0.5, 0.3], [-2, 1, -1]]) {
      for (const random of [[0, 0], [0.35, 0.7], [0.5, 0.5], [0.9, 0.1], [1, 1]]) {
        cases.push({ light, origin, direction: [0, 0, 1], random, sample: true });
      }
    }
  }
  for (const light of [rect, sphere, distant]) {
    for (const [origin, direction] of [
      [[0, 0, 0], [0, 0, 1]], [[0, 0, 4], [0, 0, -1]],
      [[3, 0, 0], [0, 0, 1]], [[0.2, 0.1, 0], [0, 0, 1]],
      [[0, 0, 3], [0, 0, 1]],
    ]) cases.push({ light, origin: origin!, direction: direction!, random: [0.3, 0.7], sample: false });
  }
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) throw new Error('WebGL2 float framebuffer unavailable.');
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Cannot create light reference shader.');
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`Light GLSL: ${gl.getShaderInfoLog(shader)}`);
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, `#version 300 es
void main() { vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2)); gl_Position=vec4(p*2.-1.,0.,1.); }`);
  const fragment = compile(gl.FRAGMENT_SHADER, `#version 300 es
precision highp float; precision highp int;
#define OPT_LIGHTS
#define PI 3.14159265358979323
#define TWO_PI 6.28318530717958648
#define INF 1000000.0
#define EPS 0.0003
#define QUAD_LIGHT 0
#define SPHERE_LIGHT 1
struct Light { vec3 position, emission, u, v; float radius, area, type; };
struct LightSampleRec { vec3 normal, emission, direction; float dist, pdf; };
struct Ray { vec3 origin, direction; };
struct State { bool isEmitter; float hitDist; int depth; };
uniform vec4 data[6];
uniform sampler2D lightsTex;
uniform int numOfLights, part;
int randomIndex=0;
float rand() { return randomIndex++ == 0 ? data[3].w : data[4].w; }
vec4 texelFetch1D(sampler2D tex, int i) { return texelFetch(tex, ivec2(i,0), 0); }
${sampling}
${intersectionSource}
${closest}
out vec4 outColor;
void main() {
  Light light=Light(data[0].xyz,data[1].xyz,data[2].xyz,data[3].xyz,data[2].w,data[1].w,data[0].w);
  LightSampleRec result=LightSampleRec(vec3(0),vec3(0),vec3(0),0.,0.);
  bool hit=false;
  if (data[5].w > 0.5) SampleOneLight(light,data[4].xyz,result);
  else {
    State state=State(false,0.,0);
    hit=ClosestHit(Ray(data[4].xyz,data[5].xyz),state,result);
    result.dist=state.hitDist;
  }
  if (part==0) outColor=vec4(result.direction,result.dist);
  else if (part==1) outColor=vec4(result.normal,result.pdf);
  else outColor=vec4(result.emission,float(hit));
}`);
  const program = gl.createProgram(), target = gl.createTexture(), framebuffer = gl.createFramebuffer(), lights = gl.createTexture();
  if (!program || !target || !framebuffer || !lights) throw new Error('Cannot create light probe resources.');
  const size = (cases.length + 11) * 48;
  const output = device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readback = device.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  try {
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Light GLSL link: ${gl.getProgramInfoLog(program)}`);
    gl.bindTexture(gl.TEXTURE_2D, target); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 1, 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Light framebuffer incomplete.');
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, lights);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.useProgram(program); gl.viewport(0, 0, 1, 1);
    const loc = (name: string) => {
      const location = gl.getUniformLocation(program, name);
      if (!location) throw new Error(`Missing light uniform ${name}`);
      return location;
    };
    gl.uniform1i(loc('lightsTex'), 0);
    const records: number[][] = [], reference: number[][] = [];
    for (const c of cases) {
      const [position, emission, u, v, radius, area, type] = c.light;
      const record = [...position, type, ...emission, area, ...u, radius, ...v, c.random[0]!,
        ...c.origin, c.random[1]!, ...c.direction, Number(c.sample)];
      records.push(record);
      gl.uniform4fv(loc('data[0]'), new Float32Array(record));
      gl.uniform1i(loc('numOfLights'), c.sample ? 3 : 1);
      const texels = new Float32Array([...position, 0, ...emission, 0, ...u, 0, ...v, 0, radius, area, type, 0]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 5, 1, 0, gl.RGBA, gl.FLOAT, texels);
      const result: number[] = [];
      for (let part = 0; part < 3; part++) {
        gl.uniform1i(loc('part'), part); gl.drawArrays(gl.TRIANGLES, 0, 3);
        const values = new Float32Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, values);
        result.push(...values);
      }
      if (gl.getError() !== gl.NO_ERROR || result.some(x => !Number.isFinite(x))) {
        throw new Error(`Invalid GLSL light output for case ${reference.length}.`);
      }
      reference.push(result);
    }
    const invalid = [...records[0]!]; invalid[8] = 0; invalid[9] = 0; invalid[10] = 0;
    const selection = [...records[0]!]; selection[23] = 2; selection[19] = 1; selection[7] = 3;
    const emptySelection = [...selection]; emptySelection[7] = 0; emptySelection[19] = 0.5;
    const selections = [0, 0.34, 0.99].map(value => {
      const record = [...selection]; record[19] = value; return record;
    });
    const zeroDistance = [...records[0]!]; zeroDistance.splice(16, 3, -1, 1, 2); zeroDistance[15] = 0; zeroDistance[19] = 0;
    const nonUnit = [...records[0]!]; nonUnit.splice(20, 4, 0, 0, 2, 0);
    const shadowFront = [...records[0]!]; shadowFront.splice(16, 3, 0, 0, 0); shadowFront.splice(20, 4, 0, 0, 1, 3);
    const shadowBack = [...shadowFront]; shadowBack.splice(16, 3, 0, 0, 4); shadowBack.splice(20, 3, 0, 0, -1);
    const shadowMiss = [...shadowBack]; shadowMiss[16] = 5;
    records.push(invalid, selection, zeroDistance, nonUnit, emptySelection, ...selections, shadowFront, shadowBack, shadowMiss);
    const inputData = new Float32Array((cases.length + 11) * 24);
    inputData.set(records.flat());
    // Input records contain twice as many floats as the three-vec4 output records.
    const fullInput = device.createBuffer({ size: inputData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    try {
      device.queue.writeBuffer(fullInput, 0, inputData);
      const module = device.createShaderModule({ code: `
@group(0) @binding(0) var<storage, read> inputs: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> outputs: array<vec4f>;
${DISNEY_LIGHTS_WGSL}
@compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id: vec3u) {
  let base=id.x*6u; let a=inputs[base]; let b=inputs[base+1u]; let c=inputs[base+2u];
  let d=inputs[base+3u]; let e=inputs[base+4u]; let f=inputs[base+5u];
  let light=DisneyLight(a.xyz,b.xyz,c.xyz,d.xyz,c.w,b.w,u32(a.w));
  if (f.w > 2.5) {
    let h=disneyIntersectLight(light,e.xyz,f.xyz,1000000.0,true);
    outputs[id.x*3u]=vec4f(0); outputs[id.x*3u+1u]=vec4f(0);
    outputs[id.x*3u+2u]=vec4f(0,0,0,select(0.0,1.0,h.hit)+f32(h.error)*2.0);
  } else if (f.w > 1.5) {
    let s=disneySelectLight(e.w,u32(b.w));
    outputs[id.x*3u]=vec4f(f32(s.index),0,0,0);
    outputs[id.x*3u+1u]=vec4f(0); outputs[id.x*3u+2u]=vec4f(0,0,0,f32(s.error));
  } else if (f.w > 0.5) {
    let s=disneySampleLight(light,e.xyz,vec2f(d.w,e.w),3u);
    outputs[id.x*3u]=vec4f(s.direction,s.distance);
    outputs[id.x*3u+1u]=vec4f(s.normal,s.pdf);
    outputs[id.x*3u+2u]=vec4f(s.emission,f32(s.error));
  } else {
    let h=disneyIntersectLight(light,e.xyz,f.xyz,1000000.0,false);
    outputs[id.x*3u]=vec4f(0,0,0,h.distance);
    outputs[id.x*3u+1u]=vec4f(0,0,0,h.pdf);
    outputs[id.x*3u+2u]=vec4f(h.emission,select(0.0,1.0,h.hit)+f32(h.error)*2.0);
  }
}` });
      const info = await module.getCompilationInfo();
      const errors = info.messages.filter(m => m.type === 'error');
      if (errors.length) throw new Error(errors.map(m => m.message).join('\n'));
      const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
      const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: fullInput } }, { binding: 1, resource: { buffer: output } },
      ] });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(records.length); pass.end(); encoder.copyBufferToBuffer(output, 0, readback, 0, size);
      device.queue.submit([encoder.finish()]); await readback.mapAsync(GPUMapMode.READ);
      const actual = Array.from(new Float32Array(readback.getMappedRange().slice(0))); readback.unmap();
      for (const [i, expected] of reference.entries()) {
        const got = actual.slice(i * 12, i * 12 + 12);
        if (expected.some((x, j) => !Number.isFinite(got[j]!) || Math.abs(got[j]! - x) > 0.0002 * Math.max(1, Math.abs(x)))) {
          throw new Error(`Disney light case ${i}: GLSL ${expected}, WGSL ${got}.`);
        }
      }
      for (const [i, error] of [1, 1, 2, 2, 1].entries()) {
        if (actual[(cases.length + i) * 12 + 11] !== error) throw new Error(`Disney light invalid case ${i}: expected ${error}.`);
      }
      for (let i = 0; i < selections.length; i++) {
        const base = (cases.length + 5 + i) * 12;
        if (actual[base] !== i || actual[base + 11] !== 0) throw new Error(`Disney light selection ${i} failed.`);
      }
      for (const [i, expected] of [1, 1, 0].entries()) {
        if (actual[(cases.length + 8 + i) * 12 + 11] !== expected) {
          throw new Error(`Disney two-sided shadow case ${i} failed.`);
        }
      }
    } finally { fullInput.destroy(); }
    return cases.length;
  } finally {
    output.destroy(); readback.destroy();
    gl.deleteFramebuffer(framebuffer); gl.deleteTexture(target); gl.deleteTexture(lights);
    gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
  }
}
