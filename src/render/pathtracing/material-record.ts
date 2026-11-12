// T057b: GPU material record codec for the path-tracer megakernel. A runtime
// LayeredClosure (ir.ts) is packed into a flat f32 record so the single
// megakernel can read any hit material (decision T057a) and rebuild the
// LayeredClosure WGSL struct (LAYERED_CLOSURE_PRELUDE, surface-wgsl.ts) before
// calling the shared closure library (mx_closure_eval/pdf/sample, T056). This
// module is pure data: no shading logic. It is additive -- scene-buffers.ts does
// not consume it until T057c, and the WGSL reader is not wired into compute.ts
// until T057d. A per-lobe presence bitmask makes the pack/unpack pair a faithful
// round-trip of the optional lobe fields.

import type {
  BsdfLobeKind,
  LayeredBsdfLobe,
  LayeredClosure,
  Rgb,
} from '../../compiler/ir.ts';
import type { VolumeMedium } from '../../compiler/volume-ir.ts';

/** Max lobes packed per material; matches MX_MAX_LOBES in LAYERED_CLOSURE_PRELUDE. */
export const PT_MAX_LOBES = 8;

/** f32 stride of one packed lobe (kind, weight, flags, colors, scalars, extinction, medium, hair TRT tint). */
export const PT_LOBE_FLOATS = 27;

/** f32 count of the per-material header that precedes the lobe array. */
export const PT_MATERIAL_HEADER_FLOATS = 57;

/** f32 stride of one complete packed material record. */
export const PT_MATERIAL_RECORD_FLOATS =
  PT_MATERIAL_HEADER_FLOATS + PT_MAX_LOBES * PT_LOBE_FLOATS;

// Lobe-kind indices shared with LAYERED_CLOSURE_PRELUDE (0u..9u).
const KIND_TO_U32: Readonly<Record<BsdfLobeKind, number>> = {
  oren_nayar_diffuse: 0,
  burley_diffuse: 1,
  translucent: 2,
  dielectric_reflection: 3,
  conductor: 4,
  generalized_schlick: 5,
  sheen: 6,
  subsurface: 7,
  dielectric_transmission: 8,
  chiang_hair: 9,
};

const U32_TO_KIND: readonly BsdfLobeKind[] = [
  'oren_nayar_diffuse',
  'burley_diffuse',
  'translucent',
  'dielectric_reflection',
  'conductor',
  'generalized_schlick',
  'sheen',
  'subsurface',
  'dielectric_transmission',
  'chiang_hair',
];

/** Presence bits packed into each lobe's flags float. */
const LOBE_HAS_COLOR90 = 1;
const LOBE_HAS_ROUGHNESS = 2;
const LOBE_HAS_ANISOTROPY = 4;
const LOBE_HAS_ROTATION = 8;
const LOBE_HAS_IOR = 16;
const LOBE_HAS_EXTINCTION = 32;
const LOBE_THIN_WALLED = 64;
const LOBE_HAS_ATTENUATION = 128;
const LOBE_HAS_SUBSURFACE_RADIUS = 256;
const LOBE_HAS_DISPERSION = 512;
const LOBE_HAS_HAIR_TRT = 1024;
const LOBE_HAS_FRESNEL_EXPONENT = 2048;
const LOBE_HAS_CONDUCTOR_ETA = 4096;
const LOBE_HAS_ENERGY_COMPENSATION = 8192;
const LOBE_HAS_INTERIOR_SCATTERING = 16384;
const LOBE_HAS_SUBSURFACE_TRANSPORT = 32768;
const LOBE_HAS_SSS_INVERSION = 65536;
const LOBE_HAS_SSS_BLEED = 131072;
const LOBE_HAS_SSS_MODE = 262144;
const LOBE_HAS_SSS_TOPOLOGY = 524288;
const LOBE_HAS_SSS_SUBSET = 1048576;
const LOBE_HAS_SSS_CONTINUATION = 2097152;
const LOBE_PAIRED_DIELECTRIC = 4194304;
const LOBE_HAS_INTERIOR_TINT = 8388608;

function rd(buf: ArrayLike<number>, i: number): number {
  return buf[i] ?? 0;
}

