// HDR output: exposure, tonemapping, antialiasing resolve and output encoding
// (plan sections 9.1 and 9.4, T026). Tonemapping is kept strictly separate from
// light transport: these functions operate on already-resolved HDR radiance and
// never feed back into shading. Output encoding respects declared colour spaces;
// a Raw buffer is never silently treated as sRGB. This is the CPU reference the
// raster resolve pass mirrors in WGSL (see render/raster/shaders.ts).

import type { Vec3 } from '../scene/transforms.ts';

export type Tonemap = 'none' | 'reinhard' | 'acesFilmic';
export type OutputColorSpace = 'lin_rec709' | 'raw';
export type AntialiasMethod = 'none' | 'msaa' | 'supersample';

/** Scales linear radiance by 2^exposureEv before tonemapping. */
export function applyExposure(color: Vec3, exposureEv: number): Vec3 {
  const s = Math.pow(2, exposureEv);
  return [color[0] * s, color[1] * s, color[2] * s];
}

function reinhard(c: number): number {
  const x = Math.max(c, 0);
  return x / (1 + x);
}

function acesFilmic(c: number): number {
  // Narkowicz 2015 ACES filmic approximation.
  const a = 2.51;
  const b = 0.03;
  const cc = 2.43;
  const d = 0.59;
  const e = 0.14;
  const x = Math.max(c, 0);
  return Math.min(Math.max((x * (a * x + b)) / (x * (cc * x + d) + e), 0), 1);
}

export function tonemap(color: Vec3, op: Tonemap): Vec3 {
  switch (op) {
    case 'none':
      return [color[0], color[1], color[2]];
    case 'reinhard':
      return [reinhard(color[0]), reinhard(color[1]), reinhard(color[2])];
    case 'acesFilmic':
      return [acesFilmic(color[0]), acesFilmic(color[1]), acesFilmic(color[2])];
  }
}

function srgbChannel(c: number): number {
  const x = Math.min(Math.max(c, 0), 1);
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

export interface EncodedOutput {
  color: Vec3;
  /** False when the space is Raw and must be delivered unencoded. */
  encoded: boolean;
}

/**
 * Encodes resolved display-referred colour for the output space. lin_rec709 gets
 * the sRGB OETF; Raw is passed through unchanged and flagged, never silently
 * reinterpreted as sRGB (plan 9.4).
 */
export function encodeOutput(color: Vec3, space: OutputColorSpace): EncodedOutput {
  if (space === 'raw') {
    return { color: [color[0], color[1], color[2]], encoded: false };
  }
  return {
    color: [srgbChannel(color[0]), srgbChannel(color[1]), srgbChannel(color[2])],
    encoded: true,
  };
}

/** Box-resolves MSAA/supersample samples into a single radiance value. */
export function resolveSamples(samples: readonly Vec3[]): Vec3 {
  if (samples.length === 0) return [0, 0, 0];
  const acc: [number, number, number] = [0, 0, 0];
  for (const s of samples) {
    acc[0] += s[0];
    acc[1] += s[1];
    acc[2] += s[2];
  }
  const n = samples.length;
  return [acc[0] / n, acc[1] / n, acc[2] / n];
}

export interface AntialiasConfig {
  method: AntialiasMethod;
  /** MSAA/supersample sample count; ignored for 'none'. */
  sampleCount?: number;
}

export interface AntialiasPlan {
  method: AntialiasMethod;
  sampleCount: number;
}

export function planAntialias(config: AntialiasConfig): AntialiasPlan {
  if (config.method === 'none') return { method: 'none', sampleCount: 1 };
  const requested = config.sampleCount ?? (config.method === 'msaa' ? 4 : 2);
  return { method: config.method, sampleCount: Math.max(1, Math.floor(requested)) };
}

export interface HdrResolveConfig {
  exposureEv?: number;
  tonemap?: Tonemap;
  outputSpace?: OutputColorSpace;
}

/**
 * Full HDR resolve for one pixel: antialiasing resolve, exposure, tonemapping
 * (distinct from transport) and output encoding, in that fixed order.
 */
export function resolvePixel(
  samples: readonly Vec3[],
  config: HdrResolveConfig = {},
): EncodedOutput {
  const exposureEv = config.exposureEv ?? 0;
  const op = config.tonemap ?? 'acesFilmic';
  const space = config.outputSpace ?? 'lin_rec709';
  const resolved = resolveSamples(samples);
  const exposed = applyExposure(resolved, exposureEv);
  const mapped = tonemap(exposed, op);
  return encodeOutput(mapped, space);
}
