import { describe, expect, it } from 'vitest';

import {
  HAIR_WGSL,
  hairAbsorptionFromColor,
  hairAbsorptionFromMelanin,
  hairEval,
  hairSample,
  type HairParameters,
  type HairVec3,
} from '../../../src/render/bsdf/hair.ts';

const BASE: HairParameters = {
  absorption: [0.2, 0.35, 0.55],
  tintR: [1, 1, 1],
  tintTT: [1, 1, 1],
  tintTRT: [1, 1, 1],
  longitudinalRoughness: 0.35,
  azimuthalRoughness: 0.28,
  cuticleAngle: 3.5,
  ior: 1.55,
};

function integrateSphere(
  evaluate: (wi: HairVec3) => { value: HairVec3; pdf: number },
  binsTheta = 48,
  binsPhi = 96,
): { energy: [number, number, number]; pdf: number } {
  const energy: [number, number, number] = [0, 0, 0];
  let pdfIntegral = 0;
  const dTheta = Math.PI / binsTheta;
  const dPhi = 2 * Math.PI / binsPhi;
  for (let t = 0; t < binsTheta; t++) {
    const theta = -Math.PI / 2 + (t + 0.5) * dTheta;
    const radial = Math.cos(theta);
    for (let p = 0; p < binsPhi; p++) {
      const phi = (p + 0.5) * dPhi - Math.PI;
      const wi: [number, number, number] = [
        Math.sin(theta),
        radial * Math.sin(phi),
        radial * Math.cos(phi),
      ];
      const result = evaluate(wi);
      const solidAngle = radial * dTheta * dPhi;
      pdfIntegral += result.pdf * solidAngle;
      const weight = Math.abs(wi[2]) * solidAngle;
      for (let channel = 0; channel < 3; channel++) {
        energy[channel] = energy[channel]! + result.value[channel]! * weight;
      }
    }
  }
  return { energy, pdf: pdfIntegral };
}

