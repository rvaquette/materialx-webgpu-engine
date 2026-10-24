// T055e1: build a ResolvedSurface (and its LayeredClosure) from already-parsed
// surface inputs, without the WASM document pipeline. The fixture builder parses
// a family's <input> values from a .mtlx example; this bridge wraps them in a
// minimal single-node ResolvedGraph so resolveSurface (T055a) applies the
// official nodedef defaults/classification and surfaceGraphToLayered (T055b)
// produces the layered closure -- the single lowering path the fixtures and
// harnesses share once T055e removes the hand-rolled canonical mappings.

import type { CanonicalSurfaceInputs, LayeredClosure } from '../compiler/ir.ts';
import { surfaceGraphToLayered } from '../compiler/surface-lower.ts';
import type { ResolvedGraph, ResolvedInput, ResolvedNode } from './graph.ts';
import { resolveSurface, type ResolveSurfaceOptions, type ResolvedSurface } from './surface-graph.ts';

/** A surface node's inputs already parsed to literal numbers (fixtures/harnesses). */
export interface ParsedSurfaceInputs {
  /** MaterialX surface node category, e.g. 'standard_surface'. */
  readonly category: string;
  /** Authored input values keyed by interface input name. */
  readonly inputs: Readonly<Record<string, number | readonly number[] | boolean>>;
  /** Optional nodedef version (standard_surface inheritance); default = latest. */
  readonly version?: string;
}

function inferType(v: number | readonly number[] | boolean): string {
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'number') return 'float';
  return v.length >= 3 ? 'color3' : v.length === 2 ? 'vector2' : 'float';
}

function valueString(v: number | readonly number[] | boolean): string {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  return v.map((x) => String(x)).join(', ');
}

/** Wrap parsed surface inputs in a minimal single-node ResolvedGraph. */
export function resolvedGraphFromParsedSurface(spec: ParsedSurfaceInputs): ResolvedGraph {
  const id = 'SR';
  const inputs: ResolvedInput[] = Object.entries(spec.inputs).map(([name, v]) => {
    const type = inferType(v);
    return {
      name,
      type,
      source: { kind: 'value', value: valueString(v), type },
      provenance: { namePath: `/mat/${name}` },
    };
  });
  const node: ResolvedNode = {
    id,
    category: spec.category,
    type: 'surfaceshader',
    ...(spec.version !== undefined
      ? {
          nodeDef: {
            name: `ND_${spec.category}`,
            nodeString: spec.category,
            type: 'surfaceshader',
            version: spec.version,
            implementation: { kind: 'nodegraph', name: `NG_${spec.category}` },
          },
        }
      : {}),
    inputs,
    provenance: { namePath: `/mat/${id}` },
  };
  return {
    terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: id, provenance: { namePath: `/mat/${id}` } }],
    nodes: new Map([[id, node]]),
  };
}

/** Resolve parsed surface inputs to a normalized ResolvedSurface (T055a). */
export function surfaceFromParsedInputs(
  spec: ParsedSurfaceInputs,
  options?: ResolveSurfaceOptions,
): ResolvedSurface | null {
  return resolveSurface(resolvedGraphFromParsedSurface(spec), options);
}

/** Lower parsed surface inputs straight to a LayeredClosure (T055a + T055b). */
export function parsedInputsToLayered(
  spec: ParsedSurfaceInputs,
  options?: ResolveSurfaceOptions,
): LayeredClosure | null {
  const surface = surfaceFromParsedInputs(spec, options);
  return surface ? surfaceGraphToLayered(surface) : null;
}

// --- canonical seven-parameter reduction (T055e4) ----------------------------
// The scene-material builder (and the T055e5 harnesses) feed the not-yet-migrated
// 7-parameter raster/PT consumers from the SAME parsed surface the LayeredClosure
// is lowered from -- there is no longer a parallel per-family mapping living in
// the build script. The per-family interface names are reduced to the shared
// {baseColor, metalness, roughness, transmission, subsurface, ior, specular}
// model with the official MaterialX defaults, matching the resolved surface.

type ParsedValue = number | readonly number[] | boolean;

