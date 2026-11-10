// Subsurface scattering for the reference path tracer (plan section 9.2, T029).
// Brute-force volumetric random walk (BSSRDF): the surface is treated as a
// dense participating medium and photons random-walk until they exit. No
// diffusion/profile approximation is used, so the estimator is unbiased. Two
// termination strategies trade variance for cost at equal expectation:
//   - 'analog'   : scatter survives with probability = single-scatter albedo
//                  (analog absorption), weights stay 1. Lowest variance per
//                  sample for high-albedo media, zero bias.
//   - 'weighted' : throughput is multiplied by the albedo and Russian roulette
//                  terminates the walk; decouples absorption from termination.
// Both converge to the same reflectance/transmittance. The albedo inversion of
// Chiang et al. 2016 maps an artist diffuse albedo to the medium's
// single-scatter albedo that drives the walk.

import type { Vec3 } from '../../scene/transforms.ts';
import type { Rng, SurfaceHit } from './integrator.ts';
import type { HomogeneousMedium } from './media.ts';
import { sampleHenyeyGreenstein } from './media.ts';

type V = Vec3;

function normalize(v: V): V {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len > 0 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 1];
}

/**
 * Chiang et al. 2016 inversion mapping a diffuse surface albedo A to the
 * single-scatter albedo alpha used to drive a random walk. Per channel.
 */
export function singleScatterAlbedo(a: Vec3): Vec3 {
  const f = (x: number): number => {
    const c = Math.min(Math.max(x, 0), 1);
    return 1 - Math.exp(-5.09406 * c + 2.61188 * c * c - 4.31805 * c * c * c);
  };
  return [f(a[0]), f(a[1]), f(a[2])];
}

export function albedoPreservingSingleScatter(albedo: Vec3, anisotropy = 0, ior = 1): Vec3 {
  const escape = 1 / Math.max(1, ior) ** 2;
  const g = Math.min(Math.max(anisotropy, -0.99), 0.99);
  return albedo.map(value => {
    const color = Math.min(Math.max(value, 0), 1 - 1e-6);
    const internal = color / (escape + color * (1 - escape));
    const reduced = 4 * internal / (1 + internal) ** 2;
    return Math.min(reduced / (1 - g + reduced * g), 1 - 1e-6);
  }) as unknown as Vec3;
}

export function sssCoefficientsWgsl(prefix: string): string {
  return `fn ${prefix}_alpha(albedo: vec3f, g: f32, ior: f32, inversion: f32) -> vec3f {
  let a = clamp(albedo, vec3f(0.0), vec3f(1.0));
  if (inversion >= 0.5) { return vec3f(1.0) - exp(-5.09406 * a + 2.61188 * a * a - 4.31805 * a * a * a); }
  let color = min(a, vec3f(0.999999));
  let eta = max(ior, 1.0);
  let escape = 1.0 / (eta * eta);
  let internal = color / (escape + color * (1.0 - escape));
  let reduced = 4.0 * internal / ((vec3f(1.0) + internal) * (vec3f(1.0) + internal));
  let anisotropy = clamp(g, -0.99, 0.99);
  return min(reduced / (1.0 - anisotropy + reduced * anisotropy), vec3f(0.999999));
}
fn ${prefix}_sigma_t(albedo: vec3f, mfp: vec3f, inversion: f32) -> vec3f {
  var distance = mfp;
  if (inversion < 0.5) {
    let a = clamp(albedo, vec3f(0.0), vec3f(1.0));
    let offset = a - vec3f(0.8);
    distance *= vec3f(1.9) - a + 3.5 * offset * offset;
  }
  return select(vec3f(0.0), vec3f(1.0) / max(distance, vec3f(1e-20)), distance > vec3f(0.0));
}`;
}

export function sampleDavisDensity(bleed: number, random: Rng): number {
  const shape = 2 - 0.75 * Math.min(Math.max(bleed, 0), 1);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let attempt = 0; attempt < 128; attempt++) {
    const normal = Math.sqrt(-2 * Math.log(Math.max(random(), 1e-12))) * Math.cos(2 * Math.PI * random());
    const root = 1 + c * normal;
    if (root <= 0) continue;
    const cube = root ** 3;
    const uniform = Math.max(random(), 1e-12);
    if (uniform < 1 - 0.0331 * normal ** 4 || Math.log(uniform) < 0.5 * normal ** 2 + d * (1 - cube + Math.log(cube))) {
      return d * cube / shape;
    }
  }
  throw new Error('Davis density sampling exceeded its rejection budget.');
}

