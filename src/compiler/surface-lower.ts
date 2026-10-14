// T055b: map a resolved surface interface (src/materialx/surface-graph.ts) to a
// LayeredClosure (src/compiler/ir.ts). This is the CPU lowering that captures the
// family parameters the legacy seven-parameter canonical model discarded: coat,
// sheen, fuzz, thin film, specular anisotropy/rotation, specular tint,
// transmission colour, subsurface colour and emission. It reads only scalar/
// literal inputs; textured or procedural inputs (connection sources) resolve to
// the nodedef fallback here and are emitted into the generated shader by the
// T055c pass instead. The oracle for the result is evaluateLayeredSurface
// (src/render/bsdf/reference.ts). When fed a surface configured to the seven
// canonical parameters the base lobes reproduce canonicalSurfaceToLayered, so
// this lowering is a strict superset of the pre-P10 surface (non-regression).

import type { CoatLayer, FuzzLayer, LayeredBsdfLobe, LayeredClosure, Rgb, SheenLayer, ThinFilmLayer } from './ir.ts';
import type { NormalizedSurfaceInput, ResolvedSurface } from '../materialx/surface-graph.ts';

type Inputs = ReadonlyMap<string, NormalizedSurfaceInput>;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Literal numbers backing an input, or undefined for connection/geomprop sources. */
function read(input: NormalizedSurfaceInput | undefined): readonly number[] | undefined {
  if (!input) return undefined;
  const s = input.source;
  return s.kind === 'value' || s.kind === 'default' ? s.value : undefined;
}

function scalarOf(inputs: Inputs, name: string, fallback: number): number {
  const v = read(inputs.get(name));
  const x = v?.[0];
  return x !== undefined && Number.isFinite(x) ? x : fallback;
}

function rgbOf(inputs: Inputs, name: string, fallback: Rgb): Rgb {
  const v = read(inputs.get(name));
  if (v && v.length >= 3) return [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0];
  if (v && v.length === 1) {
    const s = v[0] ?? 0;
    return [s, s, s];
  }
  return fallback;
}

/** Specular anisotropy/rotation attached only when non-zero (isotropic stays bare). */
function anisoExtras(anisotropy: number, rotation: number): { anisotropy?: number; rotation?: number } {
  const out: { anisotropy?: number; rotation?: number } = {};
  if (anisotropy > 0) out.anisotropy = anisotropy;
  if (rotation > 0) out.rotation = rotation;
  return out;
}

const scaleRgb = (c: Rgb, s: number): Rgb => [c[0] * s, c[1] * s, c[2] * s];
const lerpRgb = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

interface Slots {
  coat?: CoatLayer;
  sheen?: SheenLayer;
  fuzz?: FuzzLayer;
  thinFilm?: ThinFilmLayer;
  emission?: Rgb;
}

function assemble(lobes: LayeredBsdfLobe[], opacity: number, slots: Slots): LayeredClosure {
  return {
    lobes: lobes.filter((l) => l.weight > 0),
    opacity: clamp01(opacity),
    ...(slots.coat ? { coat: slots.coat } : {}),
    ...(slots.sheen ? { sheen: slots.sheen } : {}),
    ...(slots.fuzz ? { fuzz: slots.fuzz } : {}),
    ...(slots.thinFilm ? { thinFilm: slots.thinFilm } : {}),
    ...(slots.emission ? { emission: slots.emission } : {}),
  };
}

// --- standard_surface --------------------------------------------------------

