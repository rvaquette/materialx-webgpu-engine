/**
 * Progressive tile kernel. Group 0 supplies the geometry, material, texture,
 * environment and light bindings required by the Disney transport modules.
 * Group 1 supplies the parameters, per-pixel records and a sticky error flag.
 * Tile coordinates and RNG pixels use the source's bottom-left convention;
 * the output buffer is stored top-to-bottom for WebGPU presentation.
 */
export const DISNEY_RENDER_WGSL = /* wgsl */ `
struct DisneyRenderParameters {
  resolutionOrigin: vec4u,
  tileFrameRoot: vec4u,
  tileCoordinates: vec4f,
  cameraPosition: vec4f,
  cameraRight: vec4f,
  cameraUp: vec4f,
  cameraForward: vec4f,
  cameraParameters: vec4f,
  pathParameters: vec4u,
  transportParameters: vec4f,
  uniformColor: vec4f,
};

struct DisneyRenderPixel {
  sum: vec4f,
  samples: u32,
  error: u32,
  padding: vec2u,
};

@group(1) @binding(0) var<uniform> disneyRenderParameters: DisneyRenderParameters;
@group(1) @binding(1) var<storage, read_write> disneyRenderPixels: array<DisneyRenderPixel>;
@group(1) @binding(2) var<storage, read_write> disneyRenderError: atomic<u32>;

@compute @workgroup_size(8, 8)
fn disneyRenderTile(@builtin(global_invocation_id) id: vec3u) {
  let p = disneyRenderParameters;
  let tileSize = p.tileFrameRoot.xy;
  if (any(id.xy >= tileSize)) { return; }
  let resolution = p.resolutionOrigin.xy;
  if (any(resolution == vec2u(0u)) || any(p.resolutionOrigin.zw >= resolution) ||
      any(id.xy >= resolution - p.resolutionOrigin.zw)) {
    atomicMax(&disneyRenderError, 202u); return;
  }
  let pixel = p.resolutionOrigin.zw + id.xy;
  let outputIndex = (resolution.y - 1u - pixel.y) * resolution.x + pixel.x;
  if (outputIndex >= arrayLength(&disneyRenderPixels)) { atomicMax(&disneyRenderError, 202u); return; }
  if (disneyRenderPixels[outputIndex].error != 0u) { return; }
  let camera = DisneyCamera(p.cameraPosition.xyz, p.cameraRight.xyz, p.cameraUp.xyz,
    p.cameraForward.xyz, p.cameraParameters.x, p.cameraParameters.y, p.cameraParameters.z,
    p.cameraParameters.w > 0.5);
  var seed = disneyInitRng(id.xy, p.tileFrameRoot.z);
  let ray = disneyCameraRay(camera, id.xy, tileSize, resolution, p.tileCoordinates.xy, p.tileCoordinates.zw, &seed);
  if (ray.error != 0u) {
    let error = 100u + ray.error;
    disneyRenderPixels[outputIndex].error = error; atomicMax(&disneyRenderError, error); return;
  }
  let flags = p.pathParameters.w;
  var options: DisneyPathOptions;
  options.root = p.tileFrameRoot.w;
  options.lightCount = p.pathParameters.x;
  options.maxDepth = p.pathParameters.y;
  options.rrDepth = p.pathParameters.z;
  options.russianRoulette = (flags & 1u) != 0u;
  options.environment = (flags & 2u) != 0u;
  options.uniformLight = (flags & 4u) != 0u;
  options.hideEmitters = (flags & 8u) != 0u;
  options.transparentBackground = (flags & 16u) != 0u;
  options.alphaTest = (flags & 32u) != 0u;
  options.medium = (flags & 64u) != 0u;
  options.volumeMis = (flags & 128u) != 0u;
  options.flipNormalY = (flags & 256u) != 0u;
  options.mollify = (flags & 512u) != 0u;
  options.environmentLinear = (flags & 1024u) != 0u;
  options.mollificationAmount = p.transportParameters.x;
  options.environmentTotal = p.transportParameters.y;
  options.environmentRotation = p.transportParameters.z;
  options.environmentIntensity = p.transportParameters.w;
  options.uniformColor = p.uniformColor.xyz;
  let sample = disneyPathTrace(options, ray.origin, ray.direction, &seed);
  if (sample.error != 0u) {
    let error = 1000u + sample.error;
    disneyRenderPixels[outputIndex].error = error; atomicMax(&disneyRenderError, error); return;
  }
  let sum = disneyRenderPixels[outputIndex].sum + sample.color;
  if (!disneyLightFinite3(sum.xyz) || !disneyLightFinite(sum.w) || disneyRenderPixels[outputIndex].samples == 0xffffffffu) {
    disneyRenderPixels[outputIndex].error = 201u; atomicMax(&disneyRenderError, 201u); return;
  }
  disneyRenderPixels[outputIndex].sum = sum;
  disneyRenderPixels[outputIndex].samples++;
}
`;

export const DISNEY_RENDER_UNIFORM_BYTES = 176;
export const DISNEY_RENDER_PIXEL_BYTES = 32;

type Vec2 = readonly [number, number];
type Vec3 = readonly [number, number, number];

export interface DisneyTileCoordinates {
  tileOrigin: Vec2;
  tileSize: Vec2;
  tileOffset: Vec2;
  inverseTileCount: Vec2;
  tileCount: number;
}

