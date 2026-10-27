// T055a: resolve and normalize the surface-shader interface of a ResolvedGraph.
// Consumes the renderer-independent graph from graph.ts, classifies the surface
// family, applies the official nodedef defaults (with standard_surface version
// inheritance), and produces a per-family normalized input map keyed by input
// name whose source is a literal value, an upstream connection (left intact for
// the T055c shader lowering), a defaultgeomprop, or an inherited nodedef default.
// Any unsupported family, input, or connected node category is reported through
// the DiagnosticSink (REQ-013) rather than silently dropped. No LayeredClosure is
// built here (that is T055b) and no shader is generated (that is T055c/T055d).

import { defaultDiagnosticSink, type DiagnosticSink } from '../core/diagnostics.ts';
import type { ResolvedGraph } from './graph.ts';

/** Surface-shader families with a known interface contract. */
export type SurfaceFamily =
  | 'standard_surface'
  | 'open_pbr_surface'
  | 'disney_principled'
  | 'gltf_pbr'
  | 'UsdPreviewSurface';

export type SurfaceInputType = 'float' | 'color3' | 'vector3' | 'integer' | 'boolean';

/** One declared interface input of a family nodedef with its official default. */
export interface SurfaceInputDef {
  readonly name: string;
  readonly type: SurfaceInputType;
  /** Parsed literal default; omitted when the input defaults to a geomprop. */
  readonly default?: readonly number[];
  /** Geometric property name supplying the default (normal/tangent inputs). */
  readonly geomprop?: string;
}

/** Normalized source of a resolved surface input. */
export type NormalizedSurfaceSource =
  | { kind: 'value'; value: readonly number[] }
  | { kind: 'connection'; nodeId: string; output?: string }
  | { kind: 'default'; value: readonly number[] }
  | { kind: 'geomprop'; name: string };

export interface NormalizedSurfaceInput {
  readonly name: string;
  readonly type: SurfaceInputType;
  readonly source: NormalizedSurfaceSource;
  /** Optional live uniform name, assigned by the interactive material editor. */
  readonly parameter?: string;
}

export interface ResolvedSurface {
  readonly family: SurfaceFamily;
  readonly nodeId: string;
  readonly nodeDefName?: string;
  readonly version?: string;
  /** Every declared interface input, resolved to a normalized source. */
  readonly inputs: ReadonlyMap<string, NormalizedSurfaceInput>;
}

export interface ResolveSurfaceOptions {
  onDiagnostic?: DiagnosticSink;
  /** Resolve 'interface' inputs when the surface node sits inside a nodegraph. */
  interface?: ReadonlyMap<string, NormalizedSurfaceSource>;
  /** Upstream node categories the downstream lowering can emit; others warn. */
  supportedUpstream?: ReadonlySet<string>;
}

// --- value parsing -----------------------------------------------------------

function parseValue(type: SurfaceInputType, raw: string): number[] {
  if (type === 'boolean') return [raw.trim() === 'true' ? 1 : 0];
  const parts = raw.split(',').map((s) => Number.parseFloat(s.trim()));
  const finite = (x: number | undefined): number => (x !== undefined && Number.isFinite(x) ? x : 0);
  if (type === 'float' || type === 'integer') return [finite(parts[0])];
  const out: number[] = [];
  for (let k = 0; k < 3; k++) out.push(finite(parts[k]));
  return out;
}

// --- family interface tables (official nodedef defaults) ---------------------

const f = (name: string, def: number): SurfaceInputDef => ({ name, type: 'float', default: [def] });
const c = (name: string, r: number, g: number, b: number): SurfaceInputDef => ({
  name,
  type: 'color3',
  default: [r, g, b],
});
const i = (name: string, def: number): SurfaceInputDef => ({ name, type: 'integer', default: [def] });
const bool = (name: string, def: boolean): SurfaceInputDef => ({ name, type: 'boolean', default: [def ? 1 : 0] });
const geom = (name: string, prop: string): SurfaceInputDef => ({ name, type: 'vector3', geomprop: prop });
const v3 = (name: string, x: number, y: number, z: number): SurfaceInputDef => ({
  name,
  type: 'vector3',
  default: [x, y, z],
});

