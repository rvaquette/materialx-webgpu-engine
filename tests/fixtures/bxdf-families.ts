// T059a: the BxDF-coverage oracle corpus. One representative surface per bxdf
// family (standard_surface, open_pbr_surface, disney_principled, gltf_pbr,
// UsdPreviewSurface), a deep lama_* style assembly and an arbitrary procedural
// surface nodegraph -- each reduced to the single LayeredClosure the shared IR
// produces, so the device validation (T059c/d) can render every family through
// the compiler output and compare it against the CPU oracle referenceClosureDirect
// (src/render/bsdf/reference.ts). The five families are lowered the exact way the
// backends lower them (parsedInputsToLayered -> surfaceGraphToLayered); each
// representative deliberately turns on the advanced lobes the pre-P10 seven-
// parameter model discarded (coat, sheen, fuzz, thin film, specular anisotropy,
// transmission, subsurface, emission) so the fidelity proof (T059b) has material
// to work with. The lama assembly and the procedural nodegraph are authored as
// LayeredClosures directly: they stand for closures the compiler emits from a
// BSDF-brick network and a procedural input network at one shading sample, and
// the matching device construction is wired in T059c.

import type { LayeredClosure } from '../../src/compiler/ir.ts';
import {
  parsedInputsToLayered,
  type ParsedSurfaceInputs,
} from '../../src/materialx/surface-from-inputs.ts';
import type { BxdfFamilyKey } from './tolerances.ts';

/** Advanced closure features a representative exercises (fidelity axis, T059b). */
export type BxdfFeature =
  | 'coat'
  | 'sheen'
  | 'fuzz'
  | 'thin_film'
  | 'anisotropy'
  | 'transmission'
  | 'subsurface'
  | 'emission';

export interface BxdfFamilyCase {
  /** Display name for the device report and test titles. */
  readonly name: string;
  /** Tolerance key (family or assembly kind). */
  readonly family: BxdfFamilyKey;
  /** Parsed surface inputs for the five nodedef families; absent for the two assemblies. */
  readonly spec?: ParsedSurfaceInputs;
  /** The single LayeredClosure the shared IR produces for this surface. */
  readonly closure: LayeredClosure;
  /** Advanced lobes this case turns on (beyond the base diffuse+specular). */
  readonly features: readonly BxdfFeature[];
}

/** Lower parsed inputs to a closure, failing loudly so a bad fixture never silently drops lobes. */
function lower(spec: ParsedSurfaceInputs): LayeredClosure {
  const closure = parsedInputsToLayered(spec);
  if (!closure) throw new Error(`bxdf-families: ${spec.category} did not resolve to a surface`);
  return closure;
}

// --- five nodedef families (lowered through the shared surface path) ---------

const STANDARD_SURFACE_SPEC: ParsedSurfaceInputs = {
  category: 'standard_surface',
  inputs: {
    base: 1,
    base_color: [0.82, 0.55, 0.2],
    metalness: 0,
    specular: 0.6,
    specular_color: [1, 1, 1],
    specular_roughness: 0.18,
    specular_anisotropy: 0.6,
    specular_rotation: 0.1,
    specular_IOR: 1.5,
    coat: 0.8,
    coat_color: [1, 1, 1],
    coat_roughness: 0.05,
    coat_IOR: 1.5,
    sheen: 0.4,
    sheen_color: [1, 1, 1],
    sheen_roughness: 0.3,
    thin_film_thickness: 380,
    thin_film_IOR: 1.5,
  },
};

const OPEN_PBR_SPEC: ParsedSurfaceInputs = {
  category: 'open_pbr_surface',
  inputs: {
    base_weight: 1,
    base_color: [0.2, 0.5, 0.82],
    base_metalness: 0,
    specular_weight: 0.7,
    specular_color: [1, 1, 1],
    specular_roughness: 0.2,
    specular_roughness_anisotropy: 0.5,
    specular_ior: 1.5,
    coat_weight: 0.7,
    coat_color: [1, 1, 1],
    coat_roughness: 0.05,
    coat_ior: 1.6,
    fuzz_weight: 0.5,
    fuzz_color: [1, 1, 1],
    fuzz_roughness: 0.4,
    thin_film_weight: 0.8,
    thin_film_thickness: 0.4,
    thin_film_ior: 1.4,
  },
};

const DISNEY_SPEC: ParsedSurfaceInputs = {
  category: 'disney_principled',
  inputs: {
    baseColor: [0.7, 0.2, 0.3],
    metallic: 0,
    roughness: 0.3,
    anisotropic: 0.5,
    specular: 0.5,
    specularTint: 0.4,
    sheen: 0.6,
    sheenTint: 0.5,
    clearcoat: 0.8,
    clearcoatGloss: 0.9,
    subsurface: 0.3,
  },
};

const GLTF_SPEC: ParsedSurfaceInputs = {
  category: 'gltf_pbr',
  inputs: {
    base_color: [0.3, 0.7, 0.4],
    metallic: 0,
    roughness: 0.3,
    specular: 1,
    anisotropy_strength: 0.5,
    anisotropy_rotation: 0.1,
    clearcoat: 0.7,
    clearcoat_roughness: 0.05,
    sheen_color: [0.5, 0.5, 0.5],
    sheen_roughness: 0.3,
    iridescence: 0.8,
    iridescence_thickness: 300,
  },
};