function parsedNum(v: ParsedValue | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function parsedRgb(
  v: ParsedValue | undefined,
  fallback: readonly [number, number, number],
): [number, number, number] {
  if (Array.isArray(v) && v.length >= 3) return [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0];
  return [fallback[0], fallback[1], fallback[2]];
}

function scaleRgb(c: readonly [number, number, number], k: number): [number, number, number] {
  return [c[0] * k, c[1] * k, c[2] * k];
}

/**
 * Reduce a family's parsed surface inputs to the shared canonical surface
 * parameters (T055e4). This is the single reduction that replaces the per-family
 * toCanonical switch formerly duplicated in scripts/build-scene-materials.ts.
 */
export function parsedSurfaceToCanonical(spec: ParsedSurfaceInputs): CanonicalSurfaceInputs {
  const inp = spec.inputs;
  switch (spec.category) {
    case 'standard_surface': {
      const base = parsedNum(inp.base, 1);
      return {
        baseColor: scaleRgb(parsedRgb(inp.base_color, [0.8, 0.8, 0.8]), base),
        metalness: parsedNum(inp.metalness, 0),
        roughness: parsedNum(inp.specular_roughness, 0.2),
        transmission: parsedNum(inp.transmission, 0),
        subsurface: parsedNum(inp.subsurface, 0),
        ior: parsedNum(inp.specular_IOR, 1.5),
        specular: parsedNum(inp.specular, 1),
      };
    }
    case 'open_pbr_surface': {
      const baseWeight = parsedNum(inp.base_weight, 1);
      return {
        baseColor: scaleRgb(parsedRgb(inp.base_color, [0.8, 0.8, 0.8]), baseWeight),
        metalness: parsedNum(inp.base_metalness, 0),
        roughness: parsedNum(inp.specular_roughness, 0.3),
        transmission: parsedNum(inp.transmission_weight, 0),
        subsurface: parsedNum(inp.subsurface_weight, 0),
        ior: parsedNum(inp.specular_ior, 1.5),
        specular: parsedNum(inp.specular_weight, 1),
      };
    }
    case 'disney_principled':
      return {
        baseColor: parsedRgb(inp.baseColor, [0.8, 0.8, 0.8]),
        metalness: parsedNum(inp.metallic, 0),
        roughness: parsedNum(inp.roughness, 0.5),
        transmission: parsedNum(inp.specTrans, 0),
        subsurface: parsedNum(inp.subsurface, 0),
        ior: parsedNum(inp.ior, 1.5),
        specular: 1,
      };
    case 'gltf_pbr':
      return {
        baseColor: parsedRgb(inp.base_color, [1, 1, 1]),
        metalness: parsedNum(inp.metallic, 1),
        roughness: parsedNum(inp.roughness, 1),
        transmission: parsedNum(inp.transmission, 0),
        subsurface: 0,
        ior: parsedNum(inp.ior, 1.5),
        specular: parsedNum(inp.specular, 1),
      };
    case 'UsdPreviewSurface':
      return {
        baseColor: parsedRgb(inp.diffuseColor, [0.18, 0.18, 0.18]),
        metalness: parsedNum(inp.metallic, 0),
        roughness: parsedNum(inp.roughness, 0.5),
        transmission: 0,
        subsurface: 0,
        ior: parsedNum(inp.ior, 1.5),
        specular: 1,
      };
    default:
      throw new Error(`unmapped surface family '${spec.category}'`);
  }
}

// --- raw .mtlx text parser (T055e5) ------------------------------------------
// The fixture builder and the device/preview harnesses hold raw .mtlx text, not a
// WASM Document. This is the single regex parser that extracts a known surface
// shader node's literal inputs into a ParsedSurfaceInputs -- it replaces the
// per-call parseOpenPbr copies formerly living in the USD harness and the disney
// validation script, so all three feed the shared resolution + reduction.

/** Known MaterialX surface-shader node categories, in match-priority order. */
const SURFACE_NODE_TAGS = [
  'standard_surface',
  'open_pbr_surface',
  'disney_principled',
  'gltf_pbr',
  'UsdPreviewSurface',
] as const;

/** Parse <input name=.. type=.. value=.. /> entries into a name -> value map. */
function parseSurfaceInputBlock(block: string): Record<string, number | number[] | boolean> {
  const inputs: Record<string, number | number[] | boolean> = {};
  const re = /<input\s+name="([^"]+)"\s+type="([^"]+)"\s+value="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const [, name, type, value] = m;
    if (name === undefined || type === undefined || value === undefined) continue;
    if (type === 'color3' || type === 'vector3') {
      inputs[name] = value.split(',').map((v) => Number.parseFloat(v.trim()));
    } else if (type === 'float' || type === 'integer') {
      inputs[name] = Number.parseFloat(value);
    } else if (type === 'boolean') {
      inputs[name] = value.trim() === 'true';
    }
  }
  return inputs;
}

/**
 * Extract the first known surface-shader node from raw .mtlx text as a
 * ParsedSurfaceInputs (T055e5). Returns null when no supported surface node is
 * present, letting callers fall back to a neutral surface.
 */
export function parseSurfaceInputsFromMtlx(text: string): ParsedSurfaceInputs | null {
  for (const tag of SURFACE_NODE_TAGS) {
    const re = new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, 'm');
    const m = re.exec(text);
    if (m) return { category: tag, inputs: parseSurfaceInputBlock(m[0]) };
  }
  return null;
}
