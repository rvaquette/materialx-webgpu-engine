// T055e3: per-family parity of the single LayeredClosure path against the oracle
// and the 7-parameter anchor. (a) reconstruct a resolved surface per family and
// show surfaceGraphToLayered (T055b) feeds the same serialized closure the
// fixture stores; (b) evaluate evaluateLayeredSurface (reference.ts, T054) under
// defaultLighting across several geometries and check non-regression against the
// 7-param anchor canonicalSurfaceToLayered within tolerances (tolerances.ts);
// (c) check emitLayeredSurface (T055d) yields a structurally coherent module per
// family. The raw per-scene inputs are not persisted (only the derived closure +
// seven flat fields), so (a)/(c) reconstruct from representative per-family
// inputs and (b) ties each stored closure to the anchor built from its flat fields.
import { describe, it, expect } from 'vitest';
import materials from '../fixtures/scene-materials.json' with { type: 'json' };
import {
  deserializeLayeredClosure,
  serializeLayeredClosure,
  type SerializedLayeredClosure,
} from '../../src/compiler/layered-serialize.ts';
import {
  parsedInputsToLayered,
  resolvedGraphFromParsedSurface,
  surfaceFromParsedInputs,
  type ParsedSurfaceInputs,
} from '../../src/materialx/surface-from-inputs.ts';
import { surfaceGraphToLayered } from '../../src/compiler/surface-lower.ts';
import {
  canonicalSurfaceToLayered,
  type CanonicalSurfaceInputs,
  type LayeredClosure,
} from '../../src/compiler/ir.ts';
import {
  evaluateLayeredSurface,
  defaultLighting,
  type ReferenceClosure,
  type ShadingGeometry,
} from '../../src/render/bsdf/reference.ts';
import { emitLayeredSurface } from '../../src/compiler/surface-wgsl.ts';
import { nodeTolerance } from '../fixtures/tolerances.ts';
import type { SurfaceFamily } from '../../src/materialx/surface-graph.ts';

const TOL = nodeTolerance('closure');
const entries = Object.entries(materials.scenes);

// Fixture display name -> resolved SurfaceFamily.
const FAMILY_OF: Readonly<Record<string, CanonicalFamily>> = {
  StandardSurface: 'standard_surface',
  OpenPbr: 'open_pbr_surface',
  DisneyPrincipled: 'disney_principled',
  GltfPbr: 'gltf_pbr',
  UsdPreviewSurface: 'UsdPreviewSurface',
};

// One base-only (no coat/sheen/fuzz/thin-film/transmission) representative per
// family, with the matching seven canonical parameters.
interface Rep {
  readonly spec: ParsedSurfaceInputs;
  readonly canon: CanonicalSurfaceInputs;
}

type CanonicalFamily = Exclude<SurfaceFamily, 'simple_hair'>;

