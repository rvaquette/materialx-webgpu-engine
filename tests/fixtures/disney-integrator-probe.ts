import { buildTlas } from '../../src/geometry/bvh.ts';
import { buildGeometry, type SceneResources } from '../../src/render/scene-resources.ts';
import { IDENTITY4, translation4 } from '../../src/scene/transforms.ts';
import { buildDisneyAcceleration } from '../../src/render/pathtracing/disney-acceleration.ts';
import { packDisneyGeometryTextures, uploadDisneyGeometryTextures } from '../../src/render/pathtracing/disney-geometry-textures.ts';
import { packDisneyMaterials, uploadDisneyMaterials, type DisneyMaterial } from '../../src/render/pathtracing/disney-material.ts';
import { DISNEY_CAMERA_WGSL } from '../../src/render/pathtracing/disney-camera-wgsl.ts';
import { DISNEY_TRAVERSAL_WGSL } from '../../src/render/pathtracing/disney-traversal-wgsl.ts';
import { DISNEY_SURFACE_WGSL } from '../../src/render/pathtracing/disney-surface-wgsl.ts';
import { DISNEY_MATERIAL_WGSL } from '../../src/render/pathtracing/disney-material-wgsl.ts';
import { DISNEY_ALPHA_WGSL } from '../../src/render/pathtracing/disney-alpha-wgsl.ts';
import { DISNEY_BSDF_WGSL } from '../../src/render/pathtracing/disney-bsdf-wgsl.ts';
import { DISNEY_ENVIRONMENT_WGSL } from '../../src/render/pathtracing/disney-environment-wgsl.ts';
import { DISNEY_LIGHTS_WGSL } from '../../src/render/pathtracing/disney-lights-wgsl.ts';
import { DISNEY_INTEGRATOR_WGSL } from '../../src/render/pathtracing/disney-integrator-wgsl.ts';
import { DISNEY_RENDER_WGSL, DISNEY_RENDER_PIXEL_BYTES, packDisneyRenderSettings, type DisneyRenderSettings } from '../../src/render/pathtracing/disney-render.ts';
import { DisneyGpuBackend } from '../../src/render/pathtracing/disney-gpu-backend.ts';
import { DisneyTextureRegistry } from '../../src/render/pathtracing/disney-texture-array.ts';