export function topologyReflectionProbability(entryNormal: Vec3, exitNormal: Vec3, strength: number): number {
  const alignment = entryNormal[0] * exitNormal[0] + entryNormal[1] * exitNormal[1] + entryNormal[2] * exitNormal[2];
  return Math.min(Math.max(strength, 0), 1) * (1 - Math.min(Math.max(alignment, 0), 1));
}

/**
 * Christensen-Burley scaling s(A) used to turn an artist mean free path into a
 * volumetric extinction: sigma_t = 1 / (meanFreePath * s). Parameterization
 * only; the walk itself stays unbiased. Per channel.
 */
export function extinctionFromMeanFreePath(meanFreePath: Vec3, albedo: Vec3): Vec3 {
  const sigma = (d: number, a: number): number => {
    const s = 1.9 - a + 3.5 * (a - 0.8) * (a - 0.8);
    const dd = d * s;
    return dd > 0 ? 1 / dd : 0;
  };
  return [sigma(meanFreePath[0], albedo[0]), sigma(meanFreePath[1], albedo[1]), sigma(meanFreePath[2], albedo[2])];
}

export function burleyRadialPdf(radius: number, diffusionLength: number): number {
  if (!(diffusionLength > 0) || radius < 0) return 0;
  return (Math.exp(-radius / diffusionLength) + Math.exp(-radius / (3 * diffusionLength))) / (4 * diffusionLength);
}

export function burleyProfile(radius: number, diffusionLength: number): number {
  if (!(diffusionLength > 0) || radius < 0) return 0;
  return burleyRadialPdf(radius, diffusionLength) / (2 * Math.PI * radius);
}

export function sampleBurleyRadius(diffusionLength: number, component: number, sample: number): number {
  if (!(diffusionLength > 0)) return 0;
  const scale = component < 0.25 ? diffusionLength : 3 * diffusionLength;
  return -scale * Math.log1p(-Math.min(Math.max(sample, 0), 1 - Number.EPSILON));
}

export function burleyDiffusionLength(
  albedo: Vec3, radius: Vec3, mode: 2 | 3, anisotropy = 0, inversion: 0 | 1 = 1, ior = 1,
): Vec3 {
  const alpha = inversion === 0 ? albedoPreservingSingleScatter(albedo, anisotropy, ior) : singleScatterAlbedo(albedo);
  return radius.map((value, channel) => mode === 2 ? Math.max(value, 0) / 2.5
    : Math.max(value, 0) / Math.sqrt(3 * (1 - alpha[channel]!) * (1 - alpha[channel]! * anisotropy))) as unknown as Vec3;
}

export function exponentialSubsurfaceMedium(albedo: Vec3, meanFreePath: Vec3, anisotropy = 0, inversion: 0 | 1 = 1, ior = 1): HomogeneousMedium {
  const alpha = inversion === 0 ? albedoPreservingSingleScatter(albedo, anisotropy, ior) : singleScatterAlbedo(albedo);
  const sigmaT = inversion === 0 ? extinctionFromMeanFreePath(meanFreePath, albedo)
    : meanFreePath.map(value => value > 0 ? 1 / value : 0);
  return {
    absorption: alpha.map((value, channel) => (1 - value) * sigmaT[channel]!) as unknown as Vec3,
    scattering: alpha.map((value, channel) => value * sigmaT[channel]!) as unknown as Vec3,
    anisotropy,
  };
}

