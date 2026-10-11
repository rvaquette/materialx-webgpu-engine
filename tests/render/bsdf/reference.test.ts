import { describe, it, expect } from 'vitest';
import {
  type ReferenceLighting,
  type ShadingGeometry,
  MX_PI,
  orenNayarDiffuse,
  burleyDiffuse,
  translucent,
  dielectric,
  conductor,
  generalizedSchlick,
  sheen,
  subsurface,
  uniformEdf,
  generalizedSchlickEdf,
  anisotropicVdf,
  ggxNdf,
  smithG1,
  fresnelSchlick,
  fresnelSchlickF90,
  fresnelConductor,
  sheenNdf,
  luminance,
  closureAdd,
  closureMul,
  closureMix,
  layer,
  defaultLighting,
} from '../../../src/render/bsdf/reference.ts';

// Head-on frame: N, V and the single light all along +Z, no ambient.
const headOn: ShadingGeometry = { normal: [0, 0, 1], view: [0, 0, 1] };
const frontLight: ReferenceLighting = {
  environment: [0, 0, 0],
  lights: [{ direction: [0, 0, -1], color: [1, 1, 1], intensity: 1 }],
};
const backLight: ReferenceLighting = {
  environment: [0, 0, 0],
  lights: [{ direction: [0, 0, 1], color: [1, 1, 1], intensity: 1 }],
};

const INV_PI = 1 / MX_PI;

describe('reference helpers', () => {
  it('Schlick Fresnel returns F0 head-on and reaches 1 at grazing', () => {
    expect(fresnelSchlick([0.04, 0.04, 0.04], 1)[0]).toBeCloseTo(0.04, 6);
    expect(fresnelSchlick([0.04, 0.04, 0.04], 0)[0]).toBeCloseTo(1, 6);
  });

  it('Schlick f90 interpolates endpoints', () => {
    expect(fresnelSchlickF90([0.04, 0, 0], [1, 1, 1], 1)[0]).toBeCloseTo(0.04, 6);
    expect(fresnelSchlickF90([0.04, 0, 0], [1, 1, 1], 0)).toEqual([1, 1, 1]);
  });

  it('conductor Fresnel stays within [0,1]', () => {
    const F = fresnelConductor([0.2, 0.9, 1.5], [3, 2, 1.9], 0.5);
    for (const v of F) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(1);
  });

  it('Smith G1 is unity at normal incidence for any roughness', () => {
    expect(smithG1(1, 0.1)).toBeCloseTo(1, 6);
    expect(smithG1(1, 0.9)).toBeCloseTo(1, 6);
  });

  it('GGX NDF peaks at NdotH=1 and decreases off-axis', () => {
    expect(ggxNdf(1, 0.25)).toBeGreaterThan(ggxNdf(0.8, 0.25));
  });

  it('sheen NDF vanishes at NdotH=1 (sin=0) and is positive off-axis', () => {
    expect(sheenNdf(1, 0.3)).toBeCloseTo(0, 6);
    expect(sheenNdf(0.9, 0.3)).toBeGreaterThan(0);
  });

  it('luminance uses the documented Rec.709-ish weights', () => {
    expect(luminance([1, 1, 1])).toBeCloseTo(1, 6);
    expect(luminance([1, 0, 0])).toBeCloseTo(0.2722287, 6);
  });
});

describe('diffuse lobes', () => {
  it('Oren-Nayar at roughness 0 reduces to Lambert (albedo/pi * NdotL)', () => {
    const c = orenNayarDiffuse(1, [1, 1, 1], 0, headOn, frontLight);
    expect(c.color[0]).toBeCloseTo(INV_PI, 6);
    expect(c.weight).toBe(1);
  });

  it('Oren-Nayar scales response by the lobe weight', () => {
    const c = orenNayarDiffuse(0.5, [1, 1, 1], 0, headOn, frontLight);
    expect(c.color[0]).toBeCloseTo(INV_PI * 0.5, 6);
    expect(c.weight).toBe(0.5);
  });

  it('Burley at roughness 0 matches Lambert head-on', () => {
    const c = burleyDiffuse(1, [1, 1, 1], 0, headOn, frontLight);
    expect(c.color[0]).toBeCloseTo(INV_PI, 6);
  });

  it('translucent lobe is lit from behind the surface', () => {
    expect(translucent(1, [1, 1, 1], headOn, frontLight).color[0]).toBeCloseTo(0, 6);
    expect(translucent(1, [1, 1, 1], headOn, backLight).color[0]).toBeCloseTo(INV_PI, 6);
  });

  it('subsurface wrap-diffuse is fully lit head-on', () => {
    const c = subsurface(1, [1, 1, 1], [1, 1, 1], headOn, frontLight);
    expect(c.color[0]).toBeCloseTo(INV_PI, 6);
  });

  it('ambient environment contributes color * env', () => {
    const lit: ReferenceLighting = { environment: [0.1, 0.2, 0.3], lights: [] };
    const c = orenNayarDiffuse(1, [1, 1, 1], 0, headOn, lit);
    expect(c.color).toEqual([0.1, 0.2, 0.3]);
  });
});