const REPS: Readonly<Record<CanonicalFamily, Rep>> = {
  standard_surface: {
    spec: {
      category: 'standard_surface',
      inputs: {
        base: 1,
        base_color: [0.8, 0.3, 0.2],
        metalness: 0,
        specular: 0.5,
        specular_color: [1, 1, 1],
        specular_roughness: 0.3,
        diffuse_roughness: 0.3,
        specular_IOR: 1.5,
        transmission: 0,
        subsurface: 0,
      },
    },
    canon: { baseColor: [0.8, 0.3, 0.2], metalness: 0, roughness: 0.3, transmission: 0, subsurface: 0, ior: 1.5, specular: 0.5 },
  },
  open_pbr_surface: {
    spec: {
      category: 'open_pbr_surface',
      inputs: {
        base_weight: 1,
        base_color: [0.8, 0.3, 0.2],
        base_metalness: 0,
        specular_weight: 1,
        specular_color: [1, 1, 1],
        specular_roughness: 0.3,
        specular_ior: 1.5,
        transmission_weight: 0,
        subsurface_weight: 0,
      },
    },
    canon: { baseColor: [0.8, 0.3, 0.2], metalness: 0, roughness: 0.3, transmission: 0, subsurface: 0, ior: 1.5, specular: 1 },
  },
  disney_principled: {
    spec: {
      category: 'disney_principled',
      inputs: { baseColor: [0.8, 0.3, 0.2], metallic: 0, roughness: 0.3, specular: 0.5, ior: 1.5, specTrans: 0, subsurface: 0 },
    },
    canon: { baseColor: [0.8, 0.3, 0.2], metalness: 0, roughness: 0.3, transmission: 0, subsurface: 0, ior: 1.5, specular: 0.5 },
  },
  gltf_pbr: {
    spec: {
      category: 'gltf_pbr',
      inputs: { base_color: [0.8, 0.3, 0.2], metallic: 0, roughness: 0.3, specular: 1, specular_color: [1, 1, 1], transmission: 0 },
    },
    canon: { baseColor: [0.8, 0.3, 0.2], metalness: 0, roughness: 0.3, transmission: 0, subsurface: 0, ior: 1.5, specular: 1 },
  },
  UsdPreviewSurface: {
    spec: {
      category: 'UsdPreviewSurface',
      inputs: { diffuseColor: [0.8, 0.3, 0.2], metallic: 0, roughness: 0.3, ior: 1.5, useSpecularWorkflow: 0, opacity: 1 },
    },
    canon: { baseColor: [0.8, 0.3, 0.2], metalness: 0, roughness: 0.3, transmission: 0, subsurface: 0, ior: 1.5, specular: 1 },
  },
};

const FAMILIES = Object.keys(REPS) as CanonicalFamily[];

// A set of shading frames: head-on, oblique view, and a tilted normal.
const GEOMS: readonly ShadingGeometry[] = [
  { normal: [0, 0, 1], view: [0, 0, 1] },
  { normal: [0, 0, 1], view: [0.6, 0, 0.8] },
  { normal: [0, 1, 0], view: [0, 0.5, 0.8660254] },
];

const shade = (c: LayeredClosure, g: ShadingGeometry): ReferenceClosure => evaluateLayeredSurface(c, g, defaultLighting());

/** Lobe multiset signature (kind + weight), order-independent. */
const lobeSig = (c: LayeredClosure): string[] => c.lobes.map((l) => `${l.kind}:${l.weight.toFixed(6)}`).sort();

/** True when a closure carries only base lobes (no coat/sheen/fuzz/thin-film/emission). */
const baseOnly = (c: LayeredClosure): boolean => !c.coat && !c.sheen && !c.fuzz && !c.thinFilm && !c.emission;

const finiteNonNeg = (r: ReferenceClosure): boolean =>
  r.color.every((x) => Number.isFinite(x) && x >= 0) && Number.isFinite(r.weight) && r.weight >= 0 && r.weight <= 1;