function writeLobe(out: Float32Array, base: number, lobe: LayeredBsdfLobe): void {
  let flags = 0;
  if (lobe.color90 !== undefined || lobe.conductorEta !== undefined) flags |= LOBE_HAS_COLOR90;
  if (lobe.roughness !== undefined) flags |= LOBE_HAS_ROUGHNESS;
  if (lobe.anisotropy !== undefined) flags |= LOBE_HAS_ANISOTROPY;
  if (lobe.rotation !== undefined) flags |= LOBE_HAS_ROTATION;
  if (lobe.ior !== undefined) flags |= LOBE_HAS_IOR;
  if (lobe.extinction !== undefined) flags |= LOBE_HAS_EXTINCTION;
  if (lobe.thinWalled === true) flags |= LOBE_THIN_WALLED;
  if (lobe.attenuationColor !== undefined && lobe.attenuationDistance !== undefined) flags |= LOBE_HAS_ATTENUATION;
  if (lobe.subsurfaceRadius !== undefined) flags |= LOBE_HAS_SUBSURFACE_RADIUS;
  if (lobe.dispersion !== undefined) flags |= LOBE_HAS_DISPERSION;
  if (lobe.hairTintTRT !== undefined) flags |= LOBE_HAS_HAIR_TRT;
  if (lobe.fresnelExponent !== undefined) flags |= LOBE_HAS_FRESNEL_EXPONENT;
  if (lobe.conductorEta !== undefined) flags |= LOBE_HAS_CONDUCTOR_ETA;
  if (lobe.energyCompensation !== undefined) flags |= LOBE_HAS_ENERGY_COMPENSATION;
  if (lobe.interiorScattering !== undefined) flags |= LOBE_HAS_INTERIOR_SCATTERING;
  if (lobe.subsurfaceTransport !== undefined) flags |= LOBE_HAS_SUBSURFACE_TRANSPORT;
  if (lobe.subsurfaceInversion !== undefined) flags |= LOBE_HAS_SSS_INVERSION;
  if (lobe.subsurfaceBleed !== undefined) flags |= LOBE_HAS_SSS_BLEED;
  if (lobe.subsurfaceMode !== undefined) flags |= LOBE_HAS_SSS_MODE;
  if (lobe.subsurfaceFollowTopology !== undefined) flags |= LOBE_HAS_SSS_TOPOLOGY;
  if (lobe.subsurfaceSubset !== undefined) flags |= LOBE_HAS_SSS_SUBSET;
  if (lobe.subsurfaceContinuation !== undefined) flags |= LOBE_HAS_SSS_CONTINUATION;
  if (lobe.pairedDielectric) flags |= LOBE_PAIRED_DIELECTRIC;
  if (lobe.interiorTint !== undefined) flags |= LOBE_HAS_INTERIOR_TINT;

  out[base] = KIND_TO_U32[lobe.kind];
  out[base + 1] = lobe.weight;
  out[base + 2] = flags;
  out[base + 3] = lobe.color[0];
  out[base + 4] = lobe.color[1];
  out[base + 5] = lobe.color[2];
  const c90 = lobe.color90 ?? lobe.conductorEta ?? lobe.color;
  out[base + 6] = c90[0];
  out[base + 7] = c90[1];
  out[base + 8] = c90[2];
  out[base + 9] = lobe.subsurfaceInversion ?? lobe.roughness ?? 0;
  out[base + 10] = lobe.anisotropy ?? 0;
  out[base + 11] = lobe.subsurfaceSubset ?? lobe.rotation ?? 0;
  out[base + 12] = lobe.ior ?? 0;
  const ext = lobe.extinction ?? lobe.interiorScattering ?? [0, 0, 0];
  out[base + 13] = ext[0];
  if (lobe.subsurfaceMode !== undefined) out[base + 13] = lobe.subsurfaceMode;
  out[base + 14] = lobe.subsurfaceFollowTopology ?? ext[1];
  out[base + 15] = lobe.subsurfaceBleed ?? ext[2];
  const atten = lobe.attenuationColor ?? [0, 0, 0];
  out[base + 16] = atten[0];
  out[base + 17] = atten[1];
  out[base + 18] = atten[2];
  out[base + 19] = lobe.subsurfaceContinuation === undefined ? lobe.attenuationDistance ?? 0 : Number(lobe.subsurfaceContinuation);
  const radius = lobe.subsurfaceRadius ?? [0, 0, 0];
  out[base + 20] = radius[0];
  out[base + 21] = radius[1];
  out[base + 22] = radius[2];
  out[base + 23] = lobe.subsurfaceTransport ?? lobe.dispersion ?? lobe.fresnelExponent ?? lobe.energyCompensation ?? lobe.interiorAnisotropy ?? 0;
  const trt = lobe.hairTintTRT ?? lobe.interiorTint ?? (lobe.kind === 'subsurface' ? lobe.subsurfaceRadius ?? [0, 0, 0] : [1, 1, 1]);
  out[base + 24] = trt[0];
  out[base + 25] = trt[1];
  out[base + 26] = trt[2];
}