function lowerStandardSurface(m: Inputs): LayeredClosure {
  const base = scalarOf(m, 'base', 1);
  const metal = clamp01(scalarOf(m, 'metalness', 0));
  const trans = clamp01(scalarOf(m, 'transmission', 0));
  const spec = clamp01(scalarOf(m, 'specular', 1));
  const sss = clamp01(scalarOf(m, 'subsurface', 0));
  const specRough = scalarOf(m, 'specular_roughness', 0.2);
  const diffRough = scalarOf(m, 'diffuse_roughness', 0);
  const aniso = scalarOf(m, 'specular_anisotropy', 0);
  const rot = scalarOf(m, 'specular_rotation', 0);
  const ior = scalarOf(m, 'specular_IOR', 1.5);
  const baseColor = rgbOf(m, 'base_color', [1, 1, 1]);
  const specColor = rgbOf(m, 'specular_color', [1, 1, 1]);
  const transColor = rgbOf(m, 'transmission_color', [1, 1, 1]);
  const sssColor = rgbOf(m, 'subsurface_color', [1, 1, 1]);
  const dielectricShare = (1 - metal) * (1 - trans);
  const extras = anisoExtras(aniso, rot);
  const lobes: LayeredBsdfLobe[] = [
    { kind: 'conductor', weight: metal, color: baseColor, roughness: specRough, ...extras },
    { kind: 'translucent', weight: (1 - metal) * trans, color: transColor },
    { kind: 'dielectric_reflection', weight: dielectricShare * spec, color: specColor, roughness: specRough, ior, ...extras },
    { kind: 'burley_diffuse', weight: dielectricShare * (1 - spec) * base, color: baseColor, roughness: diffRough },
    { kind: 'subsurface', weight: dielectricShare * sss, color: sssColor },
  ];
  const slots: Slots = {};
  const coatW = clamp01(scalarOf(m, 'coat', 0));
  if (coatW > 0) slots.coat = { weight: coatW, color: rgbOf(m, 'coat_color', [1, 1, 1]), roughness: scalarOf(m, 'coat_roughness', 0.1), ior: scalarOf(m, 'coat_IOR', 1.5) };
  const sheenW = clamp01(scalarOf(m, 'sheen', 0));
  if (sheenW > 0) slots.sheen = { weight: sheenW, color: rgbOf(m, 'sheen_color', [1, 1, 1]), roughness: scalarOf(m, 'sheen_roughness', 0.3) };
  const filmT = scalarOf(m, 'thin_film_thickness', 0);
  if (filmT > 0) slots.thinFilm = { weight: 1, thickness: filmT, ior: scalarOf(m, 'thin_film_IOR', 1.5) };
  const em = scalarOf(m, 'emission', 0);
  if (em > 0) slots.emission = scaleRgb(rgbOf(m, 'emission_color', [1, 1, 1]), em);
  const opacity = rgbOf(m, 'opacity', [1, 1, 1]);
  return assemble(lobes, (opacity[0] + opacity[1] + opacity[2]) / 3, slots);
}

// --- open_pbr_surface --------------------------------------------------------

function lowerOpenPbrSurface(m: Inputs): LayeredClosure {
  const baseW = clamp01(scalarOf(m, 'base_weight', 1));
  const metal = clamp01(scalarOf(m, 'base_metalness', 0));
  const specW = clamp01(scalarOf(m, 'specular_weight', 1));
  const trans = clamp01(scalarOf(m, 'transmission_weight', 0));
  const sss = clamp01(scalarOf(m, 'subsurface_weight', 0));
  const specRough = scalarOf(m, 'specular_roughness', 0.3);
  const diffRough = scalarOf(m, 'base_diffuse_roughness', 0);
  const aniso = scalarOf(m, 'specular_roughness_anisotropy', 0);
  const ior = scalarOf(m, 'specular_ior', 1.5);
  const baseColor = rgbOf(m, 'base_color', [0.8, 0.8, 0.8]);
  const specColor = rgbOf(m, 'specular_color', [1, 1, 1]);
  const transColor = rgbOf(m, 'transmission_color', [1, 1, 1]);
  const sssColor = rgbOf(m, 'subsurface_color', [0.8, 0.8, 0.8]);
  const dielectricShare = (1 - metal) * (1 - trans);
  const extras = anisoExtras(aniso, 0);
  const lobes: LayeredBsdfLobe[] = [
    { kind: 'conductor', weight: metal, color: baseColor, roughness: specRough, ...extras },
    { kind: 'translucent', weight: (1 - metal) * trans, color: transColor },
    { kind: 'dielectric_reflection', weight: dielectricShare * specW, color: specColor, roughness: specRough, ior, ...extras },
    { kind: 'burley_diffuse', weight: dielectricShare * baseW, color: baseColor, roughness: diffRough },
    { kind: 'subsurface', weight: dielectricShare * sss, color: sssColor },
  ];
  const slots: Slots = {};
  const coatW = clamp01(scalarOf(m, 'coat_weight', 0));
  if (coatW > 0) slots.coat = { weight: coatW, color: rgbOf(m, 'coat_color', [1, 1, 1]), roughness: scalarOf(m, 'coat_roughness', 0), ior: scalarOf(m, 'coat_ior', 1.6) };
  const fuzzW = clamp01(scalarOf(m, 'fuzz_weight', 0));
  if (fuzzW > 0) slots.fuzz = { weight: fuzzW, color: rgbOf(m, 'fuzz_color', [1, 1, 1]), roughness: scalarOf(m, 'fuzz_roughness', 0.5) };
  const filmW = clamp01(scalarOf(m, 'thin_film_weight', 0));
  if (filmW > 0) slots.thinFilm = { weight: filmW, thickness: scalarOf(m, 'thin_film_thickness', 0.5), ior: scalarOf(m, 'thin_film_ior', 1.4) };
  const lum = scalarOf(m, 'emission_luminance', 0);
  if (lum > 0) slots.emission = scaleRgb(rgbOf(m, 'emission_color', [1, 1, 1]), lum);
  return assemble(lobes, scalarOf(m, 'geometry_opacity', 1), slots);
}