/** Source tile iteration is left-to-right, top-to-bottom in its bottom-left tile coordinates. */
export function disneyTileForIndex(index: number, resolution: Vec2, tileExtent: number): DisneyTileCoordinates {
  if (!Number.isSafeInteger(index) || index < 0 ||
      resolution.some(value => !Number.isSafeInteger(value) || value <= 0) ||
      !Number.isSafeInteger(tileExtent) || tileExtent <= 0) {
    throw new Error('Invalid Disney tile index, resolution or extent.');
  }
  const tilesX = Math.ceil(resolution[0] / tileExtent);
  const tilesY = Math.ceil(resolution[1] / tileExtent);
  const tileCount = tilesX * tilesY;
  if (!Number.isSafeInteger(tileCount) || index >= tileCount) throw new Error('Disney tile index is outside the render grid.');
  const tileX = index % tilesX;
  const tileY = tilesY - 1 - Math.floor(index / tilesX);
  const tileOrigin: [number, number] = [tileX * tileExtent, tileY * tileExtent];
  const tileSize: [number, number] = [
    Math.min(tileExtent, resolution[0] - tileOrigin[0]),
    Math.min(tileExtent, resolution[1] - tileOrigin[1]),
  ];
  return {
    tileOrigin, tileSize,
    tileOffset: [tileX / tilesX, tileY / tilesY],
    inverseTileCount: [1 / tilesX, 1 / tilesY],
    tileCount,
  };
}

export interface DisneyRenderSettings {
  resolution: Vec2;
  tileOrigin: Vec2;
  tileSize: Vec2;
  tileOffset: Vec2;
  inverseTileCount: Vec2;
  frame: number;
  root: number;
  camera: {
    position: Vec3;
    right: Vec3;
    up: Vec3;
    forward: Vec3;
    fov: number;
    focalDistance: number;
    aperture: number;
    orthographic?: boolean;
  };
  lightCount: number;
  maxDepth: number;
  rrDepth: number;
  russianRoulette: boolean;
  environment: boolean;
  uniformLight: boolean;
  hideEmitters: boolean;
  transparentBackground: boolean;
  alphaTest: boolean;
  medium: boolean;
  volumeMis: boolean;
  flipNormalY: boolean;
  mollify: boolean;
  environmentLinear: boolean;
  mollificationAmount: number;
  environmentTotal: number;
  environmentRotation: number;
  environmentIntensity: number;
  uniformColor: Vec3;
}

/** Validate and pack an explicitly configured source-compatible tile. */
export function packDisneyRenderSettings(settings: DisneyRenderSettings): ArrayBuffer {
  const { resolution, tileOrigin, tileSize, tileOffset, inverseTileCount, camera } = settings;
  const uint = (value: number, max = 0xffffffff) => Number.isInteger(value) && value >= 0 && value <= max;
  if (resolution.some(value => !uint(value) || value === 0) ||
      tileOrigin.some(value => !uint(value)) || tileSize.some(value => !uint(value) || value === 0) ||
      tileOrigin.some((value, i) => value + tileSize[i]! > resolution[i]!) ||
      resolution[0] * resolution[1] > 0xffffffff ||
      !uint(settings.frame) || !uint(settings.root) || !uint(settings.lightCount) ||
      !uint(settings.maxDepth, 0x7fffffff) || !uint(settings.rrDepth, 0x7fffffff)) {
    throw new Error('Invalid Disney render dimensions, tile or integer settings.');
  }
  const floats = [...tileOffset, ...inverseTileCount, ...camera.position, ...camera.right, ...camera.up,
    ...camera.forward, camera.fov, camera.focalDistance, camera.aperture, settings.mollificationAmount,
    settings.environmentTotal, settings.environmentRotation, settings.environmentIntensity, ...settings.uniformColor];
  if (floats.some(value => !Number.isFinite(value) || !Number.isFinite(Math.fround(value))) ||
      Math.fround(camera.fov) <= 0 || Math.fround(camera.fov) >= Math.fround(Math.PI) ||
      Math.fround(camera.focalDistance) <= 0 || camera.aperture < 0 ||
      inverseTileCount.some(value => Math.fround(value) <= 0) ||
      (settings.environment && !settings.uniformLight && Math.fround(settings.environmentTotal) <= 0) ||
      (settings.medium && settings.volumeMis && (settings.hideEmitters || settings.mollify))) {
    throw new Error('Invalid or unsupported Disney render settings.');
  }
  const buffer = new ArrayBuffer(DISNEY_RENDER_UNIFORM_BYTES);
  const u = new Uint32Array(buffer);
  const f = new Float32Array(buffer);
  u.set([...resolution, ...tileOrigin], 0);
  u.set([...tileSize, settings.frame, settings.root], 4);
  f.set([...tileOffset, ...inverseTileCount], 8);
  f.set(camera.position, 12); f.set(camera.right, 16); f.set(camera.up, 20); f.set(camera.forward, 24);
  f.set([camera.fov, camera.focalDistance, camera.aperture, camera.orthographic ? 1 : 0], 28);
  const flags = [settings.russianRoulette, settings.environment, settings.uniformLight, settings.hideEmitters,
    settings.transparentBackground, settings.alphaTest, settings.medium, settings.volumeMis, settings.flipNormalY,
    settings.mollify, settings.environmentLinear].reduce((value, enabled, bit) => value | (enabled ? 1 << bit : 0), 0);
  u.set([settings.lightCount, settings.maxDepth, settings.rrDepth, flags], 32);
  f.set([settings.mollificationAmount, settings.environmentTotal, settings.environmentRotation, settings.environmentIntensity], 36);
  f.set(settings.uniformColor, 40);
  return buffer;
}