/** Compare uniform-environment, alpha and medium paths with GLSL. */
export async function runDisneyIntegratorProbe(
  device: GPUDevice, globals: string, sampling: string, disney: string, pathtrace: string, environment: string,
): Promise<number> {
  const structsStart = globals.indexOf('struct Ray');
  const structsEnd = globals.indexOf('// Scene material ID');
  const rngStart = globals.indexOf('//internal RNG state');
  const rngEnd = globals.indexOf('vec3 FaceForward', rngStart);
  if ([structsStart, structsEnd, rngStart, rngEnd].some(i => i < 0) ||
      !pathtrace.includes('vec4 PathTrace') || !environment.includes('vec4 SampleEnvMap')) {
    throw new Error('Invalid original path-tracing shaders.');
  }
  const material: DisneyMaterial = {
    baseColor: [0.8, 0.3, 0.1], anisotropic: 0.2, emission: [0.1, 0.2, 0.3],
    metallic: 0.1, roughness: 0.4, subsurface: 0.1, specularTint: 0.2, sheen: 0.1,
    sheenTint: 0.5, clearcoat: 0.2, clearcoatGloss: 0.5, specTrans: 0, ior: 1.5,
    mediumType: 0, mediumDensity: 0, mediumColor: [1, 1, 1], mediumAnisotropy: 0,
    textures: [-1, -1, -1, -1], opacity: 1, alphaMode: 0, alphaCutoff: 0,
  };
  const geometry = buildGeometry('triangle', '/Triangle', {
    positions: new Float32Array([-4, -4, 0, 4, -4, 0, 0, 4, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 0.5, 1]), indices: new Uint32Array([0, 1, 2]),
    attributes: new Map(), subsets: [], subdivision: { scheme: 'none', level: 0, applied: false },
    displacement: { required: false },
  });
  const resources: SceneResources = {
    geometries: new Map([['triangle', geometry]]), materials: new Map(),
    instances: [
      { id: 'a', primPath: '/A', prototypeId: 'triangle', transform: IDENTITY4, hasGeometry: true },
      { id: 'b', primPath: '/B', prototypeId: 'triangle', transform: translation4(10, 0, 0), hasGeometry: true },
      { id: 'c', primPath: '/C', prototypeId: 'triangle', transform: translation4(20, 0, 0), hasGeometry: true },
      { id: 'd', primPath: '/D', prototypeId: 'triangle', transform: translation4(30, 0, 0), hasGeometry: true },
      { id: 'e', primPath: '/E', prototypeId: 'triangle', transform: translation4(30, 0, -1), hasGeometry: true },
      { id: 'f', primPath: '/F', prototypeId: 'triangle', transform: translation4(40, 0, 0), hasGeometry: true },
      { id: 'g', primPath: '/G', prototypeId: 'triangle', transform: translation4(40, 0, -1), hasGeometry: true },
      { id: 'h', primPath: '/H', prototypeId: 'triangle', transform: translation4(50, 0, 0), hasGeometry: true },
      { id: 'i', primPath: '/I', prototypeId: 'triangle', transform: translation4(50, 0, -1), hasGeometry: true },
    ],
    tlas: buildTlas([]), pendingGeometry: [], pendingMaterials: [], unboundGprims: [],
  };
  const packed = packDisneyGeometryTextures(buildDisneyAcceleration(resources), [0, 1, 2, 3, 3, 4, 4, 5, 5]);
  const textures = uploadDisneyGeometryTextures(device, packed);
  const materialList: DisneyMaterial[] = [
    material, { ...material, opacity: 0.2, alphaMode: 2, alphaCutoff: 0.5 },
    { ...material, opacity: 0.35, alphaMode: 1 },
    { ...material, emission: [0, 0, 0], metallic: 0, specTrans: 1, mediumType: 1, mediumDensity: 0.6, mediumColor: [0.2, 0.5, 0.8] },
    { ...material, emission: [0, 0, 0], metallic: 0, specTrans: 1, mediumType: 3, mediumDensity: 0.6, mediumColor: [0.2, 0.5, 0.8] },
    { ...material, emission: [0, 0, 0], metallic: 0, specTrans: 1, mediumType: 2,
      mediumDensity: 1.5, mediumColor: [0.2, 0.5, 0.8], mediumAnisotropy: 0.3 },
  ];
  const materials = uploadDisneyMaterials(device, materialList, 0);
  const maps = device.createTexture({ size: [1, 1, 1], format: 'rgba8uint', usage: GPUTextureUsage.TEXTURE_BINDING });
  const env = device.createTexture({ size: [4, 4], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const envCdf = device.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const lights = device.createBuffer({ size: 160, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const cases: { x: number; frame: number; depth: number }[] = [];
  for (const x of [0, 6, 10, 20, 30, 40, 50]) for (const depth of [0, 1, 3]) for (let frame = 1; frame <= 16; frame++) {
    cases.push({ x, frame, depth });
  }
  const volumeCases = Array.from({ length: 32 }, (_, i) => i + 1);
  const environmentCases = Array.from({ length: 32 }, (_, i) => i + 1);
  const transmittanceCases = [0, 10, 20, 30, 40, 50].flatMap(x =>
    Array.from({ length: 8 }, (_, i) => ({ x, frame: i + 1 })));
  const count = cases.length + 6 + volumeCases.length + transmittanceCases.length + environmentCases.length;
  const inputs = device.createBuffer({ size: count * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const output = device.createBuffer({ size: count * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readback = device.createBuffer({ size: count * 32, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) throw new Error('WebGL2 float framebuffer unavailable.');
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Cannot create reference path shader.');
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`Path GLSL: ${gl.getShaderInfoLog(shader)}`);
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, `#version 300 es
void main() { vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2)); gl_Position=vec4(p*2.-1.,0.,1.); }`);
  const closest = `
bool ClosestHit(Ray r, inout State state, inout LightSampleRec lightSample) {
  if (r.direction.z == 0.0) return false;
  float center = originX >= 45.0 ? 50.0 : (originX >= 35.0 ? 40.0 : (originX >= 25.0 ? 30.0 :
    (originX >= 15.0 ? 20.0 : (originX >= 5.0 ? 10.0 : 0.0))));
  float t=-r.origin.z/r.direction.z;
  if (center >= 30.0) {
    float lower=(-1.0-r.origin.z)/r.direction.z;
    if (t <= 0.0 || (lower > 0.0 && lower < t)) t=lower;
  }
  vec3 p=r.origin+t*r.direction;
  float u=(p.x-center+4.0-(p.y+4.0)*0.5)/8.0;
  float v=(p.y+4.0)/8.0;
  if (t <= 0.0 || u < 0.0 || v < 0.0 || u+v > 1.0) return false;
  state.hitDist=t; state.fhp=p; state.isEmitter=false;
  state.matID=center==50.0?5:(center==40.0?4:(center==30.0?3:(center==20.0?2:(center==10.0?1:0))));
  state.normal=vec3(0,0,1); state.ffnormal=dot(state.normal,r.direction)<=0.0?state.normal:-state.normal;
  state.texCoord=vec2(u+v*0.5,v); state.tangent=vec3(1,0,0); state.bitangent=vec3(0,1,0);
  return true;
}`;
  const fragmentSource = `#version 300 es
precision highp float; precision highp int; precision highp sampler2DArray;
#define OPT_SHADERTOY
#define OPT_UNIFORM_LIGHT
#define OPT_RR
#define OPT_RR_DEPTH 0
#define OPT_ALPHA_TEST
#define OPT_MEDIUM
#define MATERIALS_TEX_STRIDE 8
#define PI 3.14159265358979323
#define INV_PI 0.31830988618379067
#define TWO_PI 6.28318530717958648
#define INV_4_PI 0.07957747154594766
#define EPS 0.0003
#define INF 1000000.0
#define QUAD_LIGHT 0
#define SPHERE_LIGHT 1
#define ALPHA_MODE_BLEND 1
#define ALPHA_MODE_MASK 2
#define MEDIUM_NONE 0
#define MEDIUM_ABSORB 1
#define MEDIUM_EMISSIVE 3
${globals.slice(structsStart, structsEnd)}
${globals.slice(rngStart, rngEnd)}
float Luminance(vec3 c) { return 0.212671*c.x+0.715160*c.y+0.072169*c.z; }
uniform int frameNum, maxDepth;
uniform float originX;
uniform bool rngOnly;
uniform vec3 uniformLightCol;
uniform sampler2D materialsTex;
uniform sampler2D lightsTex;
uniform sampler2DArray textureMapsArrayTex;
uniform int numOfLights;
${sampling}
${disney}
${closest}
bool AnyHit(Ray r, float maxDist) { return false; }
${pathtrace}
out vec4 outColor;
void main() {
  InitRNG(vec2(7,11),frameNum);
  vec4 value=PathTrace(Ray(vec3(originX,0,2),vec3(0,0,-1)));
  outColor=rngOnly?vec4(rand(),0,0,0):value;
}`;
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  const emitterClosest = `
bool ClosestHit(Ray r, inout State state, inout LightSampleRec lightSample) {
  vec3 offset=vec3(6,0,1)-r.origin;
  float b=dot(offset,r.direction), d=b*b-dot(offset,offset)+0.4*0.4;
  if (d < 0.0) return false;
  float t=b-sqrt(d);
  if (t <= 0.001) t=b+sqrt(d);
  if (t <= 0.001) return false;
  vec3 n=normalize(r.origin+t*r.direction-vec3(6,0,1));
  lightSample.pdf=t*t/(4.0*PI*0.4*0.4*dot(-r.direction,n)*0.5);
  lightSample.emission=vec3(5,4,3);
  state.isEmitter=true; state.hitDist=t;
  return true;
}`;
  const emitterFragment = compile(gl.FRAGMENT_SHADER,
    fragmentSource.replace('#define OPT_UNIFORM_LIGHT', '#define OPT_UNIFORM_LIGHT\n#define OPT_LIGHTS').replace(closest, emitterClosest));
  const volumeFragment = compile(gl.FRAGMENT_SHADER,
    fragmentSource
      .replace('#define OPT_UNIFORM_LIGHT', '#define OPT_UNIFORM_LIGHT\n#define OPT_LIGHTS\n#define OPT_VOL_MIS')
      .replace('uniform bool rngOnly;', 'uniform bool rngOnly, transmittanceOnly;')
      .replace('vec4 value=PathTrace(Ray(vec3(originX,0,2),vec3(0,0,-1)));',
        'vec4 value=transmittanceOnly ? vec4(EvalTransmittance(Ray(vec3(originX,0,-2),vec3(0,0,1))),1.0) : PathTrace(Ray(vec3(originX,0,2),vec3(0,0,-1)));'));
  const environmentFragment = compile(gl.FRAGMENT_SHADER,
    fragmentSource
      .replace('#define OPT_UNIFORM_LIGHT', '#define OPT_ENVMAP\n#define OPT_VOL_MIS\n#define INV_TWO_PI 0.15915494309189534')
      .replace('uniform sampler2D lightsTex;', `uniform sampler2D lightsTex, envMapTex, envMapCDFTex;
uniform vec2 envMapRes;
uniform float envMapTotalSum, envMapRot, envMapIntensity;`)
      .replace(pathtrace, `${environment}\n${pathtrace}`));
  const program = gl.createProgram(), target = gl.createTexture(), framebuffer = gl.createFramebuffer(), matTex = gl.createTexture();
  const emitterProgram = gl.createProgram(), volumeProgram = gl.createProgram(), environmentProgram = gl.createProgram();
  const mapTex = gl.createTexture(), lightTex = gl.createTexture(), envTex = gl.createTexture(), cdfTex = gl.createTexture();
  if (!program || !emitterProgram || !volumeProgram || !environmentProgram || !target || !framebuffer ||
      !matTex || !mapTex || !lightTex || !envTex || !cdfTex) throw new Error('Cannot create reference path resources.');
  try {
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Path GLSL link: ${gl.getProgramInfoLog(program)}`);
    gl.bindTexture(gl.TEXTURE_2D, target); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 1, 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Path framebuffer incomplete.');
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, matTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 48, 1, 0, gl.RGBA, gl.FLOAT, packDisneyMaterials(materialList));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D_ARRAY, mapTex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, 1, 1, 1);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.useProgram(program); gl.viewport(0, 0, 1, 1);
    const loc = (name: string) => {
      const location = gl.getUniformLocation(program, name);
      if (!location) throw new Error(`Missing path uniform ${name}`);
      return location;
    };
    gl.uniform1i(loc('materialsTex'), 0); gl.uniform1i(loc('textureMapsArrayTex'), 1);
    gl.uniform3f(loc('uniformLightCol'), 0.6, 0.8, 1.2);
    const reference: number[][] = [];
    for (const c of cases) {
      gl.uniform1i(loc('frameNum'), c.frame); gl.uniform1i(loc('maxDepth'), c.depth); gl.uniform1f(loc('originX'), c.x);
      gl.uniform1i(loc('rngOnly'), 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
      const value = new Float32Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, value);
      gl.uniform1i(loc('rngOnly'), 1); gl.drawArrays(gl.TRIANGLES, 0, 3);
      const next = new Float32Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, next);
      if (gl.getError() !== gl.NO_ERROR || [...value, next[0]!].some(x => !Number.isFinite(x))) throw new Error('Invalid reference path output.');
      reference.push([...value, next[0]!]);
    }
    const data = cases.map(c => [c.x, c.frame, c.depth, 0]);
    gl.attachShader(emitterProgram, vertex); gl.attachShader(emitterProgram, emitterFragment); gl.linkProgram(emitterProgram);
    if (!gl.getProgramParameter(emitterProgram, gl.LINK_STATUS)) throw new Error(`Emitter GLSL link: ${gl.getProgramInfoLog(emitterProgram)}`);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, lightTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 5, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array(20));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.useProgram(emitterProgram);
    const emitterLoc = (name: string) => {
      const location = gl.getUniformLocation(emitterProgram, name);
      if (!location) throw new Error(`Missing emitter uniform ${name}`);
      return location;
    };
    gl.uniform1i(emitterLoc('materialsTex'), 0); gl.uniform1i(emitterLoc('textureMapsArrayTex'), 1);
    gl.uniform1i(emitterLoc('lightsTex'), 2); gl.uniform1i(emitterLoc('numOfLights'), 1);
    gl.uniform3f(emitterLoc('uniformLightCol'), 0.6, 0.8, 1.2);
    gl.uniform1i(emitterLoc('frameNum'), 4); gl.uniform1i(emitterLoc('maxDepth'), 1);
    gl.uniform1f(emitterLoc('originX'), 6); gl.uniform1i(emitterLoc('rngOnly'), 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
    const emitterColor = new Float32Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, emitterColor);
    gl.uniform1i(emitterLoc('rngOnly'), 1); gl.drawArrays(gl.TRIANGLES, 0, 3);
    const emitterNext = new Float32Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, emitterNext);
    if (gl.getError() !== gl.NO_ERROR || [...emitterColor, emitterNext[0]!].some(x => !Number.isFinite(x))) {
      throw new Error('Invalid emitter reference output.');
    }
    gl.attachShader(volumeProgram, vertex); gl.attachShader(volumeProgram, volumeFragment); gl.linkProgram(volumeProgram);
    if (!gl.getProgramParameter(volumeProgram, gl.LINK_STATUS)) throw new Error(`Volume GLSL link: ${gl.getProgramInfoLog(volumeProgram)}`);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, lightTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 5, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array([
      0, 0, 100, 0, 2, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0,
    ]));
    gl.useProgram(volumeProgram);
    const volumeLoc = (name: string) => {
      const location = gl.getUniformLocation(volumeProgram, name);
      if (!location) throw new Error(`Missing volume uniform ${name}`);
      return location;
    };
    gl.uniform1i(volumeLoc('materialsTex'), 0); gl.uniform1i(volumeLoc('textureMapsArrayTex'), 1);
    gl.uniform1i(volumeLoc('lightsTex'), 2); gl.uniform1i(volumeLoc('numOfLights'), 1);
    gl.uniform3f(volumeLoc('uniformLightCol'), 0, 0, 0); gl.uniform1i(volumeLoc('maxDepth'), 3);
    gl.uniform1f(volumeLoc('originX'), 50);
    const volumeReference: number[][] = [];
    for (const frame of volumeCases) {
      gl.uniform1i(volumeLoc('frameNum'), frame);
      gl.uniform1i(volumeLoc('rngOnly'), 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
      const color = new Float32Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, color);
      gl.uniform1i(volumeLoc('rngOnly'), 1); gl.drawArrays(gl.TRIANGLES, 0, 3);
      const next = new Float32Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, next);
      if (gl.getError() !== gl.NO_ERROR || [...color, next[0]!].some(x => !Number.isFinite(x))) {
        throw new Error(`Invalid GLSL volume MIS path ${frame}.`);
      }
      volumeReference.push([...color, next[0]!]);
    }
    if (!volumeReference.some(value => value.slice(0, 3).some(component => component > 0))) {
      throw new Error('Volume MIS reference produced no direct illumination.');
    }
    gl.uniform1i(volumeLoc('transmittanceOnly'), 1);
    const transmittanceReference: number[][] = [];
    for (const { x, frame } of transmittanceCases) {
      gl.uniform1f(volumeLoc('originX'), x); gl.uniform1i(volumeLoc('frameNum'), frame);
      gl.uniform1i(volumeLoc('rngOnly'), 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
      const color = new Float32Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, color);
      gl.uniform1i(volumeLoc('rngOnly'), 1); gl.drawArrays(gl.TRIANGLES, 0, 3);
      const next = new Float32Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, next);
      if (gl.getError() !== gl.NO_ERROR || [...color, next[0]!].some(value => !Number.isFinite(value))) {
        throw new Error(`Invalid GLSL transmittance for ${x}, frame ${frame}.`);
      }
      transmittanceReference.push([...color, next[0]!]);
    }
    if (transmittanceReference[0]![0] !== 0 || transmittanceReference[8]![0] !== 1 ||
        !(transmittanceReference[24]![0]! < 1 && transmittanceReference[24]![0]! < transmittanceReference[24]![2]!)) {
      throw new Error('Transmittance reference did not exercise opaque, masked and absorbing surfaces.');
    }
    gl.attachShader(environmentProgram, vertex); gl.attachShader(environmentProgram, environmentFragment); gl.linkProgram(environmentProgram);
    if (!gl.getProgramParameter(environmentProgram, gl.LINK_STATUS)) {
      throw new Error(`Environment path GLSL link: ${gl.getProgramInfoLog(environmentProgram)}`);
    }
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, envTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 4, 4, 0, gl.RGBA, gl.FLOAT, new Float32Array(64).fill(1));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, cdfTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 4, 4, 0, gl.RED, gl.FLOAT, Float32Array.from({ length: 16 }, (_, i) => i + 1));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.useProgram(environmentProgram);
    const envLoc = (name: string) => {
      const location = gl.getUniformLocation(environmentProgram, name);
      if (!location) throw new Error(`Missing environment path uniform ${name}`);
      return location;
    };
    gl.uniform1i(envLoc('materialsTex'), 0); gl.uniform1i(envLoc('textureMapsArrayTex'), 1);
    gl.uniform1i(envLoc('envMapTex'), 3); gl.uniform1i(envLoc('envMapCDFTex'), 4);
    gl.uniform2f(envLoc('envMapRes'), 4, 4); gl.uniform1f(envLoc('envMapTotalSum'), 16);
    gl.uniform1f(envLoc('envMapRot'), 0); gl.uniform1f(envLoc('envMapIntensity'), 1);
    gl.uniform1i(envLoc('maxDepth'), 3); gl.uniform1f(envLoc('originX'), 50);
    const environmentReference: number[][] = [];
    for (const frame of environmentCases) {
      gl.uniform1i(envLoc('frameNum'), frame);
      gl.uniform1i(envLoc('rngOnly'), 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
      const color = new Float32Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, color);
      gl.uniform1i(envLoc('rngOnly'), 1); gl.drawArrays(gl.TRIANGLES, 0, 3);
      const next = new Float32Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, next);
      if (gl.getError() !== gl.NO_ERROR || [...color, next[0]!].some(value => !Number.isFinite(value))) {
        throw new Error(`Invalid GLSL environment MIS path ${frame}.`);
      }
      environmentReference.push([...color, next[0]!]);
    }
    data.push([0, 1, 1, 1], [0, 1, 1, 2], [0, 2, 1, 3], [0, 2, 1, 4], [6, 4, 1, 5], [0, 1, 1, 6]);
    for (const frame of volumeCases) data.push([50, frame, 3, 7]);
    for (const c of transmittanceCases) data.push([c.x, c.frame, 3, 8]);
    for (const frame of environmentCases) data.push([50, frame, 3, 9]);
    device.queue.writeBuffer(inputs, 0, new Float32Array(data.flat()));
    device.queue.writeBuffer(lights, 0, new Float32Array([
      0, 0, 100, 0, 2, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0,
      6, 0, 1, 0, 5, 4, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.4, 4 * Math.PI * 0.4 ** 2, 1, 0,
    ]));
    device.queue.writeBuffer(envCdf, 0, Float32Array.from({ length: 16 }, (_, i) => i + 1));
    device.queue.writeTexture({ texture: env }, new Float32Array(64).fill(1), { bytesPerRow: 64 }, [4, 4]);
    const module = device.createShaderModule({ code: `
@group(0) @binding(0) var disneyNodes: texture_2d<f32>;
@group(0) @binding(1) var disneyTriangles: texture_2d<i32>;
@group(0) @binding(2) var disneyVertices: texture_2d<f32>;
@group(0) @binding(3) var disneyInverseTransforms: texture_2d<f32>;
@group(0) @binding(4) var disneyNormals: texture_2d<f32>;
@group(0) @binding(5) var disneyTransforms: texture_2d<f32>;
@group(0) @binding(6) var<storage, read> disneyMaterials: array<vec4f>;
@group(0) @binding(7) var disneyTextureMaps: texture_2d_array<u32>;
@group(0) @binding(8) var disneyEnvTexture: texture_2d<f32>;
@group(0) @binding(9) var<storage, read> disneyEnvCdf: array<f32>;
@group(0) @binding(10) var<storage, read> disneyLights: array<vec4f>;
@group(0) @binding(11) var<storage, read> inputs: array<vec4f>;
@group(0) @binding(12) var<storage, read_write> outputs: array<vec4f>;
@group(0) @binding(13) var disneySubsetMaterials: texture_2d<i32>;
${DISNEY_CAMERA_WGSL}
${DISNEY_TRAVERSAL_WGSL}
${DISNEY_SURFACE_WGSL}
${DISNEY_MATERIAL_WGSL}
${DISNEY_ALPHA_WGSL}
${DISNEY_BSDF_WGSL}
${DISNEY_ENVIRONMENT_WGSL}
${DISNEY_LIGHTS_WGSL}
${DISNEY_INTEGRATOR_WGSL}
${DISNEY_RENDER_WGSL}
@compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id: vec3u) {
  let a=inputs[id.x];
  var opts: DisneyPathOptions;
  opts.root=${packed.topLevelIndex}u; opts.maxDepth=u32(a.z); opts.uniformLight=true;
  opts.uniformColor=vec3f(0.6,0.8,1.2); opts.russianRoulette=true; opts.rrDepth=0u;
  opts.alphaTest=true; opts.medium=true; opts.volumeMis=a.w==2.0 || a.w==7.0 || a.w==9.0;
  if (a.w==2.0) { opts.hideEmitters=true; }
  if (a.w==6.0) { opts.volumeMis=true; opts.mollify=true; }
  if (a.w==3.0) { opts.lightCount=1u; opts.uniformColor=vec3f(0.0); }
  if (a.w==4.0) {
    opts.uniformLight=false; opts.environment=true; opts.environmentTotal=16.0;
    opts.environmentIntensity=1.0;
  }
  if (a.w==5.0) { opts.lightCount=2u; }
  if (a.w==7.0) { opts.lightCount=1u; opts.uniformColor=vec3f(0.0); }
  if (a.w==9.0) {
    opts.uniformLight=false; opts.environment=true; opts.environmentTotal=16.0;
    opts.environmentIntensity=1.0;
  }
  var seed=disneyInitRng(vec2u(7,11),u32(a.y));
  var result: DisneyPathResult;
  if (a.w==8.0) {
    let transmittance=disneyPathTransmittance(opts,vec3f(a.x,0,-2),vec3f(0,0,1),&seed);
    result.color=vec4f(transmittance.color,1.0); result.error=transmittance.error;
  } else {
    result=disneyPathTrace(opts,vec3f(a.x,0,2),vec3f(0,0,-1),&seed);
  }
  let next=disneyRandom(&seed);
  outputs[id.x*2u]=result.color; outputs[id.x*2u+1u]=vec4f(next,f32(result.error),0,0);
}` });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter(m => m.type === 'error');
    if (errors.length) throw new Error(errors.map(m => `${m.lineNum}: ${m.message}`).join('\n'));
    const layout = device.createBindGroupLayout({ entries: [
      ...[0, 2, 3, 4, 5, 8].map(binding => ({ binding, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' as const } })),
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'sint' } },
      { binding: 7, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'uint', viewDimension: '2d-array' } },
      ...[6, 9, 10, 11].map(binding => ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' as const } })),
      { binding: 12, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 13, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'sint' } },
    ] });
    const pipeline = await device.createComputePipelineAsync({ layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), compute: { module, entryPoint: 'main' } });
    const group = device.createBindGroup({ layout, entries: [
      { binding: 0, resource: textures.nodes.createView() }, { binding: 1, resource: textures.triangleIndices.createView() },
      { binding: 2, resource: textures.vertices.createView() }, { binding: 3, resource: textures.inverseTransforms.createView() },
      { binding: 4, resource: textures.normals.createView() }, { binding: 5, resource: textures.transforms.createView() },
      { binding: 6, resource: { buffer: materials } }, { binding: 7, resource: maps.createView({ dimension: '2d-array' }) },
      { binding: 8, resource: env.createView() }, { binding: 9, resource: { buffer: envCdf } },
      { binding: 10, resource: { buffer: lights } }, { binding: 11, resource: { buffer: inputs } }, { binding: 12, resource: { buffer: output } },
      { binding: 13, resource: textures.subsetMaterials.createView() },
    ] });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(count); pass.end();
    encoder.copyBufferToBuffer(output, 0, readback, 0, count * 32); device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const actual = Array.from(new Float32Array(readback.getMappedRange().slice(0))); readback.unmap();
    for (const [i, expected] of reference.entries()) {
      const got = actual.slice(i * 8, i * 8 + 5);
      if (actual[i * 8 + 5] !== 0 || expected.some((x, j) =>
        !Number.isFinite(got[j]!) || (j === 4 ? got[j] !== x : Math.abs(got[j]! - x) > 0.0002 * Math.max(1, Math.abs(x))))) {
        throw new Error(`Disney path case ${i}: GLSL ${expected}, WGSL ${got}, error ${actual[i * 8 + 5]}.`);
      }
    }
    if (actual[(cases.length + 1) * 8 + 5] !== 10) throw new Error('Unsupported volume MIS option was not rejected.');
    if (actual[cases.length * 8 + 5] !== 0) throw new Error('Alpha option failed for an opaque material.');
    for (let i = 2; i < 4; i++) {
      const base = (cases.length + i) * 8;
      if (actual[base + 5] !== 0 || !Number.isFinite(actual[base]) || actual[base]! <= material.emission[0]) {
        throw new Error(`Disney direct-light path ${i}: ${actual.slice(base, base + 6)}.`);
      }
    }
    const emitterBase = (cases.length + 4) * 8;
    const emitterExpected = [...emitterColor, emitterNext[0]!];
    if (actual[emitterBase + 5] !== 0 || emitterExpected.some((x, i) => actual[emitterBase + i] !== x)) {
      throw new Error(`Disney emitter path: GLSL ${emitterExpected}, WGSL ${actual.slice(emitterBase, emitterBase + 6)}.`);
    }
    if (actual[(cases.length + 5) * 8 + 5] !== 10) throw new Error('Unsupported volume MIS with mollification was not rejected.');
    for (const [i, expected] of volumeReference.entries()) {
      const base = (cases.length + 6 + i) * 8;
      const got = actual.slice(base, base + 5);
      if (actual[base + 5] !== 0 || expected.some((x, j) =>
        !Number.isFinite(got[j]!) || (j === 4 ? got[j] !== x : Math.abs(got[j]! - x) > 0.0002 * Math.max(1, Math.abs(x))))) {
        throw new Error(`Disney volume MIS path ${i}: GLSL ${expected}, WGSL ${got}, error ${actual[base + 5]}.`);
      }
    }
    for (const [i, expected] of transmittanceReference.entries()) {
      const base = (cases.length + 6 + volumeCases.length + i) * 8;
      const got = actual.slice(base, base + 5);
      if (actual[base + 5] !== 0 || expected.some((x, j) =>
        !Number.isFinite(got[j]!) || (j === 4 ? got[j] !== x : Math.abs(got[j]! - x) > 0.0002 * Math.max(1, Math.abs(x))))) {
        throw new Error(`Disney transmittance ${i}: GLSL ${expected}, WGSL ${got}, error ${actual[base + 5]}.`);
      }
    }
    for (const [i, expected] of environmentReference.entries()) {
      const base = (cases.length + 6 + volumeCases.length + transmittanceCases.length + i) * 8;
      const got = actual.slice(base, base + 5);
      if (actual[base + 5] !== 0 || expected.some((x, j) =>
        !Number.isFinite(got[j]!) || (j === 4 ? got[j] !== x : Math.abs(got[j]! - x) > 0.0002 * Math.max(1, Math.abs(x))))) {
        throw new Error(`Disney environment volume MIS path ${i}: GLSL ${expected}, WGSL ${got}, error ${actual[base + 5]}.`);
      }
    }
    const renderSettings: DisneyRenderSettings = {
      resolution: [2, 2], tileOrigin: [0, 0], tileSize: [1, 1], tileOffset: [0, 0], inverseTileCount: [0.5, 0.5],
      frame: 1, root: packed.topLevelIndex,
      camera: { position: [6, 0, 2], right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, 1],
        fov: 0.5, focalDistance: 1, aperture: 0 },
      lightCount: 0, maxDepth: 3, rrDepth: 0, russianRoulette: false, environment: false, uniformLight: true,
      hideEmitters: false, transparentBackground: false, alphaTest: true, medium: false, volumeMis: false,
      flipNormalY: false, mollify: false, environmentLinear: false, mollificationAmount: 0,
      environmentTotal: 0, environmentRotation: 0, environmentIntensity: 1, uniformColor: [0.6, 0.8, 1.2],
    };
    const goodUniform = device.createBuffer({ size: 176, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const badUniform = device.createBuffer({ size: 176, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const pixels = device.createBuffer({ size: 4 * DISNEY_RENDER_PIXEL_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    const status = device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    const renderReadback = device.createBuffer({ size: 4 * DISNEY_RENDER_PIXEL_BYTES + 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    try {
      device.queue.writeBuffer(goodUniform, 0, packDisneyRenderSettings(renderSettings));
      device.queue.writeBuffer(badUniform, 0, packDisneyRenderSettings({
        ...renderSettings, camera: { ...renderSettings.camera, right: [0, 0, 0], up: [0, 0, 0], forward: [0, 0, 0] },
      }));
      const renderLayout = device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ] });
      const renderPipeline = await device.createComputePipelineAsync({
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout, renderLayout] }),
        compute: { module, entryPoint: 'disneyRenderTile' },
      });
      const renderGroup = (uniform: GPUBuffer) => device.createBindGroup({ layout: renderLayout, entries: [
        { binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: { buffer: pixels } },
        { binding: 2, resource: { buffer: status } },
      ] });
      const good = renderGroup(goodUniform), bad = renderGroup(badUniform);
      const renderEncoder = device.createCommandEncoder();
      for (const bindings of [good, good, bad, good]) {
        const renderPass = renderEncoder.beginComputePass();
        renderPass.setPipeline(renderPipeline); renderPass.setBindGroup(0, group); renderPass.setBindGroup(1, bindings);
        renderPass.dispatchWorkgroups(1); renderPass.end();
      }
      renderEncoder.copyBufferToBuffer(pixels, 0, renderReadback, 0, 4 * DISNEY_RENDER_PIXEL_BYTES);
      renderEncoder.copyBufferToBuffer(status, 0, renderReadback, 4 * DISNEY_RENDER_PIXEL_BYTES, 4);
      device.queue.submit([renderEncoder.finish()]);
      await renderReadback.mapAsync(GPUMapMode.READ);
      const data = renderReadback.getMappedRange().slice(0);
      renderReadback.unmap();
      const floats = new Float32Array(data), ints = new Uint32Array(data);
      const base = 2 * DISNEY_RENDER_PIXEL_BYTES / 4;
      const expected = [1.2, 1.6, 2.4, 2];
      if (expected.some((value, i) => !Number.isFinite(floats[base + i]!) || Math.abs(floats[base + i]! - value) > 1e-6) ||
          ints[base + 4] !== 2 || ints[base + 5] !== 102 || ints[32] !== 102 ||
          [0, 1, 3].some(index => ints[index * 8 + 4] !== 0)) {
        throw new Error(`Disney render accumulation failed: ${Array.from(floats.slice(base, base + 4))}, samples ${ints[base + 4]}, error ${ints[base + 5]}, status ${ints[32]}.`);
      }
      const saturated = new ArrayBuffer(4 * DISNEY_RENDER_PIXEL_BYTES);
      new Float32Array(saturated).set([5, 6, 7, 8], base);
      new Uint32Array(saturated)[base + 4] = 0xffffffff;
      device.queue.writeBuffer(pixels, 0, saturated);
      device.queue.writeBuffer(status, 0, new Uint32Array([0]));
      const overflowEncoder = device.createCommandEncoder();
      const overflowPass = overflowEncoder.beginComputePass();
      overflowPass.setPipeline(renderPipeline); overflowPass.setBindGroup(0, group); overflowPass.setBindGroup(1, good);
      overflowPass.dispatchWorkgroups(1); overflowPass.end();
      overflowEncoder.copyBufferToBuffer(pixels, 0, renderReadback, 0, 4 * DISNEY_RENDER_PIXEL_BYTES);
      overflowEncoder.copyBufferToBuffer(status, 0, renderReadback, 4 * DISNEY_RENDER_PIXEL_BYTES, 4);
      device.queue.submit([overflowEncoder.finish()]);
      await renderReadback.mapAsync(GPUMapMode.READ);
      const overflow = renderReadback.getMappedRange().slice(0);
      renderReadback.unmap();
      const overflowFloats = new Float32Array(overflow), overflowInts = new Uint32Array(overflow);
      if ([5, 6, 7, 8].some((value, i) => overflowFloats[base + i] !== value) ||
          overflowInts[base + 4] !== 0xffffffff || overflowInts[base + 5] !== 201 || overflowInts[32] !== 201) {
        throw new Error('Disney render sample counter overflow was not rejected without accumulation.');
      }
    } finally {
      goodUniform.destroy(); badUniform.destroy(); pixels.destroy(); status.destroy(); renderReadback.destroy();
    }
    const backend = await DisneyGpuBackend.create(device, {
      geometry: packed, materials: materialList, textures: new DisneyTextureRegistry(), warnings: [],
    }, {
      width: 2, height: 2, textureSize: 1, outputFormat: 'rgba8unorm',
      imageProvider: { decode: () => undefined },
      lights: new Float32Array(20),
    });
    try {
      backend.reset();
      const backendSettings: DisneyRenderSettings = {
        ...renderSettings, tileSize: [2, 2], inverseTileCount: [1, 1],
        camera: { ...renderSettings.camera, position: [100, 100, 10] },
      };
      backend.renderTile(backendSettings);
      backend.renderTile(backendSettings);
      if (await backend.readError() !== 0) throw new Error('Disney GPU backend reported a render error.');
      const result = await backend.readPixels();
      if (result.samples.some(samples => samples !== 2) ||
          Array.from(result.color).some(value => !Number.isFinite(value))) {
        throw new Error('Disney GPU backend did not accumulate a finite sample for each pixel.');
      }
    } finally {
      backend.dispose();
    }
    return cases.length + 1 + volumeCases.length + transmittanceCases.length + environmentCases.length;
  } finally {
    textures.destroy(); materials.destroy(); maps.destroy(); env.destroy(); envCdf.destroy(); lights.destroy();
    inputs.destroy(); output.destroy(); readback.destroy();
    gl.deleteFramebuffer(framebuffer); gl.deleteTexture(target); gl.deleteTexture(matTex); gl.deleteTexture(mapTex); gl.deleteTexture(lightTex);
    gl.deleteTexture(envTex); gl.deleteTexture(cdfTex);
    gl.deleteProgram(program); gl.deleteProgram(emitterProgram); gl.deleteProgram(volumeProgram); gl.deleteProgram(environmentProgram);
    gl.deleteShader(vertex); gl.deleteShader(fragment); gl.deleteShader(emitterFragment); gl.deleteShader(volumeFragment); gl.deleteShader(environmentFragment);
  }
}