function readLobe(buf: ArrayLike<number>, base: number): LayeredBsdfLobe {
  const kindIndex = Math.round(rd(buf, base));
  const kind = U32_TO_KIND[kindIndex] ?? 'oren_nayar_diffuse';
  const flags = Math.round(rd(buf, base + 2));
  const color: Rgb = [rd(buf, base + 3), rd(buf, base + 4), rd(buf, base + 5)];
  const lobe: LayeredBsdfLobe = { kind, weight: rd(buf, base + 1), color };
  if ((flags & LOBE_PAIRED_DIELECTRIC) !== 0) lobe.pairedDielectric = true;
  if ((flags & LOBE_HAS_SUBSURFACE_TRANSPORT) !== 0) lobe.subsurfaceTransport = Math.round(rd(buf, base + 23)) as 0 | 1 | 2 | 3;
  if ((flags & LOBE_HAS_SSS_INVERSION) !== 0) lobe.subsurfaceInversion = rd(buf, base + 9) as 0 | 1;
  if ((flags & LOBE_HAS_SSS_BLEED) !== 0) lobe.subsurfaceBleed = rd(buf, base + 15);
  if ((flags & LOBE_HAS_SSS_MODE) !== 0) lobe.subsurfaceMode = rd(buf, base + 13) as 0 | 1 | 2;
  if ((flags & LOBE_HAS_SSS_TOPOLOGY) !== 0) lobe.subsurfaceFollowTopology = rd(buf, base + 14);
  if ((flags & LOBE_HAS_SSS_SUBSET) !== 0) lobe.subsurfaceSubset = rd(buf, base + 11);
  if ((flags & LOBE_HAS_SSS_CONTINUATION) !== 0) lobe.subsurfaceContinuation = rd(buf, base + 19) !== 0;
  if ((flags & LOBE_HAS_FRESNEL_EXPONENT) !== 0) lobe.fresnelExponent = rd(buf, base + 23);
  if ((flags & LOBE_HAS_HAIR_TRT) !== 0) {
    lobe.hairTintTRT = [rd(buf, base + 24), rd(buf, base + 25), rd(buf, base + 26)];
  }
  if ((flags & LOBE_HAS_INTERIOR_TINT) !== 0) {
    lobe.interiorTint = [rd(buf, base + 24), rd(buf, base + 25), rd(buf, base + 26)];
  }
  if ((flags & LOBE_HAS_CONDUCTOR_ETA) !== 0) {
    lobe.conductorEta = [rd(buf, base + 6), rd(buf, base + 7), rd(buf, base + 8)];
  }
  if ((flags & LOBE_HAS_ENERGY_COMPENSATION) !== 0) lobe.energyCompensation = rd(buf, base + 23);
  if ((flags & LOBE_HAS_INTERIOR_SCATTERING) !== 0) {
    lobe.interiorScattering = [rd(buf, base + 13), rd(buf, base + 14), rd(buf, base + 15)];
    lobe.interiorAnisotropy = rd(buf, base + 23);
  }
  if ((flags & LOBE_HAS_DISPERSION) !== 0) lobe.dispersion = rd(buf, base + 23);
  if ((flags & LOBE_HAS_COLOR90) !== 0) {
    lobe.color90 = [rd(buf, base + 6), rd(buf, base + 7), rd(buf, base + 8)];
  }
  if ((flags & LOBE_HAS_ROUGHNESS) !== 0) lobe.roughness = rd(buf, base + 9);
  if ((flags & LOBE_HAS_ANISOTROPY) !== 0) lobe.anisotropy = rd(buf, base + 10);
  if ((flags & LOBE_HAS_ROTATION) !== 0) lobe.rotation = rd(buf, base + 11);
  if ((flags & LOBE_HAS_IOR) !== 0) lobe.ior = rd(buf, base + 12);
  if ((flags & LOBE_HAS_EXTINCTION) !== 0) {
    lobe.extinction = [rd(buf, base + 13), rd(buf, base + 14), rd(buf, base + 15)];
  }
  if ((flags & LOBE_THIN_WALLED) !== 0) lobe.thinWalled = true;
  if ((flags & LOBE_HAS_ATTENUATION) !== 0) {
    lobe.attenuationColor = [rd(buf, base + 16), rd(buf, base + 17), rd(buf, base + 18)];
    lobe.attenuationDistance = rd(buf, base + 19);
  }
  if ((flags & LOBE_HAS_SUBSURFACE_RADIUS) !== 0) {
    lobe.subsurfaceRadius = [rd(buf, base + 20), rd(buf, base + 21), rd(buf, base + 22)];
  }
  return lobe;
}