export function sampleBurleySurface(
  entry: SurfaceHit,
  albedo: Vec3,
  radius: Vec3,
  mode: 2 | 3,
  anisotropy: number,
  project: (probe: Vec3, axis: Vec3) => readonly SurfaceHit[],
  rng: Rng,
  inversion: 0 | 1 = 1,
  followTopology = 0,
  ior = 1,
): { hit: SurfaceHit; weight: Vec3 } | null {
  const lengths = burleyDiffusionLength(albedo, radius, mode, anisotropy, inversion, ior);
  const channel = Math.min(2, Math.floor(rng() * 3));
  if (!(lengths[channel]! > 0)) {
    const localChannels = lengths.filter(length => !(length > 0)).length;
    return { hit: entry, weight: albedo.map((value, index) => lengths[index]! > 0 ? 0
      : Math.min(Math.max(value, 0), 1) * 3 / localChannels) as unknown as Vec3 };
  }
  const distance = sampleBurleyRadius(lengths[channel]!, rng(), rng());
  if (!(distance > 0)) return null;
  const normal = normalize(entry.normal);
  const helper: Vec3 = Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const tangent = normalize([helper[1] * normal[2] - helper[2] * normal[1],
    helper[2] * normal[0] - helper[0] * normal[2], helper[0] * normal[1] - helper[1] * normal[0]]);
  const bitangent: Vec3 = [normal[1] * tangent[2] - normal[2] * tangent[1],
    normal[2] * tangent[0] - normal[0] * tangent[2], normal[0] * tangent[1] - normal[1] * tangent[0]];
  const axes = [normal, tangent, bitangent];
  const choice = rng();
  const axisIndex = choice < 0.5 ? 0 : choice < 0.75 ? 1 : 2;
  const axis = axes[axisIndex]!;
  const diskX = axes[(axisIndex + 1) % 3]!;
  const diskY = axes[(axisIndex + 2) % 3]!;
  const phi = 2 * Math.PI * rng();
  const probe = entry.position.map((value, index) => value + distance
    * (Math.cos(phi) * diskX[index]! + Math.sin(phi) * diskY[index]!)) as unknown as Vec3;
  const exits = project(probe, axis);
  if (exits.length === 0) return null;
  const hit = exits[Math.min(exits.length - 1, Math.floor(rng() * exits.length))]!;
  const offset = hit.position.map((value, index) => value - entry.position[index]!) as unknown as Vec3;
  const geometricNormal = hit.geometricNormal ?? hit.normal;
  let areaPdf = 0;
  for (const [index, projectionAxis] of axes.entries()) {
    const jacobian = Math.abs(geometricNormal[0] * projectionAxis[0] + geometricNormal[1] * projectionAxis[1] + geometricNormal[2] * projectionAxis[2]);
    if (jacobian === 0) continue;
    const depth = offset[0] * projectionAxis[0] + offset[1] * projectionAxis[1] + offset[2] * projectionAxis[2];
    const projected = hit.position.map((value, component) => value - projectionAxis[component]! * depth) as unknown as Vec3;
    const radialDistance = Math.hypot(...projected.map((value, component) => value - entry.position[component]!));
    const count = index === axisIndex ? exits.length : project(projected, projectionAxis).length;
    if (count === 0) continue;
    areaPdf += (index === 0 ? 0.5 : 0.25)
      * lengths.reduce((sum, length) => sum + burleyProfile(radialDistance, length) / 3, 0) * jacobian / count;
  }
  if (!(areaPdf > 0)) return null;
  const separation = Math.hypot(...hit.position.map((value, index) => value - entry.position[index]!));
  const topologyWeight = 1 - topologyReflectionProbability(entry.normal, hit.normal, followTopology);
  const weight = albedo.map((value, index) => Math.min(Math.max(value, 0), 1)
    * burleyProfile(separation, lengths[index]!) * topologyWeight / areaPdf) as unknown as Vec3;
  return { hit, weight };
}

export type WalkMode = 'analog' | 'weighted';

export interface RandomWalkOptions {
  mode?: WalkMode;
  maxBounces?: number;
  minBounces?: number;
  rrProbability?: number;
}

export type ExitKind = 'front' | 'back' | 'absorbed' | 'terminated';

export interface RandomWalkResult {
  exit: ExitKind;
  /** Throughput carried out of the medium (0 when absorbed/terminated). */
  weight: number;
  bounces: number;
}

/**
 * Single-channel random walk through a homogeneous slab of the given thickness,
 * bounded by z=0 (entry/front) and z=thickness (back). The photon exits 'front'
 * (diffuse reflectance) or 'back' (transmittance). Unbiased for both modes.
 */