// standard_surface nodedef ND_standard_surface_surfaceshader_100 (version 1.0.0).
const STANDARD_SURFACE_100: readonly SurfaceInputDef[] = [
  f('base', 0.8),
  c('base_color', 1, 1, 1),
  f('diffuse_roughness', 0),
  f('metalness', 0),
  f('specular', 1),
  c('specular_color', 1, 1, 1),
  f('specular_roughness', 0.2),
  f('specular_IOR', 1.5),
  f('specular_anisotropy', 0),
  f('specular_rotation', 0),
  f('transmission', 0),
  c('transmission_color', 1, 1, 1),
  f('transmission_depth', 0),
  c('transmission_scatter', 0, 0, 0),
  f('transmission_scatter_anisotropy', 0),
  f('transmission_dispersion', 0),
  f('transmission_extra_roughness', 0),
  f('subsurface', 0),
  c('subsurface_color', 1, 1, 1),
  c('subsurface_radius', 1, 1, 1),
  f('subsurface_scale', 1),
  f('subsurface_anisotropy', 0),
  f('sheen', 0),
  c('sheen_color', 1, 1, 1),
  f('sheen_roughness', 0.3),
  f('coat', 0),
  c('coat_color', 1, 1, 1),
  f('coat_roughness', 0.1),
  f('coat_anisotropy', 0),
  f('coat_rotation', 0),
  f('coat_IOR', 1.5),
  geom('coat_normal', 'Nworld'),
  f('coat_affect_color', 0),
  f('coat_affect_roughness', 0),
  f('thin_film_thickness', 0),
  f('thin_film_IOR', 1.5),
  f('emission', 0),
  c('emission_color', 1, 1, 1),
  c('opacity', 1, 1, 1),
  bool('thin_walled', false),
  geom('normal', 'Nworld'),
  geom('tangent', 'Tworld'),
];

// Version 1.0.1 is 1.0.0 with only two default overrides (reuses the nodegraph).
const STANDARD_SURFACE_101_OVERRIDES: ReadonlyMap<string, SurfaceInputDef> = new Map([
  ['base', f('base', 1)],
  ['base_color', c('base_color', 0.8, 0.8, 0.8)],
]);

const OPEN_PBR_SURFACE: readonly SurfaceInputDef[] = [
  f('base_weight', 1),
  c('base_color', 0.8, 0.8, 0.8),
  f('base_diffuse_roughness', 0),
  f('base_metalness', 0),
  f('specular_weight', 1),
  c('specular_color', 1, 1, 1),
  f('specular_roughness', 0.3),
  f('specular_ior', 1.5),
  f('specular_roughness_anisotropy', 0),
  f('transmission_weight', 0),
  c('transmission_color', 1, 1, 1),
  f('transmission_depth', 0),
  c('transmission_scatter', 0, 0, 0),
  f('transmission_scatter_anisotropy', 0),
  f('transmission_dispersion_scale', 0),
  f('transmission_dispersion_abbe_number', 20),
  f('subsurface_weight', 0),
  c('subsurface_color', 0.8, 0.8, 0.8),
  f('subsurface_radius', 1),
  c('subsurface_radius_scale', 1, 0.5, 0.25),
  f('subsurface_scatter_anisotropy', 0),
  f('fuzz_weight', 0),
  c('fuzz_color', 1, 1, 1),
  f('fuzz_roughness', 0.5),
  f('coat_weight', 0),
  c('coat_color', 1, 1, 1),
  f('coat_roughness', 0),
  f('coat_roughness_anisotropy', 0),
  f('coat_ior', 1.6),
  f('coat_darkening', 1),
  f('thin_film_weight', 0),
  f('thin_film_thickness', 0.5),
  f('thin_film_ior', 1.4),
  f('emission_luminance', 0),
  c('emission_color', 1, 1, 1),
  f('geometry_opacity', 1),
  bool('geometry_thin_walled', false),
  geom('geometry_normal', 'Nworld'),
  geom('geometry_coat_normal', 'Nworld'),
  geom('geometry_tangent', 'Tworld'),
  geom('geometry_coat_tangent', 'Tworld'),
];

