import { lamaSssTransport, lamaSssSubset } from './lama-sss.ts';
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
import type { LamaLayerMode, ResolvedGraph } from '../materialx/graph.ts';
import type { NormalizedSurfaceInput, ResolvedSurface } from '../materialx/surface-graph.ts';
import { hairAbsorptionFromColor, hairAbsorptionFromMelanin } from '../render/bsdf/hair.ts';

type Inputs = ReadonlyMap<string, NormalizedSurfaceInput>;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

const DIFFUSE_LOBES = new Set<string>([
  'oren_nayar_diffuse', 'burley_diffuse', 'translucent', 'subsurface',
]);

export function resolveLamaLayerMode(mode: LamaLayerMode | undefined, base: readonly { kind: string }[]): NonNullable<CoatLayer['mode']> {
  if (mode === 'auto') return base.length === 0 || base.every(lobe => DIFFUSE_LOBES.has(lobe.kind)) ? 'fresnel_blend' : 'rough_coating';
  return mode ?? 'fresnel_blend';
}

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
  const abbe = scalarOf(m, 'transmission_dispersion', 0);
  const rawBaseColor = rgbOf(m, 'base_color', [1, 1, 1]);
  const baseColor: Rgb = [clamp01(rawBaseColor[0]), clamp01(rawBaseColor[1]), clamp01(rawBaseColor[2])];
  const specColor = rgbOf(m, 'specular_color', [1, 1, 1]);
  const transColor = rgbOf(m, 'transmission_color', [1, 1, 1]);
  const sssColor = rgbOf(m, 'subsurface_color', [1, 1, 1]);
  const transDepth = scalarOf(m, 'transmission_depth', 0);
  const sssRadius = scaleRgb(rgbOf(m, 'subsurface_radius', [1, 1, 1]), scalarOf(m, 'subsurface_scale', 1));
  const sssAniso = scalarOf(m, 'subsurface_anisotropy', 0);
  const dielectricShare = (1 - metal) * (1 - trans);
  const extras = anisoExtras(aniso, rot);
  const lobes: LayeredBsdfLobe[] = [
    { kind: 'conductor', weight: metal, color: baseColor, roughness: specRough, ...extras },
    { kind: 'dielectric_transmission', weight: (1 - metal) * trans, color: transColor, roughness: specRough, ior, ...(abbe > 0 ? { dispersion: 20 / abbe } : {}), ...(transDepth > 0 ? { attenuationColor: transColor, attenuationDistance: transDepth } : {}) },
    { kind: 'dielectric_reflection', weight: dielectricShare * spec, color: specColor, roughness: specRough, ior, ...extras },
    { kind: 'burley_diffuse', weight: dielectricShare * base, color: baseColor, roughness: diffRough },
    { kind: 'subsurface', weight: dielectricShare * sss, color: sssColor, ...(sss > 0 ? { subsurfaceRadius: sssRadius, ...(sssAniso !== 0 ? { anisotropy: sssAniso } : {}) } : {}) },
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
  const dispersion = Math.max(scalarOf(m, 'transmission_dispersion_scale', 0), 0) * 20
    / Math.max(scalarOf(m, 'transmission_dispersion_abbe_number', 20), 1e-6);
  const baseColor = rgbOf(m, 'base_color', [0.8, 0.8, 0.8]);
  const specColor = rgbOf(m, 'specular_color', [1, 1, 1]);
  const transColor = rgbOf(m, 'transmission_color', [1, 1, 1]);
  const sssColor = rgbOf(m, 'subsurface_color', [0.8, 0.8, 0.8]);
  const transDepth = scalarOf(m, 'transmission_depth', 0);
  const sssRadius = scaleRgb(rgbOf(m, 'subsurface_radius_scale', [1, 0.5, 0.25]), scalarOf(m, 'subsurface_radius', 1));
  const sssAniso = scalarOf(m, 'subsurface_scatter_anisotropy', 0);
  const dielectricShare = (1 - metal) * (1 - trans);
  const thinWalled = scalarOf(m, 'geometry_thin_walled', 0) > 0.5;
  const reflShare = thinWalled ? (1 - metal) : dielectricShare;
  const extras = anisoExtras(aniso, 0);
  const lobes: LayeredBsdfLobe[] = [
    { kind: 'conductor', weight: metal, color: baseColor, roughness: specRough, ...extras },
    { kind: 'dielectric_transmission', weight: (1 - metal) * trans, color: transColor, roughness: specRough, ior, ...(dispersion > 0 ? { dispersion } : {}), ...(thinWalled ? { thinWalled: true } : (transDepth > 0 ? { attenuationColor: transColor, attenuationDistance: transDepth } : {})) },
    { kind: 'dielectric_reflection', weight: reflShare * specW, color: specColor, roughness: specRough, ior, ...extras },
    { kind: 'burley_diffuse', weight: dielectricShare * baseW, color: baseColor, roughness: diffRough },
    { kind: 'subsurface', weight: dielectricShare * sss, color: sssColor, ...(sss > 0 ? { subsurfaceRadius: sssRadius, ...(sssAniso !== 0 ? { anisotropy: sssAniso } : {}) } : {}) },
  ];
  const slots: Slots = {};
  const coatW = clamp01(scalarOf(m, 'coat_weight', 0));
  if (coatW > 0) slots.coat = { weight: coatW, color: rgbOf(m, 'coat_color', [1, 1, 1]), roughness: scalarOf(m, 'coat_roughness', 0), ior: scalarOf(m, 'coat_ior', 1.6) };
  const fuzzW = clamp01(scalarOf(m, 'fuzz_weight', 0));
  if (fuzzW > 0) slots.fuzz = { weight: fuzzW, color: rgbOf(m, 'fuzz_color', [1, 1, 1]), roughness: scalarOf(m, 'fuzz_roughness', 0.5) };
  const filmW = clamp01(scalarOf(m, 'thin_film_weight', 0));
  if (filmW > 0) slots.thinFilm = { weight: filmW, thickness: scalarOf(m, 'thin_film_thickness', 0.5) * 1000, ior: scalarOf(m, 'thin_film_ior', 1.4) };
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
  const ior = scalarOf(m, 'ior', 1.5);
  const aniso = scalarOf(m, 'anisotropy_strength', 0);
  const rot = scalarOf(m, 'anisotropy_rotation', 0);
  const baseColor = rgbOf(m, 'base_color', [1, 1, 1]);
  const specColor = rgbOf(m, 'specular_color', [1, 1, 1]);
  const dielectricShare = (1 - metal) * (1 - trans);
  const extras = anisoExtras(aniso, rot);
  const lobes: LayeredBsdfLobe[] = [
    { kind: 'conductor', weight: metal, color: baseColor, roughness: rough, ...extras },
    { kind: 'dielectric_transmission', weight: (1 - metal) * trans, color: baseColor, roughness: rough, ior },
    { kind: 'dielectric_reflection', weight: dielectricShare * spec, color: specColor, roughness: rough, ior, ...extras },
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
  const alpha = clamp01(scalarOf(m, 'alpha', 1));
  const mode = scalarOf(m, 'alpha_mode', 0);
  const opacity = mode === 0 ? 1 : mode === 1 ? Number(alpha >= scalarOf(m, 'alpha_cutoff', 0.5)) : alpha;
  const transmission = lobes.find((lobe) => lobe.kind === 'dielectric_transmission');
  const dispersion = Math.max(scalarOf(m, 'dispersion', 0), 0);
  if (transmission && dispersion > 0) transmission.dispersion = dispersion;
  return assemble(lobes, opacity, slots);
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
  const opacity = clamp01(scalarOf(m, 'opacity', 1));
  const threshold = scalarOf(m, 'opacityThreshold', 0);
  const diffuseShare = threshold > 0 ? 1 : opacity;
  const lobes: LayeredBsdfLobe[] = [
    { kind: 'conductor', weight: metal, color: diffuse, roughness: rough },
    { kind: 'dielectric_reflection', weight: dielectricShare * diffuseShare, color: specColor, roughness: rough, ior },
    { kind: 'dielectric_transmission', weight: dielectricShare * (1 - diffuseShare), color: [1, 1, 1], roughness: rough, ior },
    { kind: 'burley_diffuse', weight: dielectricShare * diffuseShare, color: diffuse, roughness: rough },
  ];
  const slots: Slots = {};
  const clearcoat = clamp01(scalarOf(m, 'clearcoat', 0));
  if (clearcoat > 0) slots.coat = { weight: clearcoat, color: [1, 1, 1], roughness: scalarOf(m, 'clearcoatRoughness', 0.01), ior: 1.5 };
  const emissive = rgbOf(m, 'emissiveColor', [0, 0, 0]);
  if (emissive[0] > 0 || emissive[1] > 0 || emissive[2] > 0) slots.emission = emissive;
  return assemble(lobes, threshold > 0 && opacity < threshold ? 0 : 1, slots);
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
    { kind: 'dielectric_transmission', weight: (1 - metal) * trans, color: baseColor, roughness: rough, ior },
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

function nodeNumbers(graph: ResolvedGraph, nodeId: string, name: string, fallback: readonly number[]): readonly number[] {
  const node = graph.nodes.get(nodeId);
  const authored = node?.inputs.find((input) => input.name === name)?.source;
  if (authored?.kind === 'value') {
    const values = authored.value.split(',').map(Number);
    if (values.every(Number.isFinite)) return values;
  }
  const declared = node?.nodeDef?.inputs?.find((input) => input.name === name)?.value;
  if (declared !== undefined) {
    const values = declared.split(',').map(Number);
    if (values.every(Number.isFinite)) return values;
  }
  return fallback;
}

function nodeConnection(graph: ResolvedGraph, nodeId: string, name: string): string | undefined {
  const source = graph.nodes.get(nodeId)?.inputs.find(input => input.name === name)?.source;
  return source?.kind === 'connection' ? source.nodeId : undefined;
}

function nodeScalar(graph: ResolvedGraph, nodeId: string, name: string, fallback: number): number {
  return nodeNumbers(graph, nodeId, name, [fallback])[0] ?? fallback;
}

function nodeColor(graph: ResolvedGraph, nodeId: string, name: string, fallback: Rgb): Rgb {
  const values = nodeNumbers(graph, nodeId, name, fallback);
  if (values.length === 1) return [values[0]!, values[0]!, values[0]!];
  return [values[0] ?? fallback[0], values[1] ?? fallback[1], values[2] ?? fallback[2]];
}

interface LamaShadingFrame {
  normal?: readonly number[];
  tangent?: readonly number[];
}

function normalized3(value: readonly number[]): Rgb {
  const x = value[0] ?? 0, y = value[1] ?? 0, z = value[2] ?? 0;
  const length = Math.hypot(x, y, z);
  return length > 1e-8 ? [x / length, y / length, z / length] : [0, 0, 1];
}

function lamaAnisotropyRotation(graph: ResolvedGraph, nodeId: string, frame?: LamaShadingFrame): number {
  const node = graph.nodes.get(nodeId);
  const directionName = node?.inputs.some(input => input.name === 'anisotropyDirection')
    || node?.nodeDef?.inputs?.some(input => input.name === 'anisotropyDirection')
    ? 'anisotropyDirection'
    : 'direction';
  const rotationName = node?.inputs.some(input => input.name === 'anisotropyRotation')
    || node?.nodeDef?.inputs?.some(input => input.name === 'anisotropyRotation')
    ? 'anisotropyRotation'
    : 'rotation';
  const rotation = nodeScalar(graph, nodeId, rotationName, 0);
  const directionInput = node?.inputs.find(input => input.name === directionName);
  const directionDef = node?.nodeDef?.inputs?.find(input => input.name === directionName);
  const direction = directionInput?.source.kind === 'value'
    ? nodeColor(graph, nodeId, directionName, [1, 0, 0])
    : directionDef?.geomprop?.toLowerCase().startsWith('t') ? normalized3(frame?.tangent ?? [1, 0, 0])
      : normalized3(frame?.tangent ?? [1, 0, 0]);
  const normalInput = node?.inputs.find(input => input.name === 'normal');
  const normal = normalInput?.source.kind === 'value'
    ? normalized3(nodeColor(graph, nodeId, 'normal', [0, 0, 1]))
    : normalized3(frame?.normal ?? [0, 0, 1]);
  const tangent = normalized3(frame?.tangent ?? [1, 0, 0]);
  const project = (v: Rgb): Rgb => {
    const nd = normal[0] * v[0] + normal[1] * v[1] + normal[2] * v[2];
    return normalized3([v[0] - normal[0] * nd, v[1] - normal[1] * nd, v[2] - normal[2] * nd]);
  };
  const t = project(tangent), d = project(direction);
  const cross = [t[1] * d[2] - t[2] * d[1], t[2] * d[0] - t[0] * d[2], t[0] * d[1] - t[1] * d[0]];
  const sin = normal[0] * cross[0]! + normal[1] * cross[1]! + normal[2] * cross[2]!;
  const cos = t[0] * d[0] + t[1] * d[1] + t[2] * d[2];
  return rotation + Math.atan2(sin, cos) / (2 * Math.PI);
}

function scaleLamaClosure(closure: LayeredClosure, weight: number): LayeredClosure {
  return {
    ...closure,
    lobes: closure.lobes.map(lobe => ({ ...lobe, weight: lobe.weight * weight })),
    ...(closure.coat ? { coat: { ...closure.coat, weight: closure.coat.weight * weight } } : {}),
    ...(closure.sheen ? { sheen: { ...closure.sheen, weight: closure.sheen.weight * weight } } : {}),
    ...(closure.fuzz ? { fuzz: { ...closure.fuzz, weight: closure.fuzz.weight * weight } } : {}),
    ...(closure.thinFilm ? { thinFilm: { ...closure.thinFilm, weight: closure.thinFilm.weight * weight } } : {}),
    ...(closure.emission ? { emission: scaleRgb(closure.emission, weight) } : {}),
  };
}

function addLamaClosures(a: LayeredClosure, b: LayeredClosure): LayeredClosure {
  return {
    lobes: [...a.lobes, ...b.lobes],
    opacity: 1,
    ...(a.coat ?? b.coat ? { coat: a.coat ?? b.coat } : {}),
    ...(a.sheen ?? b.sheen ? { sheen: a.sheen ?? b.sheen } : {}),
    ...(a.fuzz ?? b.fuzz ? { fuzz: a.fuzz ?? b.fuzz } : {}),
    ...(a.thinFilm ?? b.thinFilm ? { thinFilm: a.thinFilm ?? b.thinFilm } : {}),
    ...(a.emission || b.emission ? { emission: [
      (a.emission?.[0] ?? 0) + (b.emission?.[0] ?? 0),
      (a.emission?.[1] ?? 0) + (b.emission?.[1] ?? 0),
      (a.emission?.[2] ?? 0) + (b.emission?.[2] ?? 0),
    ] as Rgb } : {}),
  };
}

function lowerLamaBsdf(graph: ResolvedGraph, nodeId: string, frame?: LamaShadingFrame, visiting = new Set<string>()): LayeredClosure {
  if (visiting.has(nodeId)) return { lobes: [], opacity: 1 };
  const node = graph.nodes.get(nodeId);
  if (!node) return { lobes: [], opacity: 1 };
  const kind = node.nodeDef?.nodeString ?? node.category;
  const next = new Set(visiting).add(nodeId);
  const child = (name: string): LayeredClosure => {
    const childId = nodeConnection(graph, nodeId, name);
    return childId ? lowerLamaBsdf(graph, childId, frame, next) : { lobes: [], opacity: 1 };
  };
  const roughness = clamp01(nodeScalar(graph, nodeId, 'roughness', 0.1));
  const anisotropy = nodeScalar(graph, nodeId, 'anisotropy', 0);
  const rotation = lamaAnisotropyRotation(graph, nodeId, frame);

  switch (kind) {
    case 'LamaDiffuse':
      return assemble([{
        kind: 'oren_nayar_diffuse', weight: 1,
        color: nodeColor(graph, nodeId, 'color', [0.18, 0.18, 0.18]),
        roughness: roughness * roughness * 0.5,
        energyCompensation: clamp01(nodeScalar(graph, nodeId, 'energyCompensation', 1)),
      }], 1, {});
    case 'LamaTranslucent':
      return assemble([{
        kind: 'translucent', weight: 1,
        color: nodeColor(graph, nodeId, 'color', [0.18, 0.18, 0.18]),
      }], 1, {});
    case 'LamaConductor': {
      const mode = nodeScalar(graph, nodeId, 'fresnelMode', 0);
      const reflectivity = nodeColor(graph, nodeId, 'reflectivity', [0.945, 0.7772, 0.3737])
        .map(value => Math.min(Math.max(value, 0), 0.99)) as unknown as Rgb;
      const edgeColor = nodeColor(graph, nodeId, 'edgeColor', [0.7137, 0.7373, 0.455]);
      const artisticEta = reflectivity.map((r, i) => {
        const s = Math.sqrt(r);
        const etaMin = (1 - r) / (1 + r);
        const etaMax = (1 + s) / (1 - s);
        return etaMax + (etaMin - etaMax) * edgeColor[i]!;
      }) as unknown as Rgb;
      const artisticKappa = reflectivity.map((r, i) => {
        const eta = artisticEta[i]!;
        const etaPlusOne = eta + 1;
        const etaMinusOne = eta - 1;
        return Math.sqrt(Math.max((etaPlusOne * etaPlusOne * r - etaMinusOne * etaMinusOne) / Math.max(1 - r, 1e-6), 0));
      }) as unknown as Rgb;
      const eta = mode === 0 ? artisticEta : nodeColor(graph, nodeId, 'IOR', [0.18, 0.42, 1.37]);
      const kappa = mode === 0 ? artisticKappa : nodeColor(graph, nodeId, 'extinction', [3.42, 2.35, 1.77]);
      const exterior = Math.max(nodeScalar(graph, nodeId, 'exteriorIOR', 1), 1e-4);
      const compensation = clamp01(nodeScalar(graph, nodeId, 'energyCompensation', 0));
      const main: LayeredBsdfLobe = {
        kind: 'conductor', weight: 1, color: nodeColor(graph, nodeId, 'tint', [1, 1, 1]),
        conductorEta: scaleRgb(eta, 1 / exterior), extinction: scaleRgb(kappa, 1 / exterior), roughness,
        ...(anisotropy !== 0 ? { anisotropy: Math.min(Math.abs(anisotropy), 0.98) } : {}),
        ...((rotation !== 0 || anisotropy < 0) ? { rotation: rotation + (anisotropy < 0 ? 0.25 : 0) } : {}),
        ...(compensation > 0 ? { energyCompensation: compensation } : {}),
      };
      const length = clamp01(nodeScalar(graph, nodeId, 'tailLength', 0.5));
      const tail = length > 0 ? clamp01(nodeScalar(graph, nodeId, 'tailMix', 0)) : 0;
      return assemble(tail > 0 ? [
        { ...main, weight: 1 - tail },
        { ...main, weight: tail, roughness: roughness + (1 - roughness) * length },
      ] : [main], 1, {});
    }
    case 'LamaDielectric': {
      const mode = nodeScalar(graph, nodeId, 'fresnelMode', 0);
      const reflectivity = nodeColor(graph, nodeId, 'reflectivity', [0.04, 0.04, 0.04]);
      const reflectance = Math.max(0, Math.min(0.999, (reflectivity[0] + reflectivity[1] + reflectivity[2]) / 3));
      const artisticIor = (1 + Math.sqrt(reflectance)) / Math.max(1 - Math.sqrt(reflectance), 1e-4);
      const ior = mode === 0 ? artisticIor : nodeScalar(graph, nodeId, 'IOR', 1.5);
      const absorption = nodeColor(graph, nodeId, 'absorptionColor', [1, 1, 1]);
      const radius = nodeScalar(graph, nodeId, 'absorptionRadius', 1);
      const attenuationColor = absorption.map(value => Math.exp(-value)) as unknown as Rgb;
      const shared = {
        weight: 1, roughness, ior,
        ...(anisotropy > 0 ? { anisotropy } : {}), ...(rotation > 0 ? { rotation } : {}),
      };
      const scattering = nodeColor(graph, nodeId, 'scatterColor', [0, 0, 0]);
      const scatterAnisotropy = nodeScalar(graph, nodeId, 'scatterAnisotropy', 0);
      return assemble([
        { kind: 'dielectric_reflection', ...shared, color: nodeColor(graph, nodeId, 'reflectionTint', [1, 1, 1]) },
        {
          kind: 'dielectric_transmission', ...shared,
          color: nodeColor(graph, nodeId, 'transmissionTint', [1, 1, 1]),
          ...(radius > 0 && absorption.some(value => value > 0) ? { attenuationColor, attenuationDistance: radius } : {}),
          ...(scattering.some(value => value > 0) ? { interiorScattering: scattering, interiorAnisotropy: scatterAnisotropy } : {}),
        },
      ], 1, {});
    }
    case 'LamaGeneralizedSchlick': {
      const mode = nodeScalar(graph, nodeId, 'fresnelMode', 0);
      const reflectivity = nodeColor(graph, nodeId, 'reflectivity', [0.04, 0.04, 0.04]);
      const eta = nodeColor(graph, nodeId, 'IOR', [1.5, 1.5, 1.5]);
      const scientific = eta.map(value => ((value - 1) / (value + 1)) ** 2) as unknown as Rgb;
      const tint = nodeColor(graph, nodeId, 'reflectionTint', [1, 1, 1]);
      const rawColor = mode === 0 ? reflectivity : scientific;
      const color = rawColor.map((value, i) => value * tint[i]!) as unknown as Rgb;
      const color90 = nodeColor(graph, nodeId, 'reflectivity90', [1, 1, 1]);
      const profile = 1 / Math.max(nodeScalar(graph, nodeId, 'reflectivityProfile', 0.2), 1e-6);
      const absorption = nodeColor(graph, nodeId, 'absorptionColor', [1, 1, 1]);
      const radius = nodeScalar(graph, nodeId, 'absorptionRadius', 1);
      const scattering = nodeColor(graph, nodeId, 'scatterColor', [0, 0, 0]);
      const scatterAnisotropy = nodeScalar(graph, nodeId, 'scatterAnisotropy', 0);
      const transmissionTint = nodeColor(graph, nodeId, 'transmissionTint', [1, 1, 1]);
      const transmission: LayeredBsdfLobe = {
        kind: 'dielectric_transmission', weight: 1, color: transmissionTint, roughness, ior: 1.5,
        ...(radius > 0 && absorption.some(value => value > 0)
          ? { attenuationColor: absorption.map(value => Math.exp(-value)) as unknown as Rgb, attenuationDistance: radius }
          : {}),
        ...(scattering.some(value => value > 0) ? { interiorScattering: scattering, interiorAnisotropy: scatterAnisotropy } : {}),
        ...(anisotropy > 0 ? { anisotropy } : {}), ...(rotation > 0 ? { rotation } : {}),
      };
      return assemble([
        {
          kind: 'generalized_schlick', weight: 1, color, color90, roughness, fresnelExponent: profile,
          ...(anisotropy > 0 ? { anisotropy } : {}), ...(rotation > 0 ? { rotation } : {}),
        },
        transmission,
      ], 1, {});
    }
    case 'LamaSheen':
      return assemble([], 1, {
        sheen: { weight: 1, color: nodeColor(graph, nodeId, 'color', [1, 1, 1]), roughness },
      });
    case 'LamaSSS':
      return assemble([{
        kind: 'subsurface', weight: 1,
        subsurfaceTransport: lamaSssTransport(graph, nodeId),
        subsurfaceInversion: nodeScalar(graph, nodeId, 'albedoInversionMethod', 0) as 0 | 1,
        subsurfaceBleed: nodeScalar(graph, nodeId, 'sssBleed', 0),
        subsurfaceMode: nodeScalar(graph, nodeId, 'mode', 0) as 0 | 1 | 2,
        subsurfaceFollowTopology: nodeScalar(graph, nodeId, 'sssFollowTopology', 0),
        subsurfaceSubset: lamaSssSubset(graph, nodeId),
        subsurfaceContinuation: nodeScalar(graph, nodeId, 'sssContinuationRays', 0) !== 0,
        ior: nodeScalar(graph, nodeId, 'sssIOR', 1),
        color: nodeColor(graph, nodeId, 'color', [0.18, 0.18, 0.18]),
        subsurfaceRadius: scaleRgb(nodeColor(graph, nodeId, 'sssRadius', [0, 0, 0]),
          nodeScalar(graph, nodeId, 'sssScale', 1) * nodeScalar(graph, nodeId, 'sssUnitLength', 0.00328)),
        anisotropy: nodeScalar(graph, nodeId, 'sssAnisotropy', 0),
      }], 1, {});
    case 'LamaIridescence': {
      const min = nodeScalar(graph, nodeId, 'minFilmThickness', 400);
      const max = nodeScalar(graph, nodeId, 'maxFilmThickness', 800);
      const relative = clamp01(nodeScalar(graph, nodeId, 'relativeFilmThickness', 0.5));
      return assemble([{
        kind: 'dielectric_reflection', weight: 1, color: [1, 1, 1], roughness,
        ...(anisotropy > 0 ? { anisotropy } : {}), ...(rotation > 0 ? { rotation } : {}),
      }], 1, {
        thinFilm: { weight: 1, thickness: min + (max - min) * relative, ior: nodeScalar(graph, nodeId, 'filmIOR', 1.3) },
      });
    }
    case 'LamaAdd': {
      const a = scaleLamaClosure(child('material1'), clamp01(nodeScalar(graph, nodeId, 'weight1', 1)));
      const b = scaleLamaClosure(child('material2'), clamp01(nodeScalar(graph, nodeId, 'weight2', 0)));
      return addLamaClosures(a, b);
    }
    case 'LamaMix': {
      const mix = clamp01(nodeScalar(graph, nodeId, 'mix', 0));
      return addLamaClosures(scaleLamaClosure(child('material1'), 1 - mix), scaleLamaClosure(child('material2'), mix));
    }
    case 'LamaLayer': {
      const base = child('materialBase');
      const top = scaleLamaClosure(child('materialTop'), clamp01(nodeScalar(graph, nodeId, 'topMix', 1)));
      const reflection = top.lobes.find(lobe => lobe.kind === 'dielectric_reflection');
      const layer = graph.nodes.get(nodeId)?.lamaLayer;
      const topCoat = reflection && top.lobes.every(lobe =>
        lobe.kind === 'dielectric_reflection' || lobe.kind === 'dielectric_transmission') ? {
        weight: reflection.weight,
        color: reflection.color,
        roughness: reflection.roughness ?? 0,
        ior: reflection.ior ?? 1.5,
        ...(resolveLamaLayerMode(layer?.mode, base.lobes) !== 'fresnel_blend'
          ? { mode: resolveLamaLayerMode(layer?.mode, base.lobes) } : {}),
        ...(layer && layer.topThickness > 0 ? { topThickness: layer.topThickness } : {}),
        ...(() => {
          const transmission = top.lobes.find(lobe => lobe.kind === 'dielectric_transmission');
          const distance = transmission?.attenuationDistance;
          if (!transmission?.attenuationColor || distance === undefined || distance <= 0) return {};
          const absorption = transmission.attenuationColor.map(value => -Math.log(Math.max(value, 1e-6)) / distance) as unknown as Rgb;
          return absorption.some(value => value > 0) ? { absorption } : {};
        })(),
      } : undefined;
      const layers = addLamaClosures(base, { ...top, lobes: topCoat ? [] : top.lobes });
      return { ...layers, ...(topCoat ? { coat: topCoat } : {}) };
    }
    default:
      return { lobes: [], opacity: 1 };
  }
}

function lowerGenericSurface(surface: ResolvedSurface, graph: ResolvedGraph | undefined, frame?: LamaShadingFrame): LayeredClosure {
  const opacity = clamp01(scalarOf(surface.inputs, 'opacity', 1));
  if (!graph) return { lobes: [], opacity };

  const rootNode = graph.nodes.get(surface.nodeId);
  const rootKind = rootNode?.nodeDef?.nodeString ?? rootNode?.category;
  if (rootKind && rootKind.startsWith('Lama') && rootKind !== 'LamaEmission') {
    return { ...lowerLamaBsdf(graph, surface.nodeId, frame), opacity };
  }

  const bsdf = surface.inputs.get('bsdf')?.source;
  const nodeId = bsdf?.kind === 'connection' ? bsdf.nodeId : undefined;
  const bsdfClosure = nodeId ? lowerLamaBsdf(graph, nodeId, frame) : { lobes: [], opacity: 1 };

  const edf = surface.inputs.get('edf')?.source;
  const edfNodeId = edf?.kind === 'connection' ? edf.nodeId : undefined;
  const edfNode = edfNodeId ? graph.nodes.get(edfNodeId) : undefined;
  if (edfNodeId && (edfNode?.nodeDef?.nodeString ?? edfNode?.category) === 'LamaEmission') {
    return {
      ...bsdfClosure,
      opacity,
      emission: nodeColor(graph, edfNodeId, 'color', [0, 0, 0]),
    };
  }
  return { ...bsdfClosure, opacity };
}

/**
 * Lower a resolved surface (T055a) to its LayeredClosure (T054). Dispatches on the
 * resolved family; every family returns a closure whose base lobes, coat, sheen,
 * fuzz, thin film, emission and opacity are driven by the family interface.
 */
export function surfaceGraphToLayered(
  surface: ResolvedSurface,
  graph?: ResolvedGraph,
  frame?: LamaShadingFrame,
): LayeredClosure {
  const m = surface.inputs;
  switch (surface.family) {
    case 'surface':
      return lowerGenericSurface(surface, graph, frame);
    case 'simple_hair': {
      const azimuthal = scalarOf(m, 'azimuthalRoughness', 0.1);
      const fromColor = hairAbsorptionFromColor(rgbOf(m, 'baseColor', [1, 1, 1]), azimuthal);
      const fromMelanin = hairAbsorptionFromMelanin(scalarOf(m, 'melaninConcentration', 0.5), scalarOf(m, 'melaninRedness', 0.5));
      return assemble([{
        kind: 'chiang_hair', weight: 1,
        color: rgbOf(m, 'tint_R', [1, 1, 1]),
        color90: rgbOf(m, 'tint_TT', [1, 1, 1]),
        hairTintTRT: rgbOf(m, 'tint_TRT', [1, 1, 1]),
        extinction: lerpRgb(fromColor, fromMelanin, clamp01(scalarOf(m, 'melaninMix', 1))),
        roughness: scalarOf(m, 'longitudinalRoughness', 0.1),
        anisotropy: azimuthal,
        rotation: scalarOf(m, 'cuticleAngle', 0.5),
        ior: scalarOf(m, 'ior', 1.55),
      }], 1, {});
    }
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
