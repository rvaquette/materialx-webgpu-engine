// T055e2: every material in the regenerated fixture carries an additive, valid
// serialized LayeredClosure, while the seven flat canonical fields (consumed by
// the not-yet-migrated raster/PT backends) stay present and well-typed.
import { describe, it, expect } from 'vitest';
import materials from '../fixtures/scene-materials.json' with { type: 'json' };
import {
  deserializeLayeredClosure,
  serializeLayeredClosure,
  type SerializedLayeredClosure,
} from '../../src/compiler/layered-serialize.ts';

const entries = Object.entries(materials.scenes);
const KINDS = new Set<string>([
  'oren_nayar_diffuse',
  'burley_diffuse',
  'translucent',
  'dielectric_reflection',
  'conductor',
  'generalized_schlick',
  'sheen',
  'subsurface',
]);

function isRgb(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));
}

describe('scene-materials fixture closures (T055e2)', () => {
  it('extracted at least the full control corpus', () => {
    expect(entries.length).toBeGreaterThanOrEqual(40);
  });

  it('keeps the seven flat canonical fields on every material', () => {
    for (const [id, m] of entries) {
      expect(typeof m.family, id).toBe('string');
      expect(Array.isArray(m.focus), id).toBe(true);
      expect(isRgb(m.baseColor), id).toBe(true);
      for (const key of ['metalness', 'roughness', 'transmission', 'subsurface', 'ior', 'specular'] as const) {
        expect(typeof m[key], `${id}.${key}`).toBe('number');
      }
    }
  });

  it('carries a schema-valid closure on every material', () => {
    for (const [id, raw] of entries) {
      const c = raw.closure as SerializedLayeredClosure;
      expect(c, id).toBeDefined();
      expect(Array.isArray(c.lobes), id).toBe(true);
      expect(typeof c.opacity, id).toBe('number');
      for (const lobe of c.lobes) {
        expect(KINDS.has(lobe.kind), `${id} lobe ${lobe.kind}`).toBe(true);
        expect(typeof lobe.weight, id).toBe('number');
        expect(lobe.weight, `${id} ${lobe.kind} weight`).toBeGreaterThan(0);
        expect(isRgb(lobe.color), `${id} ${lobe.kind} color`).toBe(true);
      }
      if (c.coat) expect(isRgb(c.coat.color) && typeof c.coat.ior === 'number', id).toBe(true);
      if (c.sheen) expect(isRgb(c.sheen.color) && typeof c.sheen.roughness === 'number', id).toBe(true);
      if (c.fuzz) expect(isRgb(c.fuzz.color) && typeof c.fuzz.roughness === 'number', id).toBe(true);
      if (c.thinFilm) expect(typeof c.thinFilm.thickness === 'number' && typeof c.thinFilm.ior === 'number', id).toBe(true);
      if (c.emission) expect(isRgb(c.emission), id).toBe(true);
    }
  });

  it('round-trips each stored closure through the codec unchanged', () => {
    for (const [id, raw] of entries) {
      const c = raw.closure as SerializedLayeredClosure;
      const restored = serializeLayeredClosure(deserializeLayeredClosure(c));
      expect(JSON.stringify(restored), id).toBe(JSON.stringify(c));
    }
  });
});