const GLTF_PBR: readonly SurfaceInputDef[] = [
  c('base_color', 1, 1, 1),
  f('metallic', 1),
  f('roughness', 1),
  geom('normal', 'Nworld'),
  geom('tangent', 'Tworld'),
  f('occlusion', 1),
  f('transmission', 0),
  f('specular', 1),
  c('specular_color', 1, 1, 1),
  f('ior', 1.5),
  f('alpha', 1),
  i('alpha_mode', 0),
  f('alpha_cutoff', 0.5),
  f('iridescence', 0),
  f('iridescence_thickness', 100),
  c('sheen_color', 0, 0, 0),
  f('sheen_roughness', 0),
  f('clearcoat', 0),
  f('clearcoat_roughness', 0),
  geom('clearcoat_normal', 'Nworld'),
  c('emissive', 0, 0, 0),
  f('anisotropy_strength', 0),
  f('anisotropy_rotation', 0),
  f('dispersion', 0),
];

const USD_PREVIEW_SURFACE: readonly SurfaceInputDef[] = [
  c('diffuseColor', 0.18, 0.18, 0.18),
  c('emissiveColor', 0, 0, 0),
  i('useSpecularWorkflow', 0),
  c('specularColor', 0, 0, 0),
  f('metallic', 0),
  f('roughness', 0.5),
  f('clearcoat', 0),
  f('clearcoatRoughness', 0.01),
  f('opacity', 1),
  f('opacityThreshold', 0),
  f('ior', 1.5),
  v3('normal', 0, 0, 1),
  f('displacement', 0),
  f('occlusion', 1),
];

const DISNEY_PRINCIPLED: readonly SurfaceInputDef[] = [
  c('baseColor', 0.16, 0.16, 0.16),
  f('metallic', 0),
  f('roughness', 0.5),
  f('anisotropic', 0),
  f('specular', 0.5),
  f('specularTint', 0),
  f('sheen', 0),
  f('sheenTint', 0.5),
  f('clearcoat', 0),
  f('clearcoatGloss', 1),
  f('specTrans', 0),
  f('ior', 1.5),
  f('subsurface', 0),
  c('subsurfaceDistance', 1, 1, 1),
];

const FAMILY_INPUTS: Record<SurfaceFamily, readonly SurfaceInputDef[]> = {
  standard_surface: STANDARD_SURFACE_100,
  open_pbr_surface: OPEN_PBR_SURFACE,
  disney_principled: DISNEY_PRINCIPLED,
  gltf_pbr: GLTF_PBR,
  UsdPreviewSurface: USD_PREVIEW_SURFACE,
};

const KNOWN_FAMILIES = new Set<string>(Object.keys(FAMILY_INPUTS));

/** Upstream node categories the texture/procedural lowering (T055c) can emit. */
export const DEFAULT_SUPPORTED_UPSTREAM: ReadonlySet<string> = new Set([
  'image',
  'tiledimage',
  'hextiledimage',
  'constant',
  'multiply',
  'add',
  'subtract',
  'divide',
  'min',
  'max',
  'clamp',
  'range',
  'mix',
  'combine2',
  'combine3',
  'combine4',
  'separate3',
  'convert',
  'rgbtohsv',
  'hsvtorgb',
  'normalmap',
  'noise2d',
  'noise3d',
  'fractal2d',
  'fractal3d',
  'cellnoise2d',
  'cellnoise3d',
  'position',
  'normal',
  'tangent',
  'texcoord',
  'geompropvalue',
  'dot',
  'extract',
  'swizzle',
]);

/** Resolve the declared default for a family input into a normalized source. */
function defaultSource(def: SurfaceInputDef): NormalizedSurfaceSource {
  if (def.geomprop !== undefined) return { kind: 'geomprop', name: def.geomprop };
  return { kind: 'default', value: def.default ?? [0] };
}

/** Pick the family input table, applying standard_surface version inheritance. */
function familyInputs(family: SurfaceFamily, version: string | undefined): readonly SurfaceInputDef[] {
  const base = FAMILY_INPUTS[family];
  if (family !== 'standard_surface') return base;
  // Version 1.0.0 uses its own defaults; any newer default version (1.0.1) applies overrides.
  if (version === '1.0.0') return base;
  return base.map((d) => STANDARD_SURFACE_101_OVERRIDES.get(d.name) ?? d);
}

/**
 * Resolve the surfaceshader terminal of a ResolvedGraph into a per-family
 * normalized interface map. Returns null when there is no supported surface.
 */
