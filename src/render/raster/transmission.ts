// Transmission and transparency planning/evaluation for the raster backend
// (plan sections 9.1 and 9.4, T024). The raster path only approximates these
// effects, so every technique here declares its approximations and screen-space
// limits explicitly. This module computes the CPU-side data the generated WGSL
// consumes (absorption, refraction, technique selection); it records no GPU
// commands.

import type { Vec3 } from '../../scene/transforms.ts';

// --- Transmission: refraction, thickness and absorption -------------------

export interface TransmissionMaterial {
  /** Index of refraction of the medium behind the interface. */
  ior: number;
  /** Interface-to-interface path length used for absorption, in scene units. */
  thickness: number;
  /** Tint reached after travelling `attenuationDistance` through the medium. */
  attenuationColor: Vec3;
  /** Reference distance for `attenuationColor`; Infinity disables absorption. */
  attenuationDistance: number;
  /** Interface roughness; drives the specular mip used for rough refraction. */
  roughness?: number;
}

/**
 * Beer-Lambert transmittance over `distance`. `attenuationColor` is the tint
 * reached at `attenuationDistance`, so the per-channel coefficient is
 * sigma = -ln(color)/attenuationDistance and transmittance = color^(d/d0).
 */
export function absorptionTransmittance(
  attenuationColor: Vec3,
  attenuationDistance: number,
  distance: number,
): Vec3 {
  if (!(attenuationDistance > 0) || !isFinite(attenuationDistance)) {
    return [1, 1, 1];
  }
  const ratio = Math.max(0, distance) / attenuationDistance;
  return attenuationColor.map((c) => {
    const clamped = Math.min(Math.max(c, 0), 1);
    return clamped <= 0 ? 0 : Math.pow(clamped, ratio);
  }) as unknown as Vec3;
}

function normalize3(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len > 0 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 0];
}

/**
 * Refracted direction for an incident ray hitting a surface, using the GLSL
 * `refract` convention. `eta` is n1/n2. Returns null on total internal
 * reflection, where the raster backend must fall back to reflection.
 */
export function refract(incident: Vec3, normal: Vec3, eta: number): Vec3 | null {
  const i = normalize3(incident);
  const n = normalize3(normal);
  const dotNI = i[0] * n[0] + i[1] * n[1] + i[2] * n[2];
  const k = 1 - eta * eta * (1 - dotNI * dotNI);
  if (k < 0) return null;
  const f = eta * dotNI + Math.sqrt(k);
  return [eta * i[0] - f * n[0], eta * i[1] - f * n[1], eta * i[2] - f * n[2]];
}

export interface ScreenSpaceTransmissionPlan {
  /** Specular mip sampled for rough refraction (0 = sharpest). */
  refractionMip: number;
  /** Absorption transmittance for `material.thickness`. */
  transmittance: Vec3;
  /** Whether the refracted ray may leave the captured colour buffer. */
  screenSpace: true;
  /** Declared approximations and hard limits of the screen-space technique. */
  limitations: readonly string[];
}

export interface PlanScreenSpaceTransmissionOptions {
  material: TransmissionMaterial;
  /** Number of prefiltered specular mips available for rough refraction. */
  specularMips?: number;
}

/**
 * Plans single-interface screen-space refraction and declares its limits:
 * only the captured opaque colour buffer is refracted, so geometry outside the
 * frame or behind the first interface is missing, and only one refraction
 * interface is modelled.
 */
export function planScreenSpaceTransmission(
  options: PlanScreenSpaceTransmissionOptions,
): ScreenSpaceTransmissionPlan {
  const { material } = options;
  const specularMips = options.specularMips ?? 6;
  const roughness = Math.min(Math.max(material.roughness ?? 0, 0), 1);
  const refractionMip = roughness * Math.max(0, specularMips - 1);
  const transmittance = absorptionTransmittance(
    material.attenuationColor,
    material.attenuationDistance,
    material.thickness,
  );
  return {
    refractionMip,
    transmittance,
    screenSpace: true,
    limitations: [
      'screen-space refraction: off-screen and occluded geometry is not refracted',
      'single refraction interface only (no nested dielectrics)',
      'thickness drives absorption only, not multi-bounce light paths',
    ],
  };
}

// --- Transparency: order-independent compositing --------------------------

export type TransparencyTechnique = 'none' | 'sorted' | 'weightedBlended' | 'depthPeeling';

export interface TransparencyPlan {
  technique: TransparencyTechnique;
  /** True only when the technique composites all layers exactly. */
  exact: boolean;
  /** Declared approximations of the chosen technique. */
  approximations: readonly string[];
}

export interface PlanTransparencyOptions {
  /** Maximum number of transparent layers overlapping any pixel. */
  layerCount: number;
  /** Request an exact composite; selects bounded depth peeling. */
  exactRequired?: boolean;
  /** Peeled-layer budget when exact compositing is requested; defaults to 8. */
  maxPeeledLayers?: number;
}

/**
 * Selects a transparency technique. A single sort or weighted-blended OIT does
 * not guarantee an exact result for intersecting or many overlapping layers
 * (plan 9.1), so those are reported as approximations. Depth peeling is exact
 * only up to its layer budget.
 */
export function planTransparency(options: PlanTransparencyOptions): TransparencyPlan {
  const layers = Math.max(0, Math.floor(options.layerCount));
  if (layers === 0) {
    return { technique: 'none', exact: true, approximations: [] };
  }
  if (options.exactRequired) {
    const budget = Math.max(1, options.maxPeeledLayers ?? 8);
    const exact = layers <= budget;
    return {
      technique: 'depthPeeling',
      exact,
      approximations: exact
        ? []
        : [`depth peeling bounded to ${budget} layers; deeper layers are dropped`],
    };
  }
  if (layers === 1) {
    return {
      technique: 'sorted',
      exact: false,
      approximations: ['per-primitive sort: intersecting geometry composites incorrectly'],
    };
  }
  return {
    technique: 'weightedBlended',
    exact: false,
    approximations: ['weighted-blended OIT: order-independent blend is an approximation, not exact'],
  };
}