/** Pack one LayeredClosure into a flat record of PT_MATERIAL_RECORD_FLOATS floats. */
export function packLayeredMaterial(closure: LayeredClosure, medium?: VolumeMedium, volumeBoundary = false): Float32Array {
  const out = new Float32Array(PT_MATERIAL_RECORD_FLOATS);
  const lobeCount = Math.min(closure.lobes.length, PT_MAX_LOBES);
  out[0] = lobeCount;
  out[1] = volumeBoundary ? 0 : closure.opacity;
  out[2] = closure.coat !== undefined ? 1 : 0;
  out[3] = closure.sheen !== undefined ? 1 : 0;
  out[4] = closure.fuzz !== undefined ? 1 : 0;
  out[5] = closure.thinFilm !== undefined ? 1 : 0;
  out[6] = closure.emission !== undefined ? 1 : 0;
  const emission = closure.emission ?? [0, 0, 0];
  out[7] = emission[0];
  out[8] = emission[1];
  out[9] = emission[2];
  if (closure.coat !== undefined) {
    const c = closure.coat;
    out[10] = c.weight;
    out[11] = c.color[0];
    out[12] = c.color[1];
    out[13] = c.color[2];
    out[14] = c.roughness;
    out[15] = c.ior;
    out[41] = c.mode === 'smooth_coating' ? 1 : c.mode === 'rough_coating' ? 2 : 0;
    out[42] = c.topThickness ?? 0;
    out.set(c.absorption ?? [0, 0, 0], 43);
    out[46] = c.mode !== undefined ? 1 : 0;
  }
  if (closure.sheen !== undefined) {
    const s = closure.sheen;
    out[16] = s.weight;
    out[17] = s.color[0];
    out[18] = s.color[1];
    out[19] = s.color[2];
    out[20] = s.roughness;
  }
  if (closure.fuzz !== undefined) {
    const f = closure.fuzz;
    out[21] = f.weight;
    out[22] = f.color[0];
    out[23] = f.color[1];
    out[24] = f.color[2];
    out[25] = f.roughness;
  }
  if (closure.thinFilm !== undefined) {
    const t = closure.thinFilm;
    out[26] = t.weight;
    out[27] = t.thickness;
    out[28] = t.ior;
    out[55] = t.incidentAngleScale ?? 1;
    out[56] = t.incidentAngleOffset ?? 0;
    if (t.targetHue) {
      out.set(t.targetHue, 51);
      out[54] = 1;
    }
  }
  if (medium) {
    out[29] = 1;
    out.set(medium.absorption, 30);
    out.set(medium.scattering, 33);
    out[36] = medium.anisotropy;
    out[37] = volumeBoundary ? 1 : 0;
    out.set(medium.emission ?? [0, 0, 0], 38);
    if (!out.slice(30,41).every(Number.isFinite) || Math.abs(out[36]!) >= 1) {
      throw new Error('Volume coefficients exceed the float32 transport range.');
    }
  }
  for (let i = 0; i < lobeCount; i++) {
    const lobe = closure.lobes[i];
    if (lobe === undefined) continue;
    writeLobe(out, PT_MATERIAL_HEADER_FLOATS + i * PT_LOBE_FLOATS, lobe);
  }
  return out;
}

/** Largest lobe count among the packed records, ignoring the material indices in `skip`. */
export function maxRecordLobes(materials: ArrayLike<number>, skip: ReadonlySet<number> = new Set()): number {
  let max = 0;
  for (let index = 0; index * PT_MATERIAL_RECORD_FLOATS < materials.length; index++) {
    if (skip.has(index)) continue;
    max = Math.max(max, Math.min(Math.round(rd(materials, index * PT_MATERIAL_RECORD_FLOATS)), PT_MAX_LOBES));
  }
  return max;
}