describe('specular lobes', () => {
  it('dielectric GGX head-on (ior 1.5, roughness 0.5) matches F0*D*G/(4 NdotV)', () => {
    const c = dielectric(1, [1, 1, 1], 1.5, 0.5, headOn, frontLight);
    expect(c.color[0]).toBeCloseTo(0.0509296, 5);
  });

  it('generalized Schlick head-on equals a dielectric with F0 = color0', () => {
    const c = generalizedSchlick(1, [0.04, 0.04, 0.04], [1, 1, 1], 0.5, headOn, frontLight);
    expect(c.color[0]).toBeCloseTo(0.0509296, 5);
  });

  it('conductor produces a finite, non-negative response and passes the weight', () => {
    const c = conductor(1, [0.2, 0.9, 1.5], [3, 2, 1.9], 0.3, headOn, frontLight);
    for (const v of c.color) expect(Number.isFinite(v)).toBe(true), expect(v).toBeGreaterThanOrEqual(0);
    expect(c.weight).toBe(1);
  });

  it('sheen is positive for an oblique light and zero response head-on', () => {
    const oblique: ReferenceLighting = {
      environment: [0, 0, 0],
      lights: [{ direction: [-0.6, 0, -0.8], color: [1, 1, 1], intensity: 1 }],
    };
    expect(sheen(1, [1, 1, 1], 0.3, headOn, oblique).color[0]).toBeGreaterThan(0);
    expect(sheen(1, [1, 1, 1], 0.3, headOn, frontLight).color[0]).toBeCloseTo(0, 6);
  });
});

describe('EDF', () => {
  it('uniform EDF emits its color with zero reflectance', () => {
    const c = uniformEdf([2, 3, 4]);
    expect(c.color).toEqual([2, 3, 4]);
    expect(c.weight).toBe(0);
  });

  it('generalized Schlick EDF picks color0 head-on and color90 at grazing', () => {
    expect(generalizedSchlickEdf([1, 0, 0], [0, 0, 1], headOn).color).toEqual([1, 0, 0]);
    const grazing: ShadingGeometry = { normal: [0, 0, 1], view: [1, 0, 0] };
    expect(generalizedSchlickEdf([1, 0, 0], [0, 0, 1], grazing).color).toEqual([0, 0, 1]);
  });
});

describe('VDF', () => {
  it('isotropic phase at g=0 equals 1/(4 pi) and albedo-luminance weight', () => {
    const c = anisotropicVdf([0, 0, 0], [1, 1, 1], 0, headOn, frontLight);
    expect(c.color[0]).toBeCloseTo(1 / (4 * MX_PI), 6);
    expect(c.weight).toBeCloseTo(1, 6);
  });

  it('positive anisotropy scatters more forward than backward', () => {
    const geom: ShadingGeometry = { normal: [0, 0, 1], view: [0, 0, 1] };
    const forward: ReferenceLighting = { environment: [0, 0, 0], lights: [{ direction: [0, 0, 1], color: [1, 1, 1], intensity: 1 }] };
    const backward: ReferenceLighting = { environment: [0, 0, 0], lights: [{ direction: [0, 0, -1], color: [1, 1, 1], intensity: 1 }] };
    const g = 0.5;
    const fwd = anisotropicVdf([0, 0, 0], [1, 1, 1], g, geom, forward).color[0];
    const bwd = anisotropicVdf([0, 0, 0], [1, 1, 1], g, geom, backward).color[0];
    expect(fwd).toBeGreaterThan(bwd);
  });
});

describe('energetic composition', () => {
  it('closureAdd sums color and clamps weight', () => {
    const c = closureAdd({ color: [1, 0, 0], weight: 0.7 }, { color: [0, 1, 0], weight: 0.6 });
    expect(c.color).toEqual([1, 1, 0]);
    expect(c.weight).toBe(1);
  });

  it('closureMul scales color and reflectance by the weight luminance', () => {
    const c = closureMul({ color: [1, 1, 1], weight: 1 }, [1, 1, 1]);
    expect(c.color).toEqual([1, 1, 1]);
    expect(c.weight).toBeCloseTo(1, 6);
    const half = closureMul({ color: [1, 1, 1], weight: 1 }, [0.5, 0.5, 0.5]);
    expect(half.weight).toBeCloseTo(0.5, 6);
  });

  it('closureMix blends color and weight', () => {
    const c = closureMix({ color: [1, 0, 0], weight: 1 }, { color: [0, 0, 1], weight: 0 }, 0.25);
    expect(c.color).toEqual([0.75, 0, 0.25]);
    expect(c.weight).toBeCloseTo(0.75, 6);
  });

  it('layer couples the base through the top throughput', () => {
    const base = { color: [0.2, 0.2, 0.2] as const, weight: 0.5 };
    const opaqueTop = layer({ color: [0.3, 0.3, 0.3], weight: 1 }, base);
    expect(opaqueTop.color).toEqual([0.3, 0.3, 0.3]);
    expect(opaqueTop.weight).toBe(1);
    const clearTop = layer({ color: [0.3, 0.3, 0.3], weight: 0 }, base);
    expect(clearTop.color).toEqual([0.5, 0.5, 0.5]);
    expect(clearTop.weight).toBe(0.5);
    const halfTop = layer({ color: [0.3, 0.3, 0.3], weight: 0.5 }, base);
    expect(halfTop.color[0]).toBeCloseTo(0.4, 6);
    expect(halfTop.weight).toBeCloseTo(0.75, 6);
  });
});

describe('defaults', () => {
  it('defaultLighting mirrors the engine DEFAULT_LIGHTING', () => {
    const d = defaultLighting();
    expect(d.environment).toEqual([0.03, 0.03, 0.03]);
    expect(d.lights).toHaveLength(1);
    expect(d.lights[0]).toEqual({ direction: [0, 0, -1], color: [1, 1, 1], intensity: 1 });
  });
});