export function randomWalkSlabChannel(
  sigmaT: number,
  albedo: number,
  anisotropy: number,
  thickness: number,
  entryDir: Vec3,
  rng: Rng,
  options: RandomWalkOptions = {},
): RandomWalkResult {
  const mode = options.mode ?? 'analog';
  const maxBounces = options.maxBounces ?? 1_000_000;
  const minBounces = options.minBounces ?? 0;
  const rrP = Math.min(Math.max(options.rrProbability ?? 0.95, 1e-3), 1);

  let z = 0;
  let dir = normalize(entryDir);
  let weight = 1;

  for (let b = 0; b < maxBounces; b += 1) {
    if (!(sigmaT > 0)) return { exit: 'back', weight, bounces: b };
    const t = -Math.log(1 - rng()) / sigmaT;
    const nz = z + dir[2] * t;
    if (nz < 0) return { exit: 'front', weight, bounces: b };
    if (nz > thickness) return { exit: 'back', weight, bounces: b };
    z = nz;

    if (mode === 'analog') {
      if (rng() >= albedo) return { exit: 'absorbed', weight: 0, bounces: b };
    } else {
      weight *= albedo;
      if (b >= minBounces) {
        if (rng() >= rrP) return { exit: 'terminated', weight: 0, bounces: b };
        weight /= rrP;
      }
    }

    dir = sampleHenyeyGreenstein([-dir[0], -dir[1], -dir[2]], anisotropy, rng(), rng()).wi;
  }
  return { exit: 'terminated', weight, bounces: maxBounces };
}

export interface SlabResponse {
  reflectance: Vec3;
  transmittance: Vec3;
  absorbed: Vec3;
}

/**
 * Monte Carlo estimate of the spectral slab response by averaging per-channel
 * random walks. Diffuse reflectance (front exits) and transmittance (back
 * exits); the remainder is absorbed. Unbiased in the sample count.
 */
export function estimateSlabResponse(
  singleScatter: Vec3,
  sigmaT: Vec3,
  anisotropy: number,
  thickness: number,
  entryDir: Vec3,
  rng: Rng,
  samples: number,
  options: RandomWalkOptions = {},
): SlabResponse {
  const reflectance: [number, number, number] = [0, 0, 0];
  const transmittance: [number, number, number] = [0, 0, 0];
  for (let c = 0 as 0 | 1 | 2; c < 3; c = (c + 1) as 0 | 1 | 2) {
    let r = 0;
    let tr = 0;
    for (let i = 0; i < samples; i += 1) {
      const walk = randomWalkSlabChannel(sigmaT[c], singleScatter[c], anisotropy, thickness, entryDir, rng, options);
      if (walk.exit === 'front') r += walk.weight;
      else if (walk.exit === 'back') tr += walk.weight;
    }
    reflectance[c] = r / samples;
    transmittance[c] = tr / samples;
  }
  return {
    reflectance,
    transmittance,
    absorbed: [
      Math.max(0, 1 - reflectance[0] - transmittance[0]),
      Math.max(0, 1 - reflectance[1] - transmittance[1]),
      Math.max(0, 1 - reflectance[2] - transmittance[2]),
    ],
  };
}

/**
 * Build the interior HomogeneousMedium that drives the BSSRDF random walk inside
 * an object, so the volumetric path integrator (integratePath) handles subsurface
 * transport with the same free-flight/phase machinery as participating media.
 * The artist diffuse albedo maps to the single-scatter albedo (Chiang 2016) and
 * the mean free path to the extinction (Christensen-Burley); the scattering and
 * absorption coefficients then partition the extinction by that albedo.
 */
export function subsurfaceMedium(
  diffuseAlbedo: Vec3,
  meanFreePath: Vec3,
  anisotropy = 0,
): HomogeneousMedium {
  const alpha = singleScatterAlbedo(diffuseAlbedo);
  const sigmaT = extinctionFromMeanFreePath(meanFreePath, diffuseAlbedo);
  const scattering: Vec3 = [alpha[0] * sigmaT[0], alpha[1] * sigmaT[1], alpha[2] * sigmaT[2]];
  const absorption: Vec3 = [
    (1 - alpha[0]) * sigmaT[0],
    (1 - alpha[1]) * sigmaT[1],
    (1 - alpha[2]) * sigmaT[2],
  ];
  return { absorption, scattering, anisotropy };
}