// --- gltf_pbr ----------------------------------------------------------------

function lowerGltfPbr(m: Inputs): LayeredClosure {
  const metal = clamp01(scalarOf(m, 'metallic', 1));
  const trans = clamp01(scalarOf(m, 'transmission', 0));
  const spec = clamp01(scalarOf(m, 'specular', 1));
  const rough = scalarOf(m, 'roughness', 1);
  const aniso = scalarOf(m, 'anisotropy_strength', 0);
  const rot = scalarOf(m, 'anisotropy_rotation', 0);
  const baseColor = rgbOf(m, 'base_color', [1, 1, 1]);
  const specColor = rgbOf(m, 'specular_color', [1, 1, 1]);
  const dielectricShare = (1 - metal) * (1 - trans);
  const extras = anisoExtras(aniso, rot);
  const lobes: LayeredBsdfLobe[] = [
    { kind: 'conductor', weight: metal, color: baseColor, roughness: rough, ...extras },
    { kind: 'translucent', weight: (1 - metal) * trans, color: baseColor },
    { kind: 'dielectric_reflection', weight: dielectricShare * spec, color: specColor, roughness: rough, ior: 1.5, ...extras },
    { kind: 'burley_diffuse', weight: dielectricShare, color: baseColor, roughness: rough },
  ];
  const slots: Slots = {};
  const clearcoat = clamp01(scalarOf(m, 'clearcoat', 0));
  if (clearcoat > 0) slots.coat = { weight: clearcoat, color: [1, 1, 1], roughness: scalarOf(m, 'clearcoat_roughness', 0), ior: 1.5 };
  const sheenColor = rgbOf(m, 'sheen_color', [0, 0, 0]);
  const sheenW = Math.max(sheenColor[0], sheenColor[1], sheenColor[2]);
  if (sheenW > 0) slots.sheen = { weight: sheenW, color: sheenColor, roughness: scalarOf(m, 'sheen_roughness', 0) };
  const irid = clamp01(scalarOf(m, 'iridescence', 0));
  if (irid > 0) slots.thinFilm = { weight: irid, thickness: scalarOf(m, 'iridescence_thickness', 100), ior: 1.3 };
  const emissive = rgbOf(m, 'emissive', [0, 0, 0]);
  if (emissive[0] > 0 || emissive[1] > 0 || emissive[2] > 0) slots.emission = emissive;
  return assemble(lobes, scalarOf(m, 'alpha', 1), slots);
}

// --- UsdPreviewSurface -------------------------------------------------------

