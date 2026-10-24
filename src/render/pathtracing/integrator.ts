// Path tracing integrator core (plan section 9.2, T027). A unidirectional path
// tracer with next-event estimation, multiple importance sampling (MIS) and
// unbiased Russian-roulette termination -- no fixed, biased path-depth cutoff.
// The scene is accessed through an injectable SceneSampler so the transport loop
// can be driven by analytic test scenes without a GPU. This is the reference
// estimator; the compute backend mirrors its math. No model approximations are
// introduced here (the path tracer stays unbiased).

import type { Vec3 } from '../../scene/transforms.ts';
import type { HomogeneousMedium } from './media.ts';
import { phaseHG, sampleHenyeyGreenstein, sampleHomogeneous } from './media.ts';

export type Rng = () => number;

type V = Vec3;
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V, b: V): V => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const scale = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const neg = (a: V): V => [-a[0], -a[1], -a[2]];
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const maxComponent = (a: V): number => Math.max(a[0], a[1], a[2]);
const distanceBetween = (a: V, b: V): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * PCG32 (O'Neill 2014) mapped to [0,1). Deterministic and seedable so Monte
 * Carlo runs are reproducible for testing.
 */
export function createPcg32(seed: number): Rng {
  const mult = 6364136223846793005n;
  const inc = 1442695040888963407n;
  let state = BigInt.asUintN(64, BigInt(Math.trunc(seed)) * mult + inc);
  return () => {
    const old = state;
    state = BigInt.asUintN(64, old * mult + inc);
    const xorshifted = Number(BigInt.asUintN(32, ((old >> 18n) ^ old) >> 27n));
    const rot = Number(old >> 59n);
    const result = ((xorshifted >>> rot) | (xorshifted << ((-rot >>> 0) & 31))) >>> 0;
    return result / 4294967296;
  };
}

/** Balance heuristic weight for two sampling strategies. */
export function balanceHeuristic(nf: number, fPdf: number, ng: number, gPdf: number): number {
  const f = nf * fPdf;
  const g = ng * gPdf;
  const denom = f + g;
  return denom > 0 ? f / denom : 0;
}

/** Power heuristic (beta = 2) weight for two sampling strategies. */
export function powerHeuristic(nf: number, fPdf: number, ng: number, gPdf: number): number {
  const f = nf * fPdf;
  const g = ng * gPdf;
  const f2 = f * f;
  const denom = f2 + g * g;
  return denom > 0 ? f2 / denom : 0;
}

export interface RouletteDecision {
  survive: boolean;
  /** Throughput compensation (1/q) when surviving, else 0. */
  scale: number;
}

/**
 * Unbiased Russian-roulette decision from the current throughput. Survival
 * probability is the largest throughput channel clamped to [0,0.95]; survivors
 * are scaled by 1/q so the estimator stays unbiased.
 */
export function russianRoulette(throughput: Vec3, u: number): RouletteDecision {
  const q = Math.min(Math.max(maxComponent(throughput), 0), 0.95);
  if (q <= 0 || u >= q) return { survive: false, scale: 0 };
  return { survive: true, scale: 1 / q };
}

/** Online accumulator for progressive sample averaging per pixel. */
export class RadianceAccumulator {
  private sum: [number, number, number] = [0, 0, 0];
  private count = 0;

  addSample(value: Vec3): void {
    this.sum[0] += value[0];
    this.sum[1] += value[1];
    this.sum[2] += value[2];
    this.count += 1;
  }

  get samples(): number {
    return this.count;
  }

  get mean(): Vec3 {
    if (this.count === 0) return [0, 0, 0];
    return [this.sum[0] / this.count, this.sum[1] / this.count, this.sum[2] / this.count];
  }
}

export interface Ray {
  origin: Vec3;
  direction: Vec3;
}

export interface SurfaceHit {
  position: Vec3;
  normal: Vec3;
  /** Coverage opacity, after applying alpha mode/cutoff; omitted means opaque. */
  opacity?: number;
  /** Emitted radiance if the surface is a light; omitted otherwise. */
  emission?: Vec3;
  /** Homogeneous medium filling the interior side of this surface; entered on transmission. */
  interiorMedium?: HomogeneousMedium;
}

export interface BsdfSample {
  /** Sampled scattering direction (world space). */
  direction: Vec3;
  /** BSDF value f(wo, wi). */
  value: Vec3;
  /** Solid-angle pdf of the sampled direction. */
  pdf: number;
  /** True for delta/specular lobes; light sampling is skipped for these. */
  specular?: boolean;
  /** The sampled direction crossed the surface (refraction/transmission), toggling the active medium. */
  transmission?: boolean;
}

export interface LightSample {
  /** Direction from the shading point toward the light. */
  direction: Vec3;
  /** Incident radiance arriving along `direction`. */
  radiance: Vec3;
  /** Solid-angle pdf of having sampled this light direction. */
  pdf: number;
  /** Distance to the light, for the shadow ray. */
  distance: number;
}

export interface SceneSampler {
  intersect(ray: Ray): SurfaceHit | null;
  sampleBsdf(hit: SurfaceHit, wo: Vec3, rng: Rng): BsdfSample | null;
  evalBsdf(hit: SurfaceHit, wo: Vec3, wi: Vec3): { value: Vec3; pdf: number };
  sampleLight(hit: SurfaceHit, rng: Rng): LightSample | null;
  occluded(from: Vec3, direction: Vec3, distance: number): boolean;
  /** Solid-angle pdf of a BSDF ray hitting the light it landed on (for MIS). */
  lightPdf(from: SurfaceHit, wi: Vec3, lightHit: SurfaceHit): number;
  /** Radiance for rays that leave the scene; omit for a black environment. */
  environment?(direction: Vec3): Vec3;
  /** Solid-angle pdf of sampling the environment direction (for MIS). */
  environmentPdf?(direction: Vec3): number;
  /** Medium-aware transmittance along a shadow segment; enables volumetric NEE. Defaults to binary occluded(). */
  transmittance?(from: Vec3, direction: Vec3, distance: number): Vec3;
}

export interface IntegratorOptions {
  /** Bounces before Russian roulette begins; defaults to 3. */
  minBounces?: number;
  /** Safety bound only; RR is the unbiased terminator. Defaults to 10000. */
  maxBounces?: number;
  /** Medium the camera ray starts inside (e.g. an interior/underwater camera). */
  initialMedium?: HomogeneousMedium;
}

/**
 * Traces a single camera ray and returns its radiance estimate. Direct lighting
 * uses NEE weighted against BSDF sampling with the power heuristic; indirect
 * light continues by BSDF sampling and terminates via Russian roulette. When a
 * medium is active (camera-interior or entered through a transmissive surface),
 * free-flight sampling drives volumetric scattering with Henyey-Greenstein phase
 * transport; medium transitions assume locally convex interfaces.
 */
export function integratePath(
  scene: SceneSampler,
  cameraRay: Ray,
  rng: Rng,
  options: IntegratorOptions = {},
): Vec3 {
  const minBounces = options.minBounces ?? 3;
  const maxBounces = options.maxBounces ?? 10000;

  let radiance: V = [0, 0, 0];
  let beta: V = [1, 1, 1];
  let ray = cameraRay;
  let specularBounce = true;
  let bsdfPdf = 0;
  let prevHit: SurfaceHit | null = null;
  let medium: HomogeneousMedium | null = options.initialMedium ?? null;

  for (let bounces = 0; bounces <= maxBounces; bounces++) {
    const hit = scene.intersect(ray);
    const tMax = hit ? distanceBetween(ray.origin, hit.position) : Infinity;

    if (medium) {
      const mi = sampleHomogeneous(medium, tMax, rng);
      beta = mul(beta, mi.weight);
      if (mi.scattered) {
        const point: V = add(ray.origin, scale(ray.direction, mi.t));
        const wo = neg(ray.direction);
        if (scene.transmittance) {
          const ls = scene.sampleLight({ position: point, normal: wo }, rng);
          if (ls && ls.pdf > 0) {
            const tr = scene.transmittance(point, ls.direction, ls.distance);
            if (maxComponent(tr) > 0) {
              const phase = phaseHG(dot(wo, ls.direction), medium.anisotropy);
              const contrib = scale(mul(tr, ls.radiance), phase / ls.pdf);
              radiance = add(radiance, mul(beta, contrib));
            }
          }
        }
        // Phase is importance-sampled, so f/pdf = 1 and beta is unchanged here.
        const ps = sampleHenyeyGreenstein(wo, medium.anisotropy, rng(), rng());
        bsdfPdf = ps.pdf;
        specularBounce = false;
        prevHit = null;
        ray = { origin: point, direction: ps.wi };
        if (bounces >= minBounces) {
          const rr = russianRoulette(beta, rng());
          if (!rr.survive) break;
          beta = scale(beta, rr.scale);
        }
        continue;
      }
      // Reached the surface: the surface-reaching transmittance is already in mi.weight.
    }

    if (!hit) {
      if (scene.environment) {
        const env = scene.environment(ray.direction);
        if (specularBounce || !scene.environmentPdf) {
          radiance = add(radiance, mul(beta, env));
        } else {
          const w = powerHeuristic(1, bsdfPdf, 1, scene.environmentPdf(ray.direction));
          radiance = add(radiance, scale(mul(beta, env), w));
        }
      }
      break;
    }

    const opacity = Math.min(Math.max(hit.opacity ?? 1, 0), 1);
    if (opacity <= 0 || (opacity < 1 && rng() >= opacity)) {
      ray = { origin: add(hit.position, scale(ray.direction, 1e-4)), direction: ray.direction };
      continue;
    }

    if (hit.emission) {
      if (specularBounce || !prevHit) {
        radiance = add(radiance, mul(beta, hit.emission));
      } else {
        const w = powerHeuristic(1, bsdfPdf, 1, scene.lightPdf(prevHit, ray.direction, hit));
        radiance = add(radiance, scale(mul(beta, hit.emission), w));
      }
    }

    const wo = neg(ray.direction);

    const ls = scene.sampleLight(hit, rng);
    if (ls && ls.pdf > 0 && !scene.occluded(hit.position, ls.direction, ls.distance)) {
      const { value: f, pdf: scatterPdf } = scene.evalBsdf(hit, wo, ls.direction);
      if (maxComponent(f) > 0) {
        const cosTheta = Math.abs(dot(hit.normal, ls.direction));
        const w = powerHeuristic(1, ls.pdf, 1, scatterPdf);
        const contrib = scale(mul(f, ls.radiance), (w * cosTheta) / ls.pdf);
        radiance = add(radiance, mul(beta, contrib));
      }
    }

    const bs = scene.sampleBsdf(hit, wo, rng);
    if (!bs || bs.pdf <= 0) break;
    const cosScatter = Math.abs(dot(hit.normal, bs.direction));
    beta = mul(beta, scale(bs.value, cosScatter / bs.pdf));
    bsdfPdf = bs.pdf;
    specularBounce = bs.specular ?? false;
    prevHit = hit;
    ray = { origin: hit.position, direction: bs.direction };

    if (bs.transmission) {
      // Convex-interface assumption: entering adopts the interior medium, exiting clears it.
      medium = medium ? null : hit.interiorMedium ?? null;
    }

    if (bounces >= minBounces) {
      const rr = russianRoulette(beta, rng());
      if (!rr.survive) break;
      beta = scale(beta, rr.scale);
    }
  }

  return radiance;
}