export function resolveSurface(graph: ResolvedGraph, options: ResolveSurfaceOptions = {}): ResolvedSurface | null {
  const diag = options.onDiagnostic ?? defaultDiagnosticSink;
  const supportedUpstream = options.supportedUpstream ?? DEFAULT_SUPPORTED_UPSTREAM;

  const terminal = graph.terminals.find((t) => t.name === 'surfaceshader');
  if (!terminal || terminal.nodeId === undefined) {
    diag({
      level: 'error',
      message: "No surfaceshader terminal connected; cannot resolve a surface closure (REQ-013).",
      detail: { terminals: graph.terminals.map((t) => t.name) },
    });
    return null;
  }

  const node = graph.nodes.get(terminal.nodeId);
  if (!node) {
    diag({
      level: 'error',
      message: `Surfaceshader terminal references missing node '${terminal.nodeId}' (REQ-013).`,
      detail: { nodeId: terminal.nodeId },
    });
    return null;
  }

  const familyKey = node.nodeDef?.nodeString ?? node.category;
  if (!KNOWN_FAMILIES.has(familyKey)) {
    diag({
      level: 'error',
      message: `Unsupported surface family '${familyKey}' (${node.id}); no LayeredClosure lowering available (REQ-013).`,
      detail: { nodeId: node.id, category: node.category, nodeString: node.nodeDef?.nodeString },
    });
    return null;
  }
  const family = familyKey as SurfaceFamily;
  const version = node.nodeDef?.version;
  const fallbackDefs = familyInputs(family, version);
  // Real documents carry their active NodeDef interface, including inherited inputs.
  // Family tables are only a fallback for synthetic graphs and absent NodeDefs.
  const defs: readonly SurfaceInputDef[] = node.nodeDef?.inputs?.length
    ? node.nodeDef.inputs.flatMap(input => {
      if (!['float', 'color3', 'vector3', 'integer', 'boolean'].includes(input.type)) return [];
      const type = input.type as SurfaceInputType;
      const fallback = fallbackDefs.find(def => def.name === input.name);
      return [{
        name: input.name, type,
        ...(input.geomprop ? { geomprop: input.geomprop }
          : input.value !== undefined ? { default: parseValue(type, input.value) }
          : fallback?.geomprop ? { geomprop: fallback.geomprop }
          : { default: fallback?.default ?? [0] }),
      }];
    })
    : fallbackDefs;
  const declared = new Set(defs.map((d) => d.name));

  const authored = new Map(node.inputs.map((input) => [input.name, input] as const));
  const inputs = new Map<string, NormalizedSurfaceInput>();

  for (const def of defs) {
    const input = authored.get(def.name);
    let source: NormalizedSurfaceSource;

    if (!input) {
      source = defaultSource(def);
    } else {
      switch (input.source.kind) {
        case 'value':
          source = { kind: 'value', value: parseValue(def.type, input.source.value) };
          break;
        case 'connection': {
          const connected = graph.nodes.get(input.source.nodeId);
          const category = connected?.category;
          if (category !== undefined && !supportedUpstream.has(category)) {
            diag({
              level: 'warning',
              message: `Input '${family}.${def.name}' is driven by unsupported node '${category}' (${input.source.nodeId}); its contribution would be lost (REQ-013).`,
              detail: { family, input: def.name, nodeId: input.source.nodeId, category },
            });
          }
          source = input.source.output !== undefined
            ? { kind: 'connection', nodeId: input.source.nodeId, output: input.source.output }
            : { kind: 'connection', nodeId: input.source.nodeId };
          break;
        }
        case 'interface': {
          const resolved = options.interface?.get(input.source.name);
          if (resolved) {
            source = resolved;
          } else {
            diag({
              level: 'warning',
              message: `Interface input '${input.source.name}' for '${family}.${def.name}' is unresolved; falling back to the nodedef default (REQ-013).`,
              detail: { family, input: def.name, interfaceName: input.source.name },
            });
            source = defaultSource(def);
          }
          break;
        }
        case 'default':
          source = defaultSource(def);
          break;
      }
    }

    inputs.set(def.name, { name: def.name, type: def.type, source });
  }

  for (const input of node.inputs) {
    if (!declared.has(input.name)) {
      diag({
        level: 'warning',
        message: `Unknown input '${input.name}' on '${family}' surface (${node.id}); not part of the nodedef interface and ignored (REQ-013).`,
        detail: { family, input: input.name, nodeId: node.id },
      });
    }
  }

  return {
    family,
    nodeId: node.id,
    ...(node.nodeDef?.name !== undefined ? { nodeDefName: node.nodeDef.name } : {}),
    ...(version !== undefined ? { version } : {}),
    inputs,
  };
}
