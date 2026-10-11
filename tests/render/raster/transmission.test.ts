import { describe, expect, it } from 'vitest';
import {
  absorptionTransmittance,
  planScreenSpaceTransmission,
  planTransparency,
  refract,
  type TransmissionMaterial,
} from '../../../src/render/raster/transmission.ts';
import type { Vec3 } from '../../../src/scene/transforms.ts';

describe('absorptionTransmittance', () => {
  it('returns the attenuation colour at the reference distance', () => {
    const t = absorptionTransmittance([0.5, 0.25, 0.1], 2, 2);
    expect(t[0]).toBeCloseTo(0.5);
    expect(t[1]).toBeCloseTo(0.25);
    expect(t[2]).toBeCloseTo(0.1);
  });

  it('is identity at zero distance and darkens with depth', () => {
    expect(absorptionTransmittance([0.5, 0.5, 0.5], 1, 0)).toEqual([1, 1, 1]);
    const t = absorptionTransmittance([0.5, 0.5, 0.5], 1, 2); // 0.5^2
    expect(t[0]).toBeCloseTo(0.25);
  });

  it('disables absorption for an infinite attenuation distance', () => {
    expect(absorptionTransmittance([0.2, 0.2, 0.2], Infinity, 10)).toEqual([1, 1, 1]);
  });
});

describe('refract', () => {
  it('bends a straight-on ray through without deviation', () => {
    const r = refract([0, 0, -1], [0, 0, 1], 1 / 1.5);
    expect(r).not.toBeNull();
    const v = r as Vec3;
    expect(v[0]).toBeCloseTo(0);
    expect(v[1]).toBeCloseTo(0);
    expect(v[2]).toBeCloseTo(-1);
  });

  it('returns null on total internal reflection', () => {
    // Dense-to-rare at a grazing angle exceeds the critical angle.
    const r = refract(normalize([1, 0, -0.05]), [0, 0, 1], 1.5);
    expect(r).toBeNull();
  });
});

describe('planScreenSpaceTransmission', () => {
  const material: TransmissionMaterial = {
    ior: 1.5,
    thickness: 2,
    attenuationColor: [0.5, 0.5, 0.5],
    attenuationDistance: 2,
    roughness: 0.5,
  };

  it('maps roughness to a specular mip and declares screen-space limits', () => {
    const plan = planScreenSpaceTransmission({ material, specularMips: 7 });
    expect(plan.refractionMip).toBeCloseTo(3); // 0.5 * (7 - 1)
    expect(plan.transmittance[0]).toBeCloseTo(0.5);
    expect(plan.screenSpace).toBe(true);
    expect(plan.limitations.length).toBeGreaterThan(0);
    expect(plan.limitations.some((l) => l.includes('off-screen'))).toBe(true);
  });
});

describe('planTransparency', () => {
  it('needs nothing when there are no transparent layers', () => {
    expect(planTransparency({ layerCount: 0 })).toEqual({ technique: 'none', exact: true, approximations: [] });
  });

  it('flags a single sorted layer as approximate', () => {
    const plan = planTransparency({ layerCount: 1 });
    expect(plan.technique).toBe('sorted');
    expect(plan.exact).toBe(false);
  });

  it('uses weighted-blended OIT for many layers and declares it approximate', () => {
    const plan = planTransparency({ layerCount: 5 });
    expect(plan.technique).toBe('weightedBlended');
    expect(plan.exact).toBe(false);
    expect(plan.approximations.length).toBe(1);
  });

  it('is exact with depth peeling within budget and approximate beyond it', () => {
    expect(planTransparency({ layerCount: 4, exactRequired: true, maxPeeledLayers: 8 }).exact).toBe(true);
    const deep = planTransparency({ layerCount: 12, exactRequired: true, maxPeeledLayers: 8 });
    expect(deep.technique).toBe('depthPeeling');
    expect(deep.exact).toBe(false);
  });
});

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / len, v[1] / len, v[2] / len];
}
