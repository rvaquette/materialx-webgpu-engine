// T035a: lock the centralized tolerance table and its resolvers so a change to a
// threshold is a deliberate, reviewed edit rather than an accidental drift.
import { describe, it, expect } from 'vitest';
import {
  NODE_TOLERANCE,
  DEFAULT_NODE_TOLERANCE,
  nodeTolerance,
  isEnvelopeCase,
} from './tolerances.ts';
import { NODE_CASES_BY_CATEGORY, type NodeCase } from './node-cases.ts';

describe('conformance tolerances (T035a)', () => {
  it('pins the per-class absolute bounds', () => {
    expect(NODE_TOLERANCE.expr).toBe(2e-3);
    expect(NODE_TOLERANCE.closure).toBe(2e-3);
    expect(NODE_TOLERANCE.texture).toBeCloseTo(1 / 255 + 1e-4, 12);
    expect(DEFAULT_NODE_TOLERANCE).toBe(2e-3);
  });

  it('resolves tolerance from an exec class or a case', () => {
    expect(nodeTolerance('texture')).toBe(NODE_TOLERANCE.texture);
    const textureCase = [...NODE_CASES_BY_CATEGORY.values()].find((c) => c.exec === 'texture');
    expect(textureCase, 'a texture case exists in the corpus').toBeDefined();
    expect(nodeTolerance(textureCase!)).toBe(NODE_TOLERANCE.texture);
  });

  it('every corpus case maps to a finite positive tolerance', () => {
    for (const c of NODE_CASES_BY_CATEGORY.values()) {
      const tol = nodeTolerance(c);
      expect(Number.isFinite(tol), `${c.category} tolerance finite`).toBe(true);
      expect(tol, `${c.category} tolerance > 0`).toBeGreaterThan(0);
    }
  });

  it('flags only non-reproducible cases as envelope cases', () => {
    for (const c of NODE_CASES_BY_CATEGORY.values()) {
      const expected = c.reproducible === false;
      expect(isEnvelopeCase(c as NodeCase)).toBe(expected);
      if (expected) {
        expect(c.envelope, `${c.category} has an envelope`).toBeDefined();
      }
    }
  });
});