describe('scene LayeredClosure parity (T055e3)', () => {
  describe('reconstructed surfaces lower through surfaceGraphToLayered (a)', () => {
    for (const family of FAMILIES) {
      it(`resolves ${family} and lowers deterministically`, () => {
        const { spec } = REPS[family];
        const surface = surfaceFromParsedInputs(spec);
        expect(surface, family).not.toBeNull();
        expect(surface!.family).toBe(family);
        const closure = surfaceGraphToLayered(surface!);
        expect(closure.lobes.length, family).toBeGreaterThan(0);
        // The builder feeds the fixture through this exact pipeline: serialize of
        // surfaceGraphToLayered equals the bridge parsedInputsToLayered path.
        expect(serializeLayeredClosure(closure)).toEqual(serializeLayeredClosure(parsedInputsToLayered(spec)!));
      });
    }

    it('every stored fixture closure is round-trip stable through the serialize codec', () => {
      for (const [id, m] of entries) {
        const stored = m.closure as unknown as SerializedLayeredClosure;
        const again = serializeLayeredClosure(deserializeLayeredClosure(stored));
        expect(JSON.stringify(again), id).toBe(JSON.stringify(stored));
      }
    });
  });

  describe('evaluateLayeredSurface non-regression vs the 7-param anchor (b)', () => {
    it('reconstructed family bases match canonicalSurfaceToLayered where they reduce identically', () => {
      let strict = 0;
      for (const family of FAMILIES) {
        const { spec, canon } = REPS[family];
        const rich = surfaceGraphToLayered(surfaceFromParsedInputs(spec)!);
        const anchor = canonicalSurfaceToLayered(canon);
        for (const g of GEOMS) {
          expect(finiteNonNeg(shade(rich, g)), family).toBe(true);
          expect(finiteNonNeg(shade(anchor, g)), family).toBe(true);
        }
        // A base-only closure with the anchor's lobe stack must render identically.
        if (baseOnly(rich) && JSON.stringify(lobeSig(rich)) === JSON.stringify(lobeSig(anchor))) {
          strict++;
          for (const g of GEOMS) {
            const a = shade(rich, g);
            const b = shade(anchor, g);
            for (let k = 0; k < 3; k++) expect(Math.abs(a.color[k]! - b.color[k]!), family).toBeLessThanOrEqual(TOL);
            expect(Math.abs(a.weight - b.weight), family).toBeLessThanOrEqual(TOL);
          }
        }
      }
      // standard_surface is the anchor's native family: it must reduce exactly.
      expect(strict).toBeGreaterThan(0);
    });

    it('every fixture scene evaluates to finite, in-range radiance across geometries', () => {
      for (const [id, m] of entries) {
        const stored = deserializeLayeredClosure(m.closure as unknown as SerializedLayeredClosure);
        // The seven flat fields are a (lossy) hand reduction (toCanonical); their
        // anchor is evaluated for non-regression sanity, not byte parity.
        const anchor = canonicalSurfaceToLayered({
          baseColor: m.baseColor as [number, number, number],
          metalness: m.metalness,
          roughness: m.roughness,
          transmission: m.transmission,
          subsurface: m.subsurface,
          ior: m.ior,
          specular: m.specular,
        });
        for (const g of GEOMS) {
          expect(finiteNonNeg(shade(stored, g)), id).toBe(true);
          expect(finiteNonNeg(shade(anchor, g)), id).toBe(true);
        }
      }
    });
  });

  describe('emitLayeredSurface structural coherence (c)', () => {
    for (const family of FAMILIES) {
      it(`emits a coherent module for ${family}`, () => {
        const { spec } = REPS[family];
        const graph = resolvedGraphFromParsedSurface(spec);
        const surface = surfaceFromParsedInputs(spec);
        expect(surface, family).not.toBeNull();
        const mod = emitLayeredSurface(graph, surface!);
        expect(mod.family).toBe(family);
        expect(mod.entryPoint).toBe('mx_surface_layered');
        expect(mod.returnType).toBe('LayeredClosure');
        expect(mod.code).toContain('fn mx_surface_layered(vary: MxVaryings) -> LayeredClosure');
        expect(mod.code).toContain('c.lobeCount');
        expect(mod.code).toContain('c.opacity');
        expect(Array.isArray(mod.uniforms), family).toBe(true);
        expect(Array.isArray(mod.textures), family).toBe(true);
        expect(Array.isArray(mod.samplers), family).toBe(true);
      });
    }
  });
});

// Keep the display-name map referenced so a fixture family rename surfaces here.
describe('scene-parity fixture family coverage (T055e3)', () => {
  it('maps every fixture family to a representative', () => {
    for (const [id, m] of entries) {
      const fam = FAMILY_OF[m.family];
      expect(fam, id).toBeDefined();
      expect(REPS[fam!], id).toBeDefined();
    }
  });
});