/** Unpack material `index` from a buffer of concatenated records into a LayeredClosure. */
export function unpackLayeredMaterial(
  buf: ArrayLike<number>,
  index = 0,
): LayeredClosure {
  const base = index * PT_MATERIAL_RECORD_FLOATS;
  const lobeCount = Math.min(Math.round(rd(buf, base)), PT_MAX_LOBES);
  const lobes: LayeredBsdfLobe[] = [];
  for (let i = 0; i < lobeCount; i++) {
    lobes.push(readLobe(buf, base + PT_MATERIAL_HEADER_FLOATS + i * PT_LOBE_FLOATS));
  }
  const closure: LayeredClosure = { lobes, opacity: rd(buf, base + 1) };
  if (Math.round(rd(buf, base + 2)) !== 0) {
    closure.coat = {
      weight: rd(buf, base + 10),
      color: [rd(buf, base + 11), rd(buf, base + 12), rd(buf, base + 13)],
      roughness: rd(buf, base + 14),
      ior: rd(buf, base + 15),
      ...(rd(buf, base + 46) !== 0 ? { mode: rd(buf, base + 41) === 1 ? 'smooth_coating' as const
        : rd(buf, base + 41) === 2 ? 'rough_coating' as const : 'fresnel_blend' as const } : {}),
      ...(rd(buf, base + 42) !== 0 ? { topThickness: rd(buf, base + 42) } : {}),
      ...(rd(buf, base + 43) !== 0 || rd(buf, base + 44) !== 0 || rd(buf, base + 45) !== 0
        ? { absorption: [rd(buf, base + 43), rd(buf, base + 44), rd(buf, base + 45)] as Rgb } : {}),
    };
  }
  if (Math.round(rd(buf, base + 3)) !== 0) {
    closure.sheen = {
      weight: rd(buf, base + 16),
      color: [rd(buf, base + 17), rd(buf, base + 18), rd(buf, base + 19)],
      roughness: rd(buf, base + 20),
    };
  }
  if (Math.round(rd(buf, base + 4)) !== 0) {
    closure.fuzz = {
      weight: rd(buf, base + 21),
      color: [rd(buf, base + 22), rd(buf, base + 23), rd(buf, base + 24)],
      roughness: rd(buf, base + 25),
    };
  }
  if (Math.round(rd(buf, base + 5)) !== 0) {
    closure.thinFilm = {
      weight: rd(buf, base + 26),
      thickness: rd(buf, base + 27),
      ior: rd(buf, base + 28),
      ...(rd(buf, base + 54) !== 0 ? { targetHue: [rd(buf, base + 51), rd(buf, base + 52), rd(buf, base + 53)] as Rgb } : {}),
      ...(rd(buf, base + 55) !== 1 ? { incidentAngleScale: rd(buf, base + 55) } : {}),
      ...(rd(buf, base + 56) !== 0 ? { incidentAngleOffset: rd(buf, base + 56) } : {}),
    };
  }
  if (Math.round(rd(buf, base + 6)) !== 0) {
    closure.emission = [rd(buf, base + 7), rd(buf, base + 8), rd(buf, base + 9)];
  }
  return closure;
}

export function unpackMaterialMedium(buf: ArrayLike<number>, index = 0): VolumeMedium | null {
  const base = index * PT_MATERIAL_RECORD_FLOATS;
  if (rd(buf, base + 29) === 0) return null;
  return {
    absorption: [rd(buf, base + 30), rd(buf, base + 31), rd(buf, base + 32)],
    scattering: [rd(buf, base + 33), rd(buf, base + 34), rd(buf, base + 35)],
    anisotropy: rd(buf, base + 36),
    ...(rd(buf, base + 38) || rd(buf, base + 39) || rd(buf, base + 40)
      ? { emission: [rd(buf, base + 38), rd(buf, base + 39), rd(buf, base + 40)] as const } : {}),
  };
}

export function isVolumeBoundary(buf: ArrayLike<number>, index = 0): boolean {
  return rd(buf, index * PT_MATERIAL_RECORD_FLOATS + 37) !== 0;
}