const USD_SPEC: ParsedSurfaceInputs = {
  category: 'UsdPreviewSurface',
  inputs: {
    diffuseColor: [0.6, 0.4, 0.8],
    metallic: 0,
    roughness: 0.3,
    ior: 1.5,
    useSpecularWorkflow: 0,
    clearcoat: 0.8,
    clearcoatRoughness: 0.05,
    emissiveColor: [0.1, 0.05, 0],
    opacity: 1,
  },
};

// --- lama_* assembly: a deep BSDF-brick stack (authored closure) -------------
//
// Equivalent to lama_layer(lama_sheen, lama_layer(coat_dielectric,
// lama_add(lama_conductor(gold), lama_diffuse))) with a thin-film tint on the
// metal: an anisotropic gold conductor added to a diffuse base, covered by a
// dielectric coat and a sheen layer. The device builds the same closure from the
// brick network in T059c; this is the oracle target at a shading sample.
const LAMA_CLOSURE: LayeredClosure = {
  lobes: [
    { kind: 'conductor', weight: 0.5, color: [1.0, 0.78, 0.34], roughness: 0.12, anisotropy: 0.4 },
    { kind: 'burley_diffuse', weight: 0.5, color: [0.2, 0.25, 0.3], roughness: 0.4 },
  ],
  coat: { weight: 0.7, color: [1, 1, 1], roughness: 0.05, ior: 1.5 },
  sheen: { weight: 0.4, color: [0.8, 0.8, 0.9], roughness: 0.3 },
  thinFilm: { weight: 0.6, thickness: 350, ior: 1.4 },
  opacity: 1,
};

// --- arbitrary procedural surface nodegraph (authored closure) ---------------
//
// Stands for a surface whose base_color and roughness are driven by a procedural
// node network (e.g. a noise/mix between two tints and a remapped roughness)
// evaluated at one shading sample. The compiler lowers such a nodegraph to a
// LayeredClosure whose lobe colours/roughness carry the network output; this is
// the oracle target at that sample (GPU wiring of the live network in T059c).
const PROCEDURAL_CLOSURE: LayeredClosure = {
  lobes: [
    { kind: 'dielectric_reflection', weight: 0.5, color: [1, 1, 1], roughness: 0.28, ior: 1.5 },
    { kind: 'burley_diffuse', weight: 0.5, color: [0.37, 0.52, 0.18], roughness: 0.28 },
  ],
  opacity: 1,
};

// --- device shading frames + lighting (shared by harness and oracle, T059c) --
//
// The device harness (bxdf-device.harness.ts) shades every case over these frames
// in both backends; the device test (bxdf-device.test.ts) rebuilds the SAME frames
// and lighting for the CPU oracle referenceClosureDirect, so the only difference is
// GPU fp32 vs CPU fp64 arithmetic of the shared closure. Frames need not be unit
// vectors (both sides normalize); they span head-on, oblique and tilted-normal
// views so view-dependent lobes (specular, coat, thin film, anisotropy) vary.
export interface DeviceGeom {
  readonly normal: readonly [number, number, number];
  readonly view: readonly [number, number, number];
}

export const BXDF_DEVICE_GEOMS: readonly DeviceGeom[] = [
  { normal: [0, 0, 1], view: [0, 0, 1] },
  { normal: [0, 0, 1], view: [0.6, 0, 0.8] },
  { normal: [0, 1, 0], view: [0, 0.5, 0.866] },
  { normal: [0, 0, 1], view: [-0.5, 0.3, 0.8] },
  { normal: [0.3, 0, 0.95], view: [0, 0, 1] },
  { normal: [0, 0, 1], view: [0.8, 0, 0.6] },
];

// Matches reference.ts defaultLighting(): one distant light travelling -Z, white
// unit radiance, plus a dim constant environment.
export const BXDF_DEVICE_LIGHT = {
  direction: [0, 0, -1],
  color: [1, 1, 1],
  intensity: 1,
  environment: [0.03, 0.03, 0.03],
} as const;

export const BXDF_FAMILY_CASES: readonly BxdfFamilyCase[] = [
  {
    name: 'StandardSurfaceAdvanced',
    family: 'standard_surface',
    spec: STANDARD_SURFACE_SPEC,
    closure: lower(STANDARD_SURFACE_SPEC),
    features: ['coat', 'sheen', 'thin_film', 'anisotropy'],
  },
  {
    name: 'OpenPbrAdvanced',
    family: 'open_pbr_surface',
    spec: OPEN_PBR_SPEC,
    closure: lower(OPEN_PBR_SPEC),
    features: ['coat', 'fuzz', 'thin_film', 'anisotropy'],
  },
  {
    name: 'DisneyPrincipledAdvanced',
    family: 'disney_principled',
    spec: DISNEY_SPEC,
    closure: lower(DISNEY_SPEC),
    features: ['coat', 'sheen', 'anisotropy', 'subsurface'],
  },
  {
    name: 'GltfPbrAdvanced',
    family: 'gltf_pbr',
    spec: GLTF_SPEC,
    closure: lower(GLTF_SPEC),
    features: ['coat', 'sheen', 'thin_film', 'anisotropy'],
  },
  {
    name: 'UsdPreviewSurfaceAdvanced',
    family: 'UsdPreviewSurface',
    spec: USD_SPEC,
    closure: lower(USD_SPEC),
    features: ['coat', 'emission'],
  },
  {
    name: 'LamaAssembly',
    family: 'lama_assembly',
    closure: LAMA_CLOSURE,
    features: ['coat', 'sheen', 'thin_film', 'anisotropy'],
  },
  {
    name: 'ProceduralNodegraph',
    family: 'procedural_nodegraph',
    closure: PROCEDURAL_CLOSURE,
    features: [],
  },
];
