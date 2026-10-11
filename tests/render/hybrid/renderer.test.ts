import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../../src/scene/transforms.ts';
import {
  compositeHybrid,
  estimateFrameRays,
  planHybrid,
  type HybridComponents,
  type HybridConfig,
} from '../../../src/render/hybrid/renderer.ts';

describe('planHybrid', () => {
  it('includes only enabled effects in declared order', () => {
    const config: HybridConfig = {
      shadows: { enabled: true, raysPerPixel: 1 },
      reflections: { enabled: false, raysPerPixel: 4 },
      indirect: { enabled: true, raysPerPixel: 8, maxBounces: 3 },
    };
    const plan = planHybrid(config);
    expect(plan.budgets.map((b) => b.effect)).toEqual(['shadows', 'indirect']);
  });

  it('multiplies multi-bounce effect cost by bounce depth', () => {
    const plan = planHybrid({ indirect: { enabled: true, raysPerPixel: 8, maxBounces: 3 } });
    const indirect = plan.budgets[0]!;
    expect(indirect.estimatedRaysPerPixel).toBe(24);
    expect(plan.totalRaysPerPixel).toBe(24);
  });

  it('keeps shadows at one ray per sample regardless of maxBounces', () => {
    const plan = planHybrid({ shadows: { enabled: true, raysPerPixel: 2, maxBounces: 5 } });
    expect(plan.budgets[0]!.estimatedRaysPerPixel).toBe(2);
  });

  it('declares tradeoffs for each traced effect', () => {
    const plan = planHybrid({ reflections: { enabled: true, raysPerPixel: 4, maxBounces: 2 } });
    expect(plan.budgets[0]!.tradeoffs.length).toBeGreaterThan(0);
  });

  it('assigns untraced terms back to the raster passes', () => {
    const plan = planHybrid({ shadows: { enabled: true, raysPerPixel: 1 } });
    expect(plan.rasterResponsibilities).toContain('screen-space transmission');
    expect(plan.rasterResponsibilities).not.toContain('shadow maps');
  });

  it('sums the total ray budget across effects', () => {
    const plan = planHybrid({
      shadows: { enabled: true, raysPerPixel: 1 },
      reflections: { enabled: true, raysPerPixel: 4, maxBounces: 2 },
    });
    expect(plan.totalRaysPerPixel).toBe(1 + 8);
  });
});

describe('estimateFrameRays', () => {
  it('scales the budget by resolution', () => {
    const plan = planHybrid({ indirect: { enabled: true, raysPerPixel: 2, maxBounces: 2 } });
    expect(estimateFrameRays(plan, 100, 50)).toBe(4 * 100 * 50);
  });
});

describe('compositeHybrid', () => {
  const base: HybridComponents = {
    emission: [0.1, 0, 0],
    directUnshadowed: [1, 1, 1],
    ambient: [0.05, 0.05, 0.05],
  };

  it('defaults to fully lit with no layers', () => {
    const out = compositeHybrid(base);
    expect(out[0]).toBeCloseTo(1.15, 10);
    expect(out[1]).toBeCloseTo(1.05, 10);
    expect(out[2]).toBeCloseTo(1.05, 10);
  });

  it('removes the direct term when fully shadowed', () => {
    const out = compositeHybrid(base, { shadowVisibility: [0, 0, 0] });
    expect(out[0]).toBeCloseTo(0.15, 10);
    expect(out[1]).toBeCloseTo(0.05, 10);
    expect(out[2]).toBeCloseTo(0.05, 10);
  });

  it('adds reflection, transmission and indirect layers', () => {
    const out = compositeHybrid(base, {
      shadowVisibility: [1, 1, 1],
      reflection: [0.2, 0, 0],
      transmission: [0, 0.3, 0],
      indirect: [0, 0, 0.4],
    });
    expect(out[0]).toBeCloseTo(1.35, 10);
    expect(out[1]).toBeCloseTo(1.35, 10);
    expect(out[2]).toBeCloseTo(1.45, 10);
  });

  it('modulates only the direct term by visibility', () => {
    const half: Vec3 = [0.5, 0.5, 0.5];
    const out = compositeHybrid(base, { shadowVisibility: half });
    expect(out[0]).toBeCloseTo(0.1 + 0.5 + 0.05, 10);
  });
});