/**
 * WGSL reader `mx_material_closure(matIndex) -> LayeredClosure`. It reads the flat
 * record packed by packLayeredMaterial from the `materials : array<f32>` storage
 * binding and rebuilds the LayeredClosure struct (LAYERED_CLOSURE_PRELUDE). The
 * byte layout mirrors this module exactly; numeric CPU<->WGSL parity is validated
 * at device level (T059). The caller must emit LAYERED_CLOSURE_PRELUDE and declare
 * the `materials` storage buffer before this function. `mx_material_opacity(matIndex)`
 * reads only the opacity slot for alpha visibility rays (no lobe reconstruction).
 */
export function materialClosureReaderWgsl(): string {
  const stride = PT_MATERIAL_RECORD_FLOATS;
  const header = PT_MATERIAL_HEADER_FLOATS;
  const lobeStride = PT_LOBE_FLOATS;
  return `const MX_MATERIAL_RECORD_FLOATS: u32 = ${stride}u;
const MX_MATERIAL_HEADER_FLOATS: u32 = ${header}u;
const MX_LOBE_FLOATS: u32 = ${lobeStride}u;
const MX_LOBE_HAS_COLOR90: u32 = ${LOBE_HAS_COLOR90}u;
const MX_LOBE_HAS_ROUGHNESS: u32 = ${LOBE_HAS_ROUGHNESS}u;
const MX_LOBE_HAS_ANISOTROPY: u32 = ${LOBE_HAS_ANISOTROPY}u;
const MX_LOBE_HAS_ROTATION: u32 = ${LOBE_HAS_ROTATION}u;
const MX_LOBE_HAS_IOR: u32 = ${LOBE_HAS_IOR}u;
const MX_LOBE_HAS_EXTINCTION: u32 = ${LOBE_HAS_EXTINCTION}u;
const MX_LOBE_THIN_WALLED: u32 = ${LOBE_THIN_WALLED}u;
const MX_LOBE_HAS_ATTENUATION: u32 = ${LOBE_HAS_ATTENUATION}u;
const MX_LOBE_HAS_SUBSURFACE_RADIUS: u32 = ${LOBE_HAS_SUBSURFACE_RADIUS}u;
const MX_LOBE_HAS_FRESNEL_EXPONENT: u32 = ${LOBE_HAS_FRESNEL_EXPONENT}u;
const MX_LOBE_HAS_CONDUCTOR_ETA: u32 = ${LOBE_HAS_CONDUCTOR_ETA}u;
const MX_LOBE_HAS_ENERGY_COMPENSATION: u32 = ${LOBE_HAS_ENERGY_COMPENSATION}u;
const MX_LOBE_HAS_INTERIOR_SCATTERING: u32 = ${LOBE_HAS_INTERIOR_SCATTERING}u;
fn mx_material_lobe(base : u32) -> MxBsdfLobe {
  var lobe : MxBsdfLobe;
  lobe.kind = u32(round(materials[base]));
  lobe.weight = materials[base + 1u];
  let flags = u32(round(materials[base + 2u]));
  lobe.color = vec3f(materials[base + 3u], materials[base + 4u], materials[base + 5u]);
  if ((flags & MX_LOBE_HAS_COLOR90) != 0u) {
    lobe.color90 = vec3f(materials[base + 6u], materials[base + 7u], materials[base + 8u]);
  } else {
    lobe.color90 = lobe.color;
  }
  lobe.roughness = select(0.0, materials[base + 9u], (flags & MX_LOBE_HAS_ROUGHNESS) != 0u);
  if ((flags & ${LOBE_HAS_SSS_INVERSION}u) != 0u) { lobe.roughness = materials[base + 9u]; }
  lobe.anisotropy = select(0.0, materials[base + 10u], (flags & MX_LOBE_HAS_ANISOTROPY) != 0u);
  lobe.rotation = select(0.0, materials[base + 11u], (flags & MX_LOBE_HAS_ROTATION) != 0u);
  if ((flags & ${LOBE_HAS_SSS_SUBSET}u) != 0u) { lobe.rotation = materials[base + 11u]; }
  lobe.ior = select(select(0.0, materials[base + 12u], (flags & MX_LOBE_HAS_IOR) != 0u), 1.0, (flags & MX_LOBE_HAS_CONDUCTOR_ETA) != 0u);
  if ((flags & MX_LOBE_HAS_SUBSURFACE_RADIUS) != 0u && (flags & ${LOBE_HAS_SUBSURFACE_TRANSPORT}u) != 0u) { lobe.ior = max(lobe.ior, 1.0); }
  if ((flags & MX_LOBE_HAS_EXTINCTION) != 0u) {
    lobe.extinction = vec3f(materials[base + 13u], materials[base + 14u], materials[base + 15u]);
  } else {
    lobe.extinction = vec3f(0.0, 0.0, 0.0);
  }
  if ((flags & ${LOBE_HAS_SSS_BLEED}u) != 0u) { lobe.extinction.z = materials[base + 15u]; }
  lobe.extinction.x = select(lobe.extinction.x, 2.0, (flags & ${LOBE_HAS_SUBSURFACE_TRANSPORT}u) != 0u);
  if ((flags & ${LOBE_HAS_SSS_MODE}u) != 0u) { lobe.extinction.x = materials[base + 13u]; }
  lobe.thin = select(0.0, 1.0, (flags & MX_LOBE_THIN_WALLED) != 0u);
  if ((flags & ${LOBE_PAIRED_DIELECTRIC}u) != 0u) { lobe.thin = -1.0; }
  if ((flags & ${LOBE_HAS_SSS_CONTINUATION}u) != 0u) { lobe.thin = materials[base + 19u]; }
  if ((flags & ${LOBE_HAS_SSS_TOPOLOGY}u) != 0u) { lobe.extinction.y = materials[base + 14u]; }
  lobe.dispersion = materials[base + 23u];
  lobe.hairTintTRT = vec3f(materials[base + 24u], materials[base + 25u], materials[base + 26u]);
  return lobe;
}
fn mx_material_opacity(matIndex : u32) -> f32 {
  if (mx_material_volume_boundary(matIndex)) { return 0.0; }
  return materials[matIndex * MX_MATERIAL_RECORD_FLOATS + 1u];
}
fn mx_material_sss_subset(matIndex: u32) -> u32 {
  let base = matIndex * MX_MATERIAL_RECORD_FLOATS;
  let count = min(u32(round(materials[base])), MX_MAX_LOBES);
  for (var index = 0u; index < count; index++) {
    let lobe = base + MX_MATERIAL_HEADER_FLOATS + index * MX_LOBE_FLOATS;
    if (u32(round(materials[lobe])) == MX_LOBE_SUBSURFACE && (u32(round(materials[lobe + 2u])) & ${LOBE_HAS_SSS_SUBSET}u) != 0u) {
      return u32(round(materials[lobe + 11u]));
    }
  }
  return 0u;
}
fn mx_material_volume_boundary(matIndex : u32) -> bool {
  return materials[matIndex * MX_MATERIAL_RECORD_FLOATS + 37u] != 0.0;
}
fn mx_material_apply_volume(matIndex : u32, surface : LayeredClosure) -> LayeredClosure {
  var c = surface;
  let base = matIndex * MX_MATERIAL_RECORD_FLOATS;
  if (materials[base + 29u] != 0.0) {
    c.interiorSigmaA = vec3f(materials[base + 30u], materials[base + 31u], materials[base + 32u]);
    c.interiorSigmaS = vec3f(materials[base + 33u], materials[base + 34u], materials[base + 35u]);
    c.interiorG = materials[base + 36u];
    c.hasInterior = 1u;
  }
  return c;
}
fn mx_material_closure(matIndex : u32) -> LayeredClosure {
  var c : LayeredClosure;
  let base = matIndex * MX_MATERIAL_RECORD_FLOATS;
  let lobeCount = min(u32(round(materials[base])), MX_MAX_LOBES);
  c.lobeCount = lobeCount;
  c.opacity = materials[base + 1u];
  c.hasCoat = u32(round(materials[base + 2u]));
  c.hasSheen = u32(round(materials[base + 3u]));
  c.hasFuzz = u32(round(materials[base + 4u]));
  c.hasThinFilm = u32(round(materials[base + 5u]));
  c.hasEmission = u32(round(materials[base + 6u]));
  c.emission = vec3f(materials[base + 7u], materials[base + 8u], materials[base + 9u]);
  c.coat = MxCoatLayer(materials[base + 10u], vec3f(materials[base + 11u], materials[base + 12u], materials[base + 13u]), materials[base + 14u], materials[base + 15u], u32(round(materials[base + 41u])), materials[base + 42u], vec3f(materials[base + 43u], materials[base + 44u], materials[base + 45u]));
  c.sheen = MxSheenLayer(materials[base + 16u], vec3f(materials[base + 17u], materials[base + 18u], materials[base + 19u]), materials[base + 20u]);
  c.fuzz = MxFuzzLayer(materials[base + 21u], vec3f(materials[base + 22u], materials[base + 23u], materials[base + 24u]), materials[base + 25u]);
  c.thinFilm = MxThinFilmLayer(materials[base + 26u], materials[base + 27u], materials[base + 28u],
    select(vec3f(1.0), vec3f(materials[base + 51u], materials[base + 52u], materials[base + 53u]), materials[base + 54u] != 0.0),
    materials[base + 55u], materials[base + 56u]);
  for (var i : u32 = 0u; i < MX_MAX_LOBES; i = i + 1u) {
    if (i < lobeCount) {
      c.lobes[i] = mx_material_lobe(base + MX_MATERIAL_HEADER_FLOATS + i * MX_LOBE_FLOATS);
    }
  }
  // Interior participating medium derivation: subsurface radius takes priority
  // over transmissive absorption, mirroring interiorMediumFor on the CPU oracle.
  var sssFound = false;
  for (var i : u32 = 0u; i < MX_MAX_LOBES; i = i + 1u) {
    if (i >= lobeCount) { break; }
    let lb = base + MX_MATERIAL_HEADER_FLOATS + i * MX_LOBE_FLOATS;
    let kind = u32(round(materials[lb]));
    let lflags = u32(round(materials[lb + 2u]));
    if (kind == MX_LOBE_SUBSURFACE && (lflags & MX_LOBE_HAS_SUBSURFACE_RADIUS) != 0u && !sssFound) {
      let scol = vec3f(materials[lb + 3u], materials[lb + 4u], materials[lb + 5u]);
      let radius = vec3f(materials[lb + 20u], materials[lb + 21u], materials[lb + 22u]);
      let g = select(0.0, materials[lb + 10u], (lflags & MX_LOBE_HAS_ANISOTROPY) != 0u);
      if ((lflags & ${LOBE_HAS_SUBSURFACE_TRANSPORT}u) != 0u && materials[lb + 23u] >= 2.0) { continue; }
      var m = mx_subsurface_medium(scol, radius, g);
      if ((lflags & ${LOBE_HAS_SUBSURFACE_TRANSPORT}u) != 0u) {
        let inversion = select(1.0, materials[lb + 9u], (lflags & ${LOBE_HAS_SSS_INVERSION}u) != 0u);
        let alpha = mx_sss_controls_alpha(scol, g, c.lobes[i].ior, inversion);
        let sigmaT = mx_sss_controls_sigma_t(scol, radius, inversion);
        m = MxMedium((vec3f(1.0) - alpha) * sigmaT, alpha * sigmaT, g);
      }
      c.interiorSigmaA = m.sigmaA;
      c.interiorSigmaS = m.sigmaS;
      c.interiorG = m.g;
      c.hasInterior = select(0u, 1u, any(radius > vec3f(0.0)));
      sssFound = true;
    }
  }
  if (!sssFound) {
    for (var i : u32 = 0u; i < MX_MAX_LOBES; i = i + 1u) {
      if (i >= lobeCount) { break; }
      let lb = base + MX_MATERIAL_HEADER_FLOATS + i * MX_LOBE_FLOATS;
      let kind = u32(round(materials[lb]));
      let lflags = u32(round(materials[lb + 2u]));
      if (kind == MX_LOBE_DIELECTRIC_TRANSMISSION && (lflags & MX_LOBE_HAS_ATTENUATION) != 0u && c.hasInterior == 0u) {
        let acol = vec3f(materials[lb + 16u], materials[lb + 17u], materials[lb + 18u]);
        let adist = materials[lb + 19u];
        var m = mx_absorbing_medium(acol, adist);
        if ((lflags & MX_LOBE_HAS_INTERIOR_SCATTERING) != 0u) {
          m.sigmaS = vec3f(materials[lb + 13u], materials[lb + 14u], materials[lb + 15u]);
          m.g = materials[lb + 23u];
        }
        c.interiorSigmaA = m.sigmaA;
        c.interiorSigmaS = m.sigmaS;
        c.interiorG = m.g;
        c.hasInterior = 1u;
      }
    }
  }
  return mx_material_apply_volume(matIndex, c);
}`;
}