describe('Chiang cylindrical hair oracle', () => {
  it('integrates its spherical PDF and energy without hemisphere clipping', () => {
    const wo: HairVec3 = [0.22, -0.31, 0.925];
    const integral = integrateSphere((wi) => hairEval(BASE, wo, wi));
    expect(integral.pdf).toBeCloseTo(1, 1);
    for (const energy of integral.energy) {
      expect(Number.isFinite(energy)).toBe(true);
      expect(energy).toBeGreaterThan(0);
      expect(energy).toBeLessThanOrEqual(1.05);
    }

    const belowNormal = hairEval(BASE, wo, [0.1, 0.25, -0.96]);
    expect(belowNormal.pdf).toBeGreaterThan(0);
    expect(belowNormal.value.every(Number.isFinite)).toBe(true);
  });

  it('matches each sampled direction and PDF against the CPU evaluator', () => {
    const wo: HairVec3 = [0.18, 0.12, 0.976];
    for (const u of [
      [0.01, 0.13, 0.77],
      [0.27, 0.64, 0.31],
      [0.71, 0.42, 0.95],
      [0.98, 0.89, 0.04],
    ] as const) {
      const sample = hairSample(BASE, wo, u);
      expect(sample.valid).toBe(true);
      expect(sample.pdf).toBeGreaterThan(0);
      const evaluated = hairEval(BASE, wo, sample.wi);
      expect(sample.pdf).toBeCloseTo(evaluated.pdf, 11);
      for (let channel = 0; channel < 3; channel++) {
        expect(sample.value[channel]).toBeCloseTo(evaluated.value[channel]!, 11);
      }
    }
  });

  it('matches the analytic longitudinal sampler moment to quadrature of Chiang M', () => {
    const parameters: HairParameters = {
      ...BASE,
      absorption: [0, 0, 0],
      longitudinalRoughness: 0.35,
      azimuthalRoughness: 0.4,
      cuticleAngle: 0,
    };
    const thetaO = 0.24;
    const wo: HairVec3 = [Math.sin(thetaO), 0, Math.cos(thetaO)];
    const cosIncident = Math.cos(thetaO);
    const cosTransmitted = Math.sqrt(1 - (1 - cosIncident ** 2) / parameters.ior ** 2);
    const rs = (parameters.ior * cosIncident - cosTransmitted) /
      (parameters.ior * cosIncident + cosTransmitted);
    const rp = (cosIncident - parameters.ior * cosTransmitted) /
      (cosIncident + parameters.ior * cosTransmitted);
    const f = 0.5 * (rs ** 2 + rp ** 2);
    const pathWeight = f / (f + (1 - f) ** 2 * (1 + f) + (1 - f) * f ** 2);
    const variance = (0.726 * parameters.longitudinalRoughness +
      0.812 * parameters.longitudinalRoughness ** 2 + 3.7 * parameters.longitudinalRoughness ** 20) ** 2;
    const besselI0 = (x: number): number => {
      let term = 1;
      let sum = 1;
      for (let k = 1; k <= 32; k++) {
        term *= x * x / (4 * k * k);
        sum += term;
      }
      return sum;
    };
    const quadratureBins = 4000;
    let expected = 0;
    for (let i = 0; i < quadratureBins; i++) {
      const sinI = -1 + (i + 0.5) * 2 / quadratureBins;
      const cosI = Math.sqrt(1 - sinI * sinI);
      const inv = 1 / variance;
      const m = Math.exp(-sinI * Math.sin(thetaO) * inv) *
        besselI0(cosI * Math.cos(thetaO) * inv) / (2 * variance * Math.sinh(inv));
      expected += sinI * m * 2 / quadratureBins;
    }

    const count = 48;
    let sampledMean = 0;
    for (let x = 0; x < count; x++) {
      for (let y = 0; y < count; y++) {
        const pathRemap = (x + 0.5) / count;
        const inverseCdf = (y + 0.5) / count;
        const sample = hairSample(parameters, wo, [pathWeight * pathRemap, inverseCdf, 0.37]);
        sampledMean += sample.wi[0] / (count * count);
      }
    }
    expect(sampledMean).toBeCloseTo(expected, 2);
  });

  it('reduces transmitted energy as melanin or inferred extinction increases', () => {
    const wo: HairVec3 = [0.17, 0.23, 0.958];
    const clear = integrateSphere((wi) => hairEval({ ...BASE, absorption: [0, 0, 0] }, wo, wi), 36, 72);
    const dark = integrateSphere((wi) => hairEval({ ...BASE, absorption: [1.2, 1.2, 1.2] }, wo, wi), 36, 72);
    expect(dark.energy[0]).toBeLessThan(clear.energy[0]);
    const lightMelanin = hairAbsorptionFromMelanin(0.5, 0);
    const redMelanin = hairAbsorptionFromMelanin(0.5, 1);
    expect(lightMelanin.every((channel) => channel >= 0)).toBe(true);
    expect(redMelanin[0]).toBeLessThan(lightMelanin[0]);
    expect(hairAbsorptionFromColor([0.8, 0.4, 0.2], 0.3)[2]).toBeGreaterThan(
      hairAbsorptionFromColor([0.8, 0.4, 0.2], 0.3)[0],
    );
  });

  it('keeps finite outputs for degenerate directions and extreme inputs', () => {
    const extreme: HairParameters = {
      absorption: [Infinity, -10, 1e9],
      tintR: [NaN, 2, -1],
      tintTT: [Infinity, 0.4, 0.7],
      tintTRT: [0.2, 0.3, 0.4],
      longitudinalRoughness: 0,
      azimuthalRoughness: 0,
      cuticleAngle: 1e9,
      ior: 0,
    };
    for (const result of [
      hairEval(extreme, [0, 0, 0], [0, 0, 1]),
      hairEval(extreme, [1, 0, 0], [0, 1, 0]),
      hairSample(extreme, [0, 0, 1], [0.5, 0.5, 0.5]),
    ]) {
      expect(Number.isFinite(result.pdf)).toBe(true);
      expect(result.value.every(Number.isFinite)).toBe(true);
    }
    expect(hairAbsorptionFromMelanin(Infinity, NaN).every(Number.isFinite)).toBe(true);
    expect(hairAbsorptionFromColor([0, NaN, 2], Infinity).every(Number.isFinite)).toBe(true);
  });

  it('exports matching WGSL entrypoints and absorption conversions', () => {
    expect(HAIR_WGSL).toContain('fn mx_hair_eval(lobe: MxBsdfLobe, wo: vec3f, wi: vec3f) -> MxBsdfEval');
    expect(HAIR_WGSL).toContain('fn mx_hair_sample(lobe: MxBsdfLobe, wo: vec3f, u: vec3f) -> MxBsdfSample');
    expect(HAIR_WGSL).toContain('fn mx_hair_absorption_melanin(concentration: f32, redness: f32) -> vec3f');
    expect(HAIR_WGSL).toContain('fn mx_hair_absorption_color(color: vec3f, azimuthalRoughness: f32) -> vec3f');
    expect(HAIR_WGSL).not.toMatch(/\b(?:active|target|filter)\b/);
  });
});
