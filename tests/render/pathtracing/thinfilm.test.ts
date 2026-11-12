// T056f: intrinsic checks for the thin-film (Airy) modulation of the specular
// Fresnel in the reference path tracer. These verify: (1) non-regression -- a film
// of thickness 0 or weight 0 leaves the specular lobe byte-identical to the nominal
// lobe; (2) the film actually modulates -- a non-zero thickness introduces a
// chromatic (iridescent) shift across the RGB channels; (3) eval and sample stay
// coherent and the modulated surface stays energy-bounded (furnace). WGSL parity is
// deferred to the device run (T059); the CPU oracle carries the numeric reference.
import { describe, expect, it } from 'vitest';
import {
  dielectricThinFilmLobe,
  conductorThinFilmLobe,
  dielectricLobe,
  conductorLobe,
  thinWalledTransmissionLobe,
  layeredSurfaceBsdf,
  hemisphericalReflectance,
} from '../../../src/render/pathtracing/bsdf.ts';
import { createPcg32 } from '../../../src/render/pathtracing/integrator.ts';
import type { LayeredClosure } from '../../../src/compiler/ir.ts';
import type { Vec3 } from '../../../src/scene/transforms.ts';
import type { ThinFilmLayer } from '../../../src/compiler/ir.ts';
import { mapThinFilmHue, remapThinFilmCosine, thinFilmTint } from '../../../src/render/pathtracing/spectrum.ts';

type V = [number, number, number];
const normalize = (a: V): V => {
  const len = Math.hypot(a[0], a[1], a[2]);
  return len === 0 ? [0, 0, 1] : [a[0] / len, a[1] / len, a[2] / len];
};
const WO: V = normalize([0.3, 0.2, 1.0]);
const DIRS: V[] = [
  normalize([0.3, 0.0, 0.9]),
  normalize([0.0, 0.4, 0.8]),
  normalize([-0.5, 0.2, 0.7]),
  normalize([0.1, -0.6, 0.6]),
];

