// Raster pass orchestration (plan section 9.1, T022). Given the per-instance
// material feature flags, the lights and a target HDR format, this builds the
// ordered frame graph of passes that are actually needed: depth prepass, shadow
// maps, opaque, transmission, transparency, subsurface, volume and the HDR
// resolve. Only passes with work are emitted. Raster approximations are allowed
// here but MUST be declared (plan 9.1), so each pass carries the approximations
// it relies on and the frame graph aggregates them. This module plans passes; it
// does not record GPU commands.

import type { FeatureFlags } from '../../compiler/features.ts';
import type { LightType } from '../../usd/lights.ts';

export type RasterPassKind =
  | 'depthPrepass'
  | 'shadow'
  | 'opaque'
  | 'transmission'
  | 'transparency'
  | 'subsurface'
  | 'volume'
  | 'hdrResolve';

export interface RasterPass {
  kind: RasterPassKind;
  reason: string;
  /** Instance ids drawn in this pass; empty for global passes. */
  draws: readonly string[];
  /** Declared raster approximations this pass relies on. */
  approximations: readonly string[];
}

export interface ShadowCaster {
  light: string;
  type: LightType;
  /** Cascade count (directional lights split the view frustum). */
  cascades: number;
}

export interface RasterFrameGraph {
  passes: readonly RasterPass[];
  shadows: readonly ShadowCaster[];
  /** HDR colour format all lit passes render into. */
  colorFormat: string;
  /** Union of every declared approximation across the frame. */
  approximations: readonly string[];
}

export interface RenderItem {
  id: string;
  flags: FeatureFlags;
}

export interface RenderLight {
  path: string;
  type: LightType;
  /** Defaults to true for direct lights, false for dome/unknown. */
  castsShadow?: boolean;
}

export interface BuildRasterFrameGraphOptions {
  items: readonly RenderItem[];
  lights?: readonly RenderLight[];
  /** HDR render target format; defaults to rgba16float. */
  hdrFormat?: string;
  /** Cascade count for directional shadows; defaults to 4. */
  shadowCascades?: number;
}

const DEFAULT_HDR_FORMAT = 'rgba16float';
const DEFAULT_CASCADES = 4;

function defaultCastsShadow(type: LightType): boolean {
  return type !== 'dome' && type !== 'unknown';
}

export function buildRasterFrameGraph(options: BuildRasterFrameGraphOptions): RasterFrameGraph {
  const colorFormat = options.hdrFormat ?? DEFAULT_HDR_FORMAT;
  const cascadeCount = Math.max(1, options.shadowCascades ?? DEFAULT_CASCADES);

  const opaque: string[] = [];
  const transmission: string[] = [];
  const transparency: string[] = [];
  const subsurface: string[] = [];
  const volume: string[] = [];

  for (const item of options.items) {
    const f = item.flags;
    if (f.volume) {
      volume.push(item.id);
    } else if (f.transmission) {
      transmission.push(item.id);
    } else if (f.transparency) {
      transparency.push(item.id);
    } else {
      opaque.push(item.id);
    }
    // Subsurface surfaces are opaque gprims shaded with an extra SSS pass.
    if (f.subsurface && !f.volume) subsurface.push(item.id);
  }

  // Depth and shadows see the solid surfaces (opaque + transmissive).
  const solid = [...opaque, ...transmission];

  const shadows: ShadowCaster[] = [];
  for (const light of options.lights ?? []) {
    const casts = light.castsShadow ?? defaultCastsShadow(light.type);
    if (!casts) continue;
    shadows.push({ light: light.path, type: light.type, cascades: light.type === 'distant' ? cascadeCount : 1 });
  }

  const passes: RasterPass[] = [];
  passes.push({ kind: 'depthPrepass', reason: 'early-z for opaque and transmissive surfaces', draws: solid, approximations: [] });

  if (shadows.length > 0 && solid.length > 0) {
    passes.push({ kind: 'shadow', reason: 'shadow maps for direct lights', draws: solid, approximations: ['filtered shadow maps and cascades approximate area occlusion'] });
  }

  passes.push({ kind: 'opaque', reason: 'Forward+ opaque shading', draws: opaque, approximations: [] });

  if (subsurface.length > 0) {
    passes.push({ kind: 'subsurface', reason: 'subsurface scattering present', draws: subsurface, approximations: ['separable screen-space diffusion approximates physical subsurface'] });
  }

  if (transmission.length > 0) {
    passes.push({ kind: 'transmission', reason: 'transmissive BSDF present', draws: transmission, approximations: ['screen-space refraction bounded to captured opaque buffer'] });
  }

  if (transparency.length > 0) {
    passes.push({ kind: 'transparency', reason: 'blended transparency present', draws: transparency, approximations: ['blended/approximate OIT does not guarantee an exact layered result'] });
  }

  if (volume.length > 0) {
    passes.push({ kind: 'volume', reason: 'volume distribution present', draws: volume, approximations: ['ray-marched transmittance and scattering with declared step quality'] });
  }

  passes.push({ kind: 'hdrResolve', reason: 'resolve HDR target (tonemapping is a separate stage)', draws: [], approximations: [] });

  const approximations = [...new Set(passes.flatMap((p) => p.approximations))].sort();
  return { passes, shadows, colorFormat, approximations };
}
