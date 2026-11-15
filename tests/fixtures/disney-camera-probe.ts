import { DISNEY_CAMERA_WGSL } from '../../src/render/pathtracing/disney-camera-wgsl.ts';

/** Compare the port with the original GLSL tile camera and RNG on WebGL2. */
export async function runDisneyCameraProbe(device: GPUDevice, tileSource: string, globalsSource: string): Promise<number> {
  const rngStart = globalsSource.indexOf('//internal RNG state');
  const rngEnd = globalsSource.indexOf('vec3 FaceForward', rngStart);
  const mainStart = tileSource.indexOf('void main(void)');
  const mainEnd = tileSource.indexOf('vec4 accumColor', mainStart);
  if (rngStart < 0 || rngEnd < 0 || mainStart < 0 || mainEnd < 0) throw new Error('Invalid original camera shader source.');
  const rng = globalsSource.slice(rngStart, rngEnd);
  const cameraMain = tileSource.slice(mainStart, mainEnd).replace('gl_FragCoord.xy', 'fragCoord');
  const cases: number[][] = [];
  for (const [width, height] of [[128, 128], [120, 80], [64, 32]]) {
    for (const [x, y] of [[0, 0], [1, 2], [31, 17], [63, 31]]) {
      for (const frame of [1, 83, 1234567]) {
        for (const aperture of [0, 0.1]) {
          for (const rotated of [false, true]) {
            for (const tile of [[0, 0, 0.25, 0.5], [0.25, 0.5, 0.5, 0.5]]) {
              cases.push([
                x!, y!, frame, 64, 32, width!, height!, 0.7, ...tile,
                0.5, 1, 3, 2,
                ...(rotated ? [0, 0, -1] : [1, 0, 0]), aperture,
                0, 1, 0, 0,
                ...(rotated ? [-1, 0, 0] : [0, 0, -1]), 0,
              ]);
            }
          }
        }
      }
    }
  }
  const referenceCount = cases.length;
  const invalidFov = [...cases[0]!]; invalidFov[7] = 0; cases.push(invalidFov);
  const invalidPixel = [...cases[0]!]; invalidPixel[0] = 64; cases.push(invalidPixel);
  const invalidDirection = [...cases[0]!];
  invalidDirection.splice(16, 3, 0, 0, 0); invalidDirection.splice(20, 3, 0, 0, 0); invalidDirection.splice(24, 3, 0, 0, 0);
  cases.push(invalidDirection);
  const overflowDirection = [...cases[0]!]; overflowDirection[24] = 1e30; cases.push(overflowDirection);
  const orthographicStart = cases.length;
  for (const [x, y] of [[0, 0], [31, 17], [63, 31]]) {
    const orthographic = [...cases[0]!];
    orthographic[0] = x!;
    orthographic[1] = y!;
    orthographic[19] = 0;
    orthographic[27] = 1;
    cases.push(orthographic);
  }

  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) throw new Error('WebGL2 floating-point framebuffer unavailable.');
  const vertexSource = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
  const fragmentSource = `#version 300 es
precision highp float;
precision highp int;
#define TWO_PI 6.28318530717958648
struct Camera { vec3 position, right, up, forward; float fov, focalDist, aperture; };
struct Ray { vec3 origin, direction; };
uniform Camera camera;
uniform vec2 fragCoord, TexCoords, tileOffset, invNumTiles, resolution;
uniform int frameNum;
uniform bool outputOrigin;
out vec4 color;
${rng}
${cameraMain}
    color = outputOrigin ? vec4(ray.origin, 1.0) : vec4(ray.direction, rand());
}`;
  const compile = (type: number, source: string): WebGLShader => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Unable to allocate camera reference shader.');
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader); gl.deleteShader(shader);
      throw new Error(`Camera reference GLSL failed: ${log}`);
    }
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  const target = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  if (!program || !target || !framebuffer) throw new Error('Unable to allocate camera reference framebuffer.');
  const input = device.createBuffer({ size: cases.length * 28 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const output = device.createBuffer({ size: cases.length * 8 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readback = device.createBuffer({ size: cases.length * 8 * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  try {
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Camera reference link failed: ${gl.getProgramInfoLog(program)}`);
    gl.bindTexture(gl.TEXTURE_2D, target); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 1, 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Camera reference framebuffer incomplete.');
    gl.useProgram(program); gl.viewport(0, 0, 1, 1);
    const location = (name: string): WebGLUniformLocation => {
      const found = gl.getUniformLocation(program, name);
      if (!found) throw new Error(`Missing camera reference uniform ${name}.`);
      return found;
    };
    const ref: number[][] = [];
    for (const item of cases.slice(0, referenceCount)) {
      const [x, y, frame, tw, th, width, height, fov] = item;
      gl.uniform2f(location('fragCoord'), x! + 0.5, y! + 0.5);
      gl.uniform2f(location('TexCoords'), (x! + 0.5) / tw!, (y! + 0.5) / th!);
      gl.uniform2f(location('resolution'), width!, height!);
      gl.uniform2f(location('tileOffset'), item[8]!, item[9]!);
      gl.uniform2f(location('invNumTiles'), item[10]!, item[11]!);
      gl.uniform1i(location('frameNum'), frame!);
      gl.uniform3fv(location('camera.position'), item.slice(12, 15));
      gl.uniform1f(location('camera.focalDist'), item[15]!);
      gl.uniform3fv(location('camera.right'), item.slice(16, 19));
      gl.uniform1f(location('camera.aperture'), item[19]!);
      gl.uniform3fv(location('camera.up'), item.slice(20, 23));
      gl.uniform3fv(location('camera.forward'), item.slice(24, 27));
      gl.uniform1f(location('camera.fov'), fov!);
      gl.uniform1i(location('outputOrigin'), 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
      const direction = new Float32Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, direction);
      gl.uniform1i(location('outputOrigin'), 1); gl.drawArrays(gl.TRIANGLES, 0, 3);
      const origin = new Float32Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, origin);
      if (gl.getError() !== gl.NO_ERROR || [...direction, ...origin].some(v => !Number.isFinite(v))) {
        throw new Error(`Invalid GLSL camera output for case ${ref.length}.`);
      }
      ref.push([...direction, ...origin.slice(0, 3)]);
    }
    device.queue.writeBuffer(input, 0, new Float32Array(cases.flat()));
    const module = device.createShaderModule({ code: /* wgsl */ `
@group(0) @binding(0) var<storage, read> inputs: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> outputs: array<vec4f>;
${DISNEY_CAMERA_WGSL}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let base=id.x*7u;
  let a=inputs[base]; let b=inputs[base+1u]; let tile=inputs[base+2u];
  let pos=inputs[base+3u]; let right=inputs[base+4u]; let up=inputs[base+5u]; let forward=inputs[base+6u];
  let pixel=vec2u(a.xy);
  var seed=disneyInitRng(pixel, u32(a.z));
  let camera=DisneyCamera(pos.xyz,right.xyz,up.xyz,forward.xyz,b.w,pos.w,right.w,forward.w>0.5);
  let ray=disneyCameraRay(camera,pixel,vec2u(vec2f(a.w,b.x)),vec2u(b.yz),tile.xy,tile.zw,&seed);
  let next=disneyRandom(&seed);
  outputs[id.x*2u]=vec4f(ray.direction,next);
  outputs[id.x*2u+1u]=vec4f(ray.origin,f32(ray.error));
}` });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter(message => message.type === 'error');
    if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
    const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: input } }, { binding: 1, resource: { buffer: output } },
    ] });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(cases.length); pass.end();
    encoder.copyBufferToBuffer(output, 0, readback, 0, cases.length * 8 * 4);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const actual = Array.from(new Float32Array(readback.getMappedRange().slice(0))); readback.unmap();
    for (const [i, expected] of ref.entries()) {
      const got = actual.slice(i * 8, i * 8 + 7);
      if (actual[i * 8 + 7] !== 0 || expected.some((x, j) =>
        !Number.isFinite(got[j]!) || (j === 3 ? got[j] !== x : Math.abs(got[j]! - x) > 0.00002))) {
        throw new Error(`Disney camera case ${i}: GLSL ${expected}, WGSL ${got}, error ${actual[i * 8 + 7]}.`);
      }
    }
    for (const [i, error] of [1, 1, 2, 2].entries()) {
      if (actual[(referenceCount + i) * 8 + 7] !== error) throw new Error(`Disney camera invalid case ${i}: expected error ${error}.`);
    }
    const orthographicDirections = cases.slice(orthographicStart).map((_, i) => {
      const base = (orthographicStart + i) * 8;
      const ray = actual.slice(base, base + 7);
      if (actual[base + 7] !== 0 || ray.some(value => !Number.isFinite(value)) ||
          ray.slice(0, 3).some((value, axis) => Math.abs(value - [0, 0, -1][axis]!) > 1e-6)) {
        throw new Error(`Disney orthographic camera ray ${i} is invalid: ${ray}.`);
      }
      return ray.slice(4, 7);
    });
    if (orthographicDirections.every(origin => origin.every((value, axis) => value === [0.5, 1, 3][axis]))) {
      throw new Error('Disney orthographic camera did not offset rays across the image plane.');
    }
    return referenceCount;
  } finally {
    input.destroy(); output.destroy(); readback.destroy();
    gl.deleteFramebuffer(framebuffer); gl.deleteTexture(target); gl.deleteProgram(program);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
  }
}
