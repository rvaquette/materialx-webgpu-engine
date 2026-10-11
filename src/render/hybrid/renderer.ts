// Hybrid renderer orchestration (plan section 9.3, T031). Combines the raster
// base pass with selectively ray-traced effects (shadows, reflections,
// transmission, indirect lighting) evaluated by compute BVH traversal. No
// hardware ray tracing is assumed. Each effect declares its ray budget and
// tradeoffs, and the compositor combines the raster components with the traced
// effect layers in linear HDR. This module is GPU-free orchestration so it is
// unit testable; the actual tracing uses the path-tracing integrator/BVH.

import type { Vec3 } from '../../scene/transforms.ts';

export type HybridEffect = 'shadows' | 'reflections' | 'transmission' | 'indirect';

export interface EffectSettings {
  enabled: boolean;
  /** Rays dedicated to this effect per pixel. */
  raysPerPixel: number;
  /** Bounce depth for multi-bounce effects (reflections/transmission/indirect). */
  maxBounces?: number;
  /** Ray length cutoff (world units); omitted means unbounded. */
  maxDistance?: number;
}

export interface HybridConfig {
  shadows?: EffectSettings;
  reflections?: EffectSettings;
  transmission?: EffectSettings;
  indirect?: EffectSettings;
}

export interface EffectBudget {
  effect: HybridEffect;
  raysPerPixel: number;
  /** raysPerPixel times bounce depth: traced rays actually issued per pixel. */
  estimatedRaysPerPixel: number;
  /** Declared approximations, limits and tradeoffs for this effect. */
  tradeoffs: string[];
}

export interface HybridPlan {
  budgets: EffectBudget[];
  totalRaysPerPixel: number;
  /** Raster passes still responsible for untraced terms. */
  rasterResponsibilities: string[];
}

const EFFECT_ORDER: HybridEffect[] = ['shadows', 'reflections', 'transmission', 'indirect'];

const TRADEOFFS: Record<HybridEffect, string[]> = {
  shadows: [
    'Traced visibility replaces shadow maps; no cascade/bias artifacts.',
    'Soft shadows need multiple rays; a single ray yields hard shadows.',
  ],
  reflections: [
    'BVH traversal in compute; no hardware ray tracing assumed.',
    'Glossy reflections need multiple rays; single bounce unless maxBounces>1.',
  ],
  transmission: [
    'Refraction via traced rays; removes screen-space transmission limits.',
    'Rough transmission variance grows with roughness and needs more rays.',
  ],
  indirect: [
    'Path-traced indirect diffuse; converges with raysPerPixel.',
    'Low maxBounces truncates multi-bounce GI; declare the chosen depth.',
  ],
};

function settingsFor(config: HybridConfig, effect: HybridEffect): EffectSettings | undefined {
  return config[effect];
}

/**
 * Builds the per-effect ray budget and tradeoff plan for a hybrid frame and
 * lists the raster passes still owning the untraced terms.
 */
export function planHybrid(config: HybridConfig): HybridPlan {
  const budgets: EffectBudget[] = [];
  let total = 0;
  for (const effect of EFFECT_ORDER) {
    const s = settingsFor(config, effect);
    if (!s || !s.enabled) continue;
    const bounces = effect === 'shadows' ? 1 : Math.max(1, s.maxBounces ?? 1);
    const estimated = s.raysPerPixel * bounces;
    budgets.push({ effect, raysPerPixel: s.raysPerPixel, estimatedRaysPerPixel: estimated, tradeoffs: TRADEOFFS[effect] });
    total += estimated;
  }

  const traced = new Set(budgets.map((b) => b.effect));
  const rasterResponsibilities: string[] = ['base color and material evaluation', 'direct lighting'];
  if (!traced.has('shadows')) rasterResponsibilities.push('shadow maps');
  if (!traced.has('reflections')) rasterResponsibilities.push('screen-space / probe reflections');
  if (!traced.has('transmission')) rasterResponsibilities.push('screen-space transmission');
  if (!traced.has('indirect')) rasterResponsibilities.push('ambient / irradiance probes');

  return { budgets, totalRaysPerPixel: total, rasterResponsibilities };
}

/** Total traced rays for a frame given the plan and resolution. */
export function estimateFrameRays(plan: HybridPlan, width: number, height: number): number {
  return plan.totalRaysPerPixel * width * height;
}

export interface HybridComponents {
  emission: Vec3;
  /** Direct lighting before shadow visibility is applied. */
  directUnshadowed: Vec3;
  /** Ambient / raster indirect term. */
  ambient: Vec3;
}

export interface HybridEffectLayers {
  /** Per-channel traced visibility in [0,1]; defaults to fully lit. */
  shadowVisibility?: Vec3;
  reflection?: Vec3;
  transmission?: Vec3;
  indirect?: Vec3;
}

const ZERO: Vec3 = [0, 0, 0];
const ONE: Vec3 = [1, 1, 1];

/**
 * Composites the raster base components with the traced effect layers into the
 * final linear HDR radiance. Shadow visibility modulates the direct term;
 * reflection/transmission/indirect are additive. No tonemapping here (plan 9.4:
 * tonemapping stays separate from light transport).
 */
export function compositeHybrid(base: HybridComponents, layers: HybridEffectLayers = {}): Vec3 {
  const vis = layers.shadowVisibility ?? ONE;
  const refl = layers.reflection ?? ZERO;
  const trans = layers.transmission ?? ZERO;
  const ind = layers.indirect ?? ZERO;
  return [
    base.emission[0] + base.directUnshadowed[0] * vis[0] + base.ambient[0] + refl[0] + trans[0] + ind[0],
    base.emission[1] + base.directUnshadowed[1] * vis[1] + base.ambient[1] + refl[1] + trans[1] + ind[1],
    base.emission[2] + base.directUnshadowed[2] * vis[2] + base.ambient[2] + refl[2] + trans[2] + ind[2],
  ];
}
