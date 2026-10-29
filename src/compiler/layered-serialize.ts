// T055e1: stable JSON (de)serialization for the runtime LayeredClosure (ir.ts).
// The fixture builder (scripts/build-scene-materials) and any consumer that
// persists a lowered surface share this one rounding + key-ordering convention,
// so the emitted JSON is deterministic and round-trips back to an equivalent
// closure. No shading logic lives here -- it is a pure data codec.

import type {
  LayeredBsdfLobe,
  LayeredClosure,
  Rgb,
} from './ir.ts';

/** Round to a fixed number of decimals, normalizing -0 to 0, for stable output. */
export function roundTo(x: number, decimals = 6): number {
  return Number.parseFloat(x.toFixed(decimals)) + 0;
}

type Rgb3 = [number, number, number];

function rgb(c: Rgb, d: number): Rgb3 {
  return [roundTo(c[0], d), roundTo(c[1], d), roundTo(c[2], d)];
}

function tuple(a: Rgb3): Rgb {
  return [a[0], a[1], a[2]];
}

export interface SerializedBsdfLobe {
  kind: LayeredBsdfLobe['kind'];
  weight: number;
  color: Rgb3;
  color90?: Rgb3;
  hairTintTRT?: Rgb3;
  roughness?: number;
  anisotropy?: number;
  rotation?: number;
  ior?: number;
  extinction?: Rgb3;
  thinWalled?: boolean;
}

export interface SerializedCoatLayer {
  weight: number;
  color: Rgb3;
  roughness: number;
  ior: number;
}

export interface SerializedSheenLayer {
  weight: number;
  color: Rgb3;
  roughness: number;
}

export interface SerializedFuzzLayer {
  weight: number;
  color: Rgb3;
  roughness: number;
}

export interface SerializedThinFilmLayer {
  weight: number;
  thickness: number;
  ior: number;
}

export interface SerializedLayeredClosure {
  lobes: SerializedBsdfLobe[];
  coat?: SerializedCoatLayer;
  sheen?: SerializedSheenLayer;
  fuzz?: SerializedFuzzLayer;
  thinFilm?: SerializedThinFilmLayer;
  emission?: Rgb3;
  opacity: number;
}

function serializeLobe(l: LayeredBsdfLobe, d: number): SerializedBsdfLobe {
  const out: SerializedBsdfLobe = { kind: l.kind, weight: roundTo(l.weight, d), color: rgb(l.color, d) };
  if (l.color90) out.color90 = rgb(l.color90, d);
  if (l.hairTintTRT) out.hairTintTRT = rgb(l.hairTintTRT, d);
  if (l.roughness !== undefined) out.roughness = roundTo(l.roughness, d);
  if (l.anisotropy !== undefined) out.anisotropy = roundTo(l.anisotropy, d);
  if (l.rotation !== undefined) out.rotation = roundTo(l.rotation, d);
  if (l.ior !== undefined) out.ior = roundTo(l.ior, d);
  if (l.extinction) out.extinction = rgb(l.extinction, d);
  if (l.thinWalled) out.thinWalled = true;
  return out;
}

/** Serialize a LayeredClosure to a plain, deterministically rounded JSON object. */
export function serializeLayeredClosure(closure: LayeredClosure, decimals = 6): SerializedLayeredClosure {
  const out: SerializedLayeredClosure = {
    lobes: closure.lobes.map((l) => serializeLobe(l, decimals)),
    opacity: roundTo(closure.opacity, decimals),
  };
  if (closure.coat) {
    out.coat = {
      weight: roundTo(closure.coat.weight, decimals),
      color: rgb(closure.coat.color, decimals),
      roughness: roundTo(closure.coat.roughness, decimals),
      ior: roundTo(closure.coat.ior, decimals),
    };
  }
  if (closure.sheen) {
    out.sheen = {
      weight: roundTo(closure.sheen.weight, decimals),
      color: rgb(closure.sheen.color, decimals),
      roughness: roundTo(closure.sheen.roughness, decimals),
    };
  }
  if (closure.fuzz) {
    out.fuzz = {
      weight: roundTo(closure.fuzz.weight, decimals),
      color: rgb(closure.fuzz.color, decimals),
      roughness: roundTo(closure.fuzz.roughness, decimals),
    };
  }
  if (closure.thinFilm) {
    out.thinFilm = {
      weight: roundTo(closure.thinFilm.weight, decimals),
      thickness: roundTo(closure.thinFilm.thickness, decimals),
      ior: roundTo(closure.thinFilm.ior, decimals),
    };
  }
  if (closure.emission) out.emission = rgb(closure.emission, decimals);
  return out;
}

function deserializeLobe(l: SerializedBsdfLobe): LayeredBsdfLobe {
  const out: LayeredBsdfLobe = { kind: l.kind, weight: l.weight, color: tuple(l.color) };
  if (l.color90) out.color90 = tuple(l.color90);
  if (l.hairTintTRT) out.hairTintTRT = tuple(l.hairTintTRT);
  if (l.roughness !== undefined) out.roughness = l.roughness;
  if (l.anisotropy !== undefined) out.anisotropy = l.anisotropy;
  if (l.rotation !== undefined) out.rotation = l.rotation;
  if (l.ior !== undefined) out.ior = l.ior;
  if (l.extinction) out.extinction = tuple(l.extinction);
  if (l.thinWalled) out.thinWalled = true;
  return out;
}

/** Rebuild a LayeredClosure from its serialized JSON form. */
export function deserializeLayeredClosure(data: SerializedLayeredClosure): LayeredClosure {
  const out: LayeredClosure = { lobes: data.lobes.map(deserializeLobe), opacity: data.opacity };
  if (data.coat) out.coat = { weight: data.coat.weight, color: tuple(data.coat.color), roughness: data.coat.roughness, ior: data.coat.ior };
  if (data.sheen) out.sheen = { weight: data.sheen.weight, color: tuple(data.sheen.color), roughness: data.sheen.roughness };
  if (data.fuzz) out.fuzz = { weight: data.fuzz.weight, color: tuple(data.fuzz.color), roughness: data.fuzz.roughness };
  if (data.thinFilm) out.thinFilm = { weight: data.thinFilm.weight, thickness: data.thinFilm.thickness, ior: data.thinFilm.ior };
  if (data.emission) out.emission = tuple(data.emission);
  return out;
}
