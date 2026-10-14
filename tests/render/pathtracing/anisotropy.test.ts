// T056c: intrinsic checks for the anisotropic GGX specular lobes (conductor and
// dielectric) in the reference path tracer. These verify: (1) the isotropic
// reduction -- anisotropy 0 reproduces the isotropic lobe exactly; (2) the lobe
// is self-consistent (eval/sample agree, energy stays bounded); (3) anisotropy
// and the tangent rotation actually shape the lobe. WGSL parity is deferred to
// the device run (T059); here the CPU oracle carries the numeric reference.
import { describe, expect, it } from 'vitest';
import {
  conductorLobe,
  dielectricLobe,
  conductorAnisoLobe,
  dielectricAnisoLobe,
  hemisphericalReflectance,
  lobeFromLayered,
} from '../../../src/render/pathtracing/bsdf.ts';
import { createPcg32 } from '../../../src/render/pathtracing/integrator.ts';
import type { Vec3 } from '../../../src/scene/transforms.ts';

type V = [number, number, number];
const normalize = (a: V): V => {
  const len = Math.hypot(a[0], a[1], a[2]);
  return len === 0 ? [0, 0, 1] : [a[0] / len, a[1] / len, a[2] / len];
};
const WO: V = normalize([0.4, 0.1, 1.0]);
const GOLD: Vec3 = [1, 0.86, 0.57];

describe('anisotropic GGX lobes (T056c)', () => {
  it('reduce to the isotropic lobe when anisotropy is zero', () => {
    const pairs: [ReturnType<typeof conductorLobe>, ReturnType<typeof conductorLobe>][] = [
      [conductorAnisoLobe(GOLD, 0.3, 0, 0), conductorLobe(GOLD, 0.3)],
      [dielectricAnisoLobe(1.5, 0.3, 0, 0), dielectricLobe(1.5, 0.3)],
    ];
    const dirs: V[] = [
      normalize([0.3, 0.0, 0.9]),
      normalize([0.0, 0.3, 0.9]),
      normalize([-0.4, 0.2, 0.8]),
      normalize([0.1, -0.5, 0.7]),
    ];
    for (const [aniso, iso] of pairs) {
      for (const wi of dirs) {
        const a = aniso.eval(WO, wi);
        const b = iso.eval(WO, wi);
        expect(a.pdf).toBeCloseTo(b.pdf, 10);
        for (let k = 0; k < 3; k++) expect(a.value[k]).toBeCloseTo(b.value[k]!, 10);
      }
    }
  });

  it('eval and sample agree at the sampled direction', () => {
    const lobe = conductorAnisoLobe(GOLD, 0.35, 0.8, 0.15);
    const rng = createPcg32(23);
    for (let i = 0; i < 128; i++) {
      const s = lobe.sample(WO, rng);
      if (!s) continue;
      const e = lobe.eval(WO, s.wi);
      expect(e.pdf).toBeCloseTo(s.pdf, 9);
      for (let k = 0; k < 3; k++) expect(e.value[k]).toBeCloseTo(s.value[k]!, 9);
    }
  });

  it('conserves energy (hemispherical reflectance bounded, positive)', () => {
    const lobe = conductorAnisoLobe([1, 1, 1], 0.3, 0.85, 0.0);
    for (const wo of [WO, normalize([0.6, 0.2, 0.8])]) {
      const rho = hemisphericalReflectance(lobe, wo, createPcg32(9), 40000);
      for (let k = 0; k < 3; k++) {
        expect(rho[k]).toBeGreaterThan(0.01);
        expect(rho[k]).toBeLessThanOrEqual(1.05);
      }
    }
  });

  it('shapes the lobe: swapping tangent axes changes the anisotropic response only', () => {
    const up: V = [0, 0, 1];
    const wiX: V = normalize([0.6, 0.0, 0.8]);
    const wiY: V = normalize([0.0, 0.6, 0.8]);
    const iso = conductorAnisoLobe(GOLD, 0.4, 0, 0);
    expect(iso.eval(up, wiX).value[0]).toBeCloseTo(iso.eval(up, wiY).value[0]!, 10);
    const aniso = conductorAnisoLobe(GOLD, 0.4, 0.8, 0);
    const vx = aniso.eval(up, wiX).value[0]!;
    const vy = aniso.eval(up, wiY).value[0]!;
    expect(Math.abs(vx - vy)).toBeGreaterThan(1e-3);
  });

  it('rotation by a quarter turn swaps the anisotropy axes', () => {
    const up: V = [0, 0, 1];
    const wiX: V = normalize([0.6, 0.0, 0.8]);
    const wiY: V = normalize([0.0, 0.6, 0.8]);
    const base = conductorAnisoLobe(GOLD, 0.4, 0.8, 0);
    const turned = conductorAnisoLobe(GOLD, 0.4, 0.8, 0.25);
    // A quarter-turn of the tangent frame maps the x response onto the y query.
    expect(turned.eval(up, wiY).value[0]).toBeCloseTo(base.eval(up, wiX).value[0]!, 9);
    // Half-turn symmetry: the squared-component NDF is invariant to rotation 0.5.
    const half = conductorAnisoLobe(GOLD, 0.4, 0.8, 0.5);
    expect(half.eval(up, wiX).value[0]).toBeCloseTo(base.eval(up, wiX).value[0]!, 10);
  });

  it('lobeFromLayered uses the anisotropic core only when anisotropy > 0', () => {
    const up: V = [0, 0, 1];
    const wiX: V = normalize([0.6, 0.0, 0.8]);
    const wiY: V = normalize([0.0, 0.6, 0.8]);
    const isoLobe = lobeFromLayered({ kind: 'conductor', weight: 1, color: GOLD, roughness: 0.4 });
    const anisoLobe = lobeFromLayered({
      kind: 'conductor',
      weight: 1,
      color: GOLD,
      roughness: 0.4,
      anisotropy: 0.8,
    });
    expect(isoLobe).not.toBeNull();
    expect(anisoLobe).not.toBeNull();
    // Isotropic: axis swap leaves the value unchanged; anisotropic: it does not.
    expect(isoLobe!.eval(up, wiX).value[0]).toBeCloseTo(isoLobe!.eval(up, wiY).value[0]!, 10);
    const dx = anisoLobe!.eval(up, wiX).value[0]!;
    const dy = anisoLobe!.eval(up, wiY).value[0]!;
    expect(Math.abs(dx - dy)).toBeGreaterThan(1e-3);
  });
});