describe('thin-film specular modulation (T056f)', () => {
  it('is a no-op at thickness 0 (dielectric specular unchanged)', () => {
    const nominal = dielectricLobe(1.5, 0.2);
    const film: ThinFilmLayer = { weight: 1, thickness: 0, ior: 1.4 };
    const modulated = dielectricThinFilmLobe(1.5, 0.2, 0, 0, film);
    for (const wi of DIRS) {
      const a = nominal.eval(WO, wi);
      const b = modulated.eval(WO, wi);
      expect(b.pdf).toBeCloseTo(a.pdf, 12);
      for (let k = 0; k < 3; k++) expect(b.value[k]).toBeCloseTo(a.value[k]!, 12);
    }
  });

  it('is a no-op at weight 0 (conductor specular unchanged)', () => {
    const nominal = conductorLobe([0.95, 0.64, 0.54], 0.25);
    const film: ThinFilmLayer = { weight: 0, thickness: 350, ior: 1.4 };
    const modulated = conductorThinFilmLobe([0.95, 0.64, 0.54], 0.25, 0, 0, film);
    for (const wi of DIRS) {
      const a = nominal.eval(WO, wi);
      const b = modulated.eval(WO, wi);
      expect(b.pdf).toBeCloseTo(a.pdf, 12);
      for (let k = 0; k < 3; k++) expect(b.value[k]).toBeCloseTo(a.value[k]!, 12);
    }
  });

  it('introduces a chromatic shift at non-zero thickness', () => {
    const nominal = conductorLobe([0.9, 0.9, 0.9], 0.2);
    const film: ThinFilmLayer = { weight: 1, thickness: 420, ior: 1.4 };
    const modulated = conductorThinFilmLobe([0.9, 0.9, 0.9], 0.2, 0, 0, film);
    // The nominal specular is achromatic (R == G == B); the thin film breaks that
    // symmetry (interference peaks differ per wavelength).
    let maxNominalSpread = 0;
    let maxFilmSpread = 0;
    for (const wi of DIRS) {
      const n = nominal.eval(WO, wi).value;
      const m = modulated.eval(WO, wi).value;
      maxNominalSpread = Math.max(maxNominalSpread, Math.abs(n[0] - n[2]));
      maxFilmSpread = Math.max(maxFilmSpread, Math.abs(m[0] - m[2]));
    }
    expect(maxNominalSpread).toBeCloseTo(0, 12);
    expect(maxFilmSpread).toBeGreaterThan(1e-3);
  });

  it('maps the physical film hue to the selected Target Hue', () => {
    const film: ThinFilmLayer = { weight: 1, thickness: 430, ior: 1.4 };
    const mappedFilm: ThinFilmLayer = { ...film, targetHue: [1, 0, 0] };
    const original = dielectricThinFilmLobe(1.5, 0.2, 0, 0, film);
    const mapped = dielectricThinFilmLobe(1.5, 0.2, 0, 0, mappedFilm);
    const originalValue = original.eval(WO, DIRS[0]!).value;
    const mappedValue = mapped.eval(WO, DIRS[0]!).value;
    expect(mappedValue).not.toEqual(originalValue);
    expect(mappedValue.every(Number.isFinite)).toBe(true);
  });

  it.each([[1, 0], [2, 15], [0, 45]])('balances reflection/transmission with angle scale %s and offset %s', (scale, offset) => {
    const film: ThinFilmLayer = { weight: 1, thickness: 430, ior: 1.3, targetHue: [0.1, 0.8, 0.4],
      incidentAngleScale: scale, incidentAngleOffset: offset };
    const roughness = 0.2;
    const bsdf = layeredSurfaceBsdf({
      opacity: 1,
      thinFilm: film,
      lobes: [
        { kind: 'dielectric_reflection', weight: 1, color: [1, 1, 1], roughness, ior: 1 },
        { kind: 'dielectric_transmission', weight: 1, color: [1, 1, 1], roughness, ior: 1, thinWalled: true },
      ],
    });
    const outgoing: V = [0, 0, 1];
    const reflected = bsdf.eval(outgoing, outgoing).value;
    const transmitted = bsdf.eval(outgoing, [0, 0, -1]).value;
    const uncoatedTransmission = thinWalledTransmissionLobe([1, 1, 1], roughness, 1)
      .eval(outgoing, [0, 0, -1]).value;
    const expectedFresnel = mapThinFilmHue(
      thinFilmTint(film.thickness, remapThinFilmCosine(1, scale, offset), film.ior, [0, 0, 0]),
      film.targetHue!,
    );

    for (let channel = 0; channel < 3; channel++) {
      expect(reflected[channel]).toBeGreaterThan(0);
      expect(transmitted[channel]).toBeGreaterThan(0);
      expect(reflected[channel]! + transmitted[channel]!).toBeCloseTo(uncoatedTransmission[channel]!, 10);
      expect(reflected[channel]! / uncoatedTransmission[channel]!).toBeCloseTo(expectedFresnel[channel]!, 10);
    }
    expect(transmitted[0]).not.toBeCloseTo(transmitted[1]!, 5);
  });

  it('eval and sample agree for the thin-film specular lobe', () => {
    const film: ThinFilmLayer = { weight: 0.8, thickness: 380, ior: 1.45,
      incidentAngleScale: 2, incidentAngleOffset: -15 };
    const lobe = dielectricThinFilmLobe(1.5, 0.25, 0, 0, film);
    const rng = createPcg32(83);
    for (let i = 0; i < 256; i++) {
      const s = lobe.sample(WO, rng);
      if (!s) continue;
      const e = lobe.eval(WO, s.wi);
      expect(e.pdf).toBeCloseTo(s.pdf, 9);
      for (let k = 0; k < 3; k++) expect(e.value[k]).toBeCloseTo(s.value[k]!, 9);
    }
  });

  it('conserves energy under the film (hemispherical reflectance bounded)', () => {
    const film: ThinFilmLayer = { weight: 1, thickness: 500, ior: 1.4 };
    const lobe = conductorThinFilmLobe([1, 1, 1], 0.3, 0, 0, film);
    for (const wo of [WO, normalize([0.6, 0.1, 0.8])] as Vec3[]) {
      const rho = hemisphericalReflectance(lobe, wo, createPcg32(29), 60000);
      for (let k = 0; k < 3; k++) {
        expect(rho[k]).toBeGreaterThan(0);
        expect(rho[k]).toBeLessThanOrEqual(1.05);
      }
    }
  });

  it('activates through the layered closure thinFilm layer, nominal without it', () => {
    const closure = (film?: ThinFilmLayer): LayeredClosure => ({
      lobes: [{ kind: 'conductor', weight: 1, color: [0.9, 0.9, 0.9], roughness: 0.2 }],
      ...(film ? { thinFilm: film } : {}),
      opacity: 1,
    });
    const nominal = layeredSurfaceBsdf(closure());
    const inactive = layeredSurfaceBsdf(closure({ weight: 1, thickness: 0, ior: 1.4 }));
    const active = layeredSurfaceBsdf(closure({ weight: 1, thickness: 430, ior: 1.4 }));
    let changed = false;
    for (const wi of DIRS) {
      const n = nominal.eval(WO, wi);
      const z = inactive.eval(WO, wi);
      const a = active.eval(WO, wi);
      for (let k = 0; k < 3; k++) expect(z.value[k]).toBeCloseTo(n.value[k]!, 12);
      if (Math.abs(a.value[0] - a.value[2]) > 1e-3) changed = true;
    }
    expect(changed).toBe(true);
  });
});