function lowerUsdPreviewSurface(m: Inputs): LayeredClosure {
  const metal = clamp01(scalarOf(m, 'metallic', 0));
  const rough = scalarOf(m, 'roughness', 0.5);
  const ior = scalarOf(m, 'ior', 1.5);
  const diffuse = rgbOf(m, 'diffuseColor', [0.18, 0.18, 0.18]);
  const useSpecular = scalarOf(m, 'useSpecularWorkflow', 0) >= 0.5;
  const specColor = useSpecular ? rgbOf(m, 'specularColor', [0, 0, 0]) : [1, 1, 1] as Rgb;
  const dielectricShare = 1 - metal;
  const lobes: LayeredBsdfLobe[] = [
    { kind: 'conductor', weight: metal, color: diffuse, roughness: rough },
    { kind: 'dielectric_reflection', weight: dielectricShare, color: specColor, roughness: rough, ior },
    { kind: 'burley_diffuse', weight: dielectricShare, color: diffuse, roughness: rough },
  ];
  const slots: Slots = {};
  const clearcoat = clamp01(scalarOf(m, 'clearcoat', 0));
  if (clearcoat > 0) slots.coat = { weight: clearcoat, color: [1, 1, 1], roughness: scalarOf(m, 'clearcoatRoughness', 0.01), ior: 1.5 };
  const emissive = rgbOf(m, 'emissiveColor', [0, 0, 0]);
  if (emissive[0] > 0 || emissive[1] > 0 || emissive[2] > 0) slots.emission = emissive;
  return assemble(lobes, scalarOf(m, 'opacity', 1), slots);
}

// --- disney_principled -------------------------------------------------------

function lowerDisneyPrincipled(m: Inputs): LayeredClosure {
  const metal = clamp01(scalarOf(m, 'metallic', 0));
  const trans = clamp01(scalarOf(m, 'specTrans', 0));
  const spec = clamp01(scalarOf(m, 'specular', 0.5));
  const sss = clamp01(scalarOf(m, 'subsurface', 0));
  const rough = scalarOf(m, 'roughness', 0.5);
  const aniso = scalarOf(m, 'anisotropic', 0);
  const ior = scalarOf(m, 'ior', 1.5);
  const baseColor = rgbOf(m, 'baseColor', [0.16, 0.16, 0.16]);
  const specTint = clamp01(scalarOf(m, 'specularTint', 0));
  const specColor = lerpRgb([1, 1, 1], baseColor, specTint);
  const dielectricShare = (1 - metal) * (1 - trans);
  const extras = anisoExtras(aniso, 0);
  const lobes: LayeredBsdfLobe[] = [
    { kind: 'conductor', weight: metal, color: baseColor, roughness: rough, ...extras },
    { kind: 'translucent', weight: (1 - metal) * trans, color: baseColor },
    { kind: 'dielectric_reflection', weight: dielectricShare * spec, color: specColor, roughness: rough, ior, ...extras },
    { kind: 'burley_diffuse', weight: dielectricShare, color: baseColor, roughness: rough },
    { kind: 'subsurface', weight: dielectricShare * sss, color: baseColor },
  ];
  const slots: Slots = {};
  const sheenW = clamp01(scalarOf(m, 'sheen', 0));
  if (sheenW > 0) {
    const sheenTint = clamp01(scalarOf(m, 'sheenTint', 0.5));
    slots.sheen = { weight: sheenW, color: lerpRgb([1, 1, 1], baseColor, sheenTint), roughness: 0.3 };
  }
  const clearcoat = clamp01(scalarOf(m, 'clearcoat', 0));
  if (clearcoat > 0) {
    const gloss = clamp01(scalarOf(m, 'clearcoatGloss', 1));
    slots.coat = { weight: clearcoat, color: [1, 1, 1], roughness: 1 - gloss, ior: 1.5 };
  }
  return assemble(lobes, 1, slots);
}

/**
 * Lower a resolved surface (T055a) to its LayeredClosure (T054). Dispatches on the
 * resolved family; every family returns a closure whose base lobes, coat, sheen,
 * fuzz, thin film, emission and opacity are driven by the family interface.
 */
export function surfaceGraphToLayered(surface: ResolvedSurface): LayeredClosure {
  const m = surface.inputs;
  switch (surface.family) {
    case 'standard_surface':
      return lowerStandardSurface(m);
    case 'open_pbr_surface':
      return lowerOpenPbrSurface(m);
    case 'gltf_pbr':
      return lowerGltfPbr(m);
    case 'UsdPreviewSurface':
      return lowerUsdPreviewSurface(m);
    case 'disney_principled':
      return lowerDisneyPrincipled(m);
  }
}
