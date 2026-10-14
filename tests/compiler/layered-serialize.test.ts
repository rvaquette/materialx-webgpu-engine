// T055e1: the LayeredClosure JSON codec is deterministic (fixed rounding) and
// round-trips back to an equivalent closure, so the fixture builder and its
// consumers agree on one on-disk representation.

import { describe, it, expect } from 'vitest';
import type { LayeredClosure } from '../../src/compiler/ir.ts';
import {
  deserializeLayeredClosure,
  roundTo,
  serializeLayeredClosure,
} from '../../src/compiler/layered-serialize.ts';

const rich: LayeredClosure = {
  lobes: [
    { kind: 'conductor', weight: 1, color: [0.8, 0.5, 0.2], roughness: 0.2, anisotropy: 0.3, rotation: 0.25 },
    { kind: 'generalized_schlick', weight: 0.5, color: [0.04, 0.04, 0.04], color90: [1, 1, 1], roughness: 0.4, ior: 1.5 },
    { kind: 'burley_diffuse', weight: 0.25, color: [0.1, 0.2, 0.3] },
  ],
  coat: { weight: 0.7, color: [1, 1, 1], roughness: 0.1, ior: 1.5 },
  sheen: { weight: 0.3, color: [0.9, 0.9, 0.8], roughness: 0.3 },
  fuzz: { weight: 0.2, color: [0.5, 0.5, 0.5], roughness: 0.4 },
  thinFilm: { weight: 1, thickness: 500, ior: 1.4 },
  emission: [2, 1, 0.5],
  opacity: 0.9,
};

describe('LayeredClosure serialization (T055e1)', () => {
  it('rounds every numeric field to the requested decimals', () => {
    const s = serializeLayeredClosure({ lobes: [{ kind: 'burley_diffuse', weight: 0.1234567, color: [0.7654321, 0, 0] }], opacity: 1 }, 6);
    expect(s.lobes[0]!.weight).toBe(0.123457);
    expect(s.lobes[0]!.color[0]).toBe(0.765432);
  });

  it('normalizes -0 to 0', () => {
    expect(Object.is(roundTo(-0), 0)).toBe(true);
    const s = serializeLayeredClosure({ lobes: [{ kind: 'conductor', weight: -0, color: [-0, 0, 0] }], opacity: 1 });
    expect(Object.is(s.lobes[0]!.weight, 0)).toBe(true);
    expect(Object.is(s.lobes[0]!.color[0], 0)).toBe(true);
  });

  it('omits absent layer slots and optional lobe fields', () => {
    const s = serializeLayeredClosure({ lobes: [{ kind: 'burley_diffuse', weight: 1, color: [1, 1, 1] }], opacity: 1 });
    expect(s).not.toHaveProperty('coat');
    expect(s).not.toHaveProperty('sheen');
    expect(s).not.toHaveProperty('fuzz');
    expect(s).not.toHaveProperty('thinFilm');
    expect(s).not.toHaveProperty('emission');
    expect(s.lobes[0]).not.toHaveProperty('roughness');
    expect(s.lobes[0]).not.toHaveProperty('ior');
    expect(s.lobes[0]).not.toHaveProperty('color90');
  });

  it('carries every slot and optional field through serialization', () => {
    const s = serializeLayeredClosure(rich);
    expect(s.coat).toEqual({ weight: 0.7, color: [1, 1, 1], roughness: 0.1, ior: 1.5 });
    expect(s.sheen).toEqual({ weight: 0.3, color: [0.9, 0.9, 0.8], roughness: 0.3 });
    expect(s.fuzz).toEqual({ weight: 0.2, color: [0.5, 0.5, 0.5], roughness: 0.4 });
    expect(s.thinFilm).toEqual({ weight: 1, thickness: 500, ior: 1.4 });
    expect(s.emission).toEqual([2, 1, 0.5]);
    expect(s.lobes[0]).toEqual({ kind: 'conductor', weight: 1, color: [0.8, 0.5, 0.2], roughness: 0.2, anisotropy: 0.3, rotation: 0.25 });
    expect(s.lobes[1]!.color90).toEqual([1, 1, 1]);
  });

  it('round-trips a rich closure back to an equal closure', () => {
    const back = deserializeLayeredClosure(serializeLayeredClosure(rich));
    expect(back).toEqual(rich);
  });

  it('is idempotent and produces stable JSON text', () => {
    const once = serializeLayeredClosure(rich);
    const twice = serializeLayeredClosure(deserializeLayeredClosure(once));
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});
