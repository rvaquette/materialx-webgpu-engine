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

/** Max lobes packed per material; matches MX_MAX_LOBES in LAYERED_CLOSURE_PRELUDE. */
export const PT_MAX_LOBES = 8;

/** f32 stride of one packed lobe (kind, weight, flags, color, color90, scalars, extinction). */
export const PT_LOBE_FLOATS = 16;

/** f32 count of the per-material header that precedes the lobe array. */
export const PT_MATERIAL_HEADER_FLOATS = 29;

/** f32 stride of one complete packed material record. */
export const PT_MATERIAL_RECORD_FLOATS =
  PT_MATERIAL_HEADER_FLOATS + PT_MAX_LOBES * PT_LOBE_FLOATS;

// Lobe-kind enum shared with LAYERED_CLOSURE_PRELUDE (0u..7u). dielectric_transmission
// has no WGSL enum constant yet (the canonical lowering emits 'translucent' for
// transmission, T056e), so it is assigned the CPU-only index 8 until the BTDF lobe
// is wired into the WGSL assembler.
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
];

/** Presence bits packed into each lobe's flags float. */
const LOBE_HAS_COLOR90 = 1;
const LOBE_HAS_ROUGHNESS = 2;
const LOBE_HAS_ANISOTROPY = 4;
const LOBE_HAS_ROTATION = 8;
const LOBE_HAS_IOR = 16;
const LOBE_HAS_EXTINCTION = 32;
const LOBE_THIN_WALLED = 64;

function rd(buf: ArrayLike<number>, i: number): number {
  return buf[i] ?? 0;
}

function writeLobe(out: Float32Array, base: number, lobe: LayeredBsdfLobe): void {
  let flags = 0;
  if (lobe.color90 !== undefined) flags |= LOBE_HAS_COLOR90;
  if (lobe.roughness !== undefined) flags |= LOBE_HAS_ROUGHNESS;
  if (lobe.anisotropy !== undefined) flags |= LOBE_HAS_ANISOTROPY;
  if (lobe.rotation !== undefined) flags |= LOBE_HAS_ROTATION;
  if (lobe.ior !== undefined) flags |= LOBE_HAS_IOR;
  if (lobe.extinction !== undefined) flags |= LOBE_HAS_EXTINCTION;
  if (lobe.thinWalled === true) flags |= LOBE_THIN_WALLED;

  out[base] = KIND_TO_U32[lobe.kind];
  out[base + 1] = lobe.weight;
  out[base + 2] = flags;
  out[base + 3] = lobe.color[0];
  out[base + 4] = lobe.color[1];
  out[base + 5] = lobe.color[2];
  const c90 = lobe.color90 ?? lobe.color;
  out[base + 6] = c90[0];
  out[base + 7] = c90[1];
  out[base + 8] = c90[2];
  out[base + 9] = lobe.roughness ?? 0;
  out[base + 10] = lobe.anisotropy ?? 0;
  out[base + 11] = lobe.rotation ?? 0;
  out[base + 12] = lobe.ior ?? 0;
  const ext = lobe.extinction ?? [0, 0, 0];
  out[base + 13] = ext[0];
  out[base + 14] = ext[1];
  out[base + 15] = ext[2];
}

function readLobe(buf: ArrayLike<number>, base: number): LayeredBsdfLobe {
  const kindIndex = Math.round(rd(buf, base));
  const kind = U32_TO_KIND[kindIndex] ?? 'oren_nayar_diffuse';
  const flags = Math.round(rd(buf, base + 2));
  const color: Rgb = [rd(buf, base + 3), rd(buf, base + 4), rd(buf, base + 5)];
  const lobe: LayeredBsdfLobe = { kind, weight: rd(buf, base + 1), color };
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
  return lobe;
}

/** Pack one LayeredClosure into a flat record of PT_MATERIAL_RECORD_FLOATS floats. */
export function packLayeredMaterial(closure: LayeredClosure): Float32Array {
  const out = new Float32Array(PT_MATERIAL_RECORD_FLOATS);
  const lobeCount = Math.min(closure.lobes.length, PT_MAX_LOBES);
  out[0] = lobeCount;
  out[1] = closure.opacity;
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
  }
  for (let i = 0; i < lobeCount; i++) {
    const lobe = closure.lobes[i];
    if (lobe === undefined) continue;
    writeLobe(out, PT_MATERIAL_HEADER_FLOATS + i * PT_LOBE_FLOATS, lobe);
  }
  return out;
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
    };
  }
  if (Math.round(rd(buf, base + 6)) !== 0) {
    closure.emission = [rd(buf, base + 7), rd(buf, base + 8), rd(buf, base + 9)];
  }
  return closure;
}

/**
 * WGSL reader `mx_material_closure(matIndex) -> LayeredClosure`. It reads the flat
 * record packed by packLayeredMaterial from the `materials : array<f32>` storage
 * binding and rebuilds the LayeredClosure struct (LAYERED_CLOSURE_PRELUDE). The
 * byte layout mirrors this module exactly; numeric CPU<->WGSL parity is validated
 * at device level (T059). The caller must emit LAYERED_CLOSURE_PRELUDE and declare
 * the `materials` storage buffer before this function.
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
  lobe.anisotropy = select(0.0, materials[base + 10u], (flags & MX_LOBE_HAS_ANISOTROPY) != 0u);
  lobe.rotation = select(0.0, materials[base + 11u], (flags & MX_LOBE_HAS_ROTATION) != 0u);
  lobe.ior = select(0.0, materials[base + 12u], (flags & MX_LOBE_HAS_IOR) != 0u);
  if ((flags & MX_LOBE_HAS_EXTINCTION) != 0u) {
    lobe.extinction = vec3f(materials[base + 13u], materials[base + 14u], materials[base + 15u]);
  } else {
    lobe.extinction = vec3f(0.0, 0.0, 0.0);
  }
  return lobe;
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
  c.coat = MxCoatLayer(materials[base + 10u], vec3f(materials[base + 11u], materials[base + 12u], materials[base + 13u]), materials[base + 14u], materials[base + 15u]);
  c.sheen = MxSheenLayer(materials[base + 16u], vec3f(materials[base + 17u], materials[base + 18u], materials[base + 19u]), materials[base + 20u]);
  c.fuzz = MxFuzzLayer(materials[base + 21u], vec3f(materials[base + 22u], materials[base + 23u], materials[base + 24u]), materials[base + 25u]);
  c.thinFilm = MxThinFilmLayer(materials[base + 26u], materials[base + 27u], materials[base + 28u]);
  for (var i : u32 = 0u; i < MX_MAX_LOBES; i = i + 1u) {
    if (i < lobeCount) {
      c.lobes[i] = mx_material_lobe(base + MX_MATERIAL_HEADER_FLOATS + i * MX_LOBE_FLOATS);
    }
  }
  return c;
}`;
}
