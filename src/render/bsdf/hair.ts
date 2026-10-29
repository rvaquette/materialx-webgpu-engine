/** Chiang near-field cylindrical hair scattering, in a frame with +X fiber and +Z normal. */
export type HairVec3 = readonly [number, number, number];

export interface HairParameters {
  absorption: HairVec3;
  tintR: HairVec3;
  tintTT: HairVec3;
  tintTRT: HairVec3;
  longitudinalRoughness: number;
  azimuthalRoughness: number;
  cuticleAngle: number;
  ior: number;
}

export interface HairEval {
  value: [number, number, number];
  pdf: number;
}

export interface HairSample extends HairEval {
  wi: [number, number, number];
  valid: boolean;
}

const PI = Math.PI;
const TWO_PI = 2 * PI;
const MIN_V = 1e-5;
const MIN_S = 1e-4;
const LUMINANCE: HairVec3 = [0.2722287, 0.6740818, 0.0536895];
const clamp = (x: number, lo: number, hi: number): number =>
  Number.isFinite(x) ? Math.min(Math.max(x, lo), hi) : lo;
const finite = (x: number): number => Number.isFinite(x) ? x : 0;
const dot = (a: HairVec3, b: HairVec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function normalize(v: HairVec3): [number, number, number] {
  const c: [number, number, number] = [finite(v[0]), finite(v[1]), finite(v[2])];
  const length = Math.hypot(...c);
  return length > 1e-20 ? [c[0] / length, c[1] / length, c[2] / length] : [0, 0, 0];
}

function logI0(value: number): number {
  const x = Math.abs(value);
  if (x > 12) {
    const r = 1 / x;
    const r2 = r * r;
    return x - 0.5 * Math.log(TWO_PI * x) +
      Math.log(1 + r / 8 + 9 * r2 / 128 + 225 * r2 * r / 3072 + 11025 * r2 * r2 / 98304);
  }
  let term = 1;
  let sum = 1;
  for (let k = 1; k <= 32; k++) {
    term *= (x * x) / (4 * k * k);
    sum += term;
  }
  return Math.log(sum);
}

function logSinh(x: number): number {
  if (x > 20) return x - Math.log(2) + Math.log1p(-Math.exp(-2 * x));
  if (x < 1e-3) return Math.log(x) + Math.log1p(x * x / 6 + x ** 4 / 120);
  return Math.log(Math.sinh(x));
}

function mLongitudinal(sinI: number, cosI: number, sinOp: number, cosOp: number, variance: number): number {
  const v = Math.max(variance, MIN_V);
  const inv = 1 / v;
  const logM = -sinI * sinOp * inv + logI0(cosI * cosOp * inv) -
    Math.log(2 * v) - logSinh(inv);
  return Math.exp(Math.min(logM, 80));
}

function wrapped(delta: number): number {
  return delta - TWO_PI * Math.floor((delta + PI) / TWO_PI);
}

function logisticCdf(x: number, scale: number): number {
  return 1 / (1 + Math.exp(clamp(-x / scale, -80, 80)));
}

function nAzimuth(delta: number, scale: number): number {
  const d = wrapped(delta);
  const e = Math.exp(-Math.abs(d) / scale);
  const norm = logisticCdf(PI, scale) - logisticCdf(-PI, scale);
  return e / (scale * (1 + e) ** 2 * norm);
}

function fresnel(cosIncident: number, ior: number): number {
  const ci = clamp(Math.abs(cosIncident), 0, 1);
  const sinT2 = (1 - ci * ci) / (ior * ior);
  if (sinT2 >= 1) return 1;
  const ct = Math.sqrt(Math.max(1 - sinT2, 0));
  const rs = (ior * ci - ct) / (ior * ci + ct);
  const rp = (ci - ior * ct) / (ci + ior * ct);
  return clamp((rs * rs + rp * rp) * 0.5, 0, 1);
}

function model(p: HairParameters, wo: HairVec3) {
  const thetaO = Math.asin(clamp(wo[0], -1, 1));
  const cosThetaO = Math.max(Math.abs(Math.cos(thetaO)), 1e-5);
  const radialO = Math.hypot(wo[1], wo[2]);
  const gammaO = Math.asin(clamp(radialO > 1e-8 ? wo[1] / radialO : 0, -1, 1));
  const h = Math.sin(gammaO);
  const eta = clamp(p.ior, 1.0001, 3);
  const etaPrime = Math.sqrt(Math.max(eta * eta - Math.sin(thetaO) ** 2, 1e-8)) / cosThetaO;
  const gammaT = Math.asin(clamp(h / etaPrime, -0.999999, 0.999999));
  const cosGammaT = Math.max(Math.cos(gammaT), 1e-5);
  const sinThetaT = clamp(Math.sin(thetaO) / etaPrime, -0.999999, 0.999999);
  const cosThetaT = Math.max(Math.sqrt(Math.max(1 - sinThetaT * sinThetaT, 0)), 1e-5);
  const f = fresnel(cosThetaO * Math.cos(gammaO), eta);
  const absorption: [number, number, number] = [
    clamp(p.absorption[0], 0, 80), clamp(p.absorption[1], 0, 80), clamp(p.absorption[2], 0, 80),
  ];
  const trans: [number, number, number] = [
    Math.exp(-absorption[0] * 2 * cosGammaT / cosThetaT),
    Math.exp(-absorption[1] * 2 * cosGammaT / cosThetaT),
    Math.exp(-absorption[2] * 2 * cosGammaT / cosThetaT),
  ];
  const betaM = clamp(p.longitudinalRoughness, 0, 1);
  const betaN = clamp(p.azimuthalRoughness, 0, 1);
  const v0 = Math.max((0.726 * betaM + 0.812 * betaM ** 2 + 3.7 * betaM ** 20) ** 2, MIN_V);
  const azimuthScale = Math.max(Math.sqrt(PI / 8) *
    (0.265 * betaN + 1.194 * betaN ** 2 + 5.372 * betaN ** 22), MIN_S);
  const angle = clamp(p.cuticleAngle, -80, 80) * PI / 180;
  const offsets = [-2 * angle, angle, 4 * angle, 0] as const;
  const variances = [v0, Math.max(0.25 * v0, MIN_V), Math.max(4 * v0, MIN_V), Math.max(4 * v0, MIN_V)] as const;
  const tintR = p.tintR;
  const tintTT = p.tintTT;
  const tintTRT = p.tintTRT;
  const colors: [number, number, number][] = [];
  for (let order = 0; order < 3; order++) {
    const tint = order === 0 ? tintR : order === 1 ? tintTT : tintTRT;
    const color: [number, number, number] = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const channelPath = order === 0 ? f : order === 1
        ? (1 - f) ** 2 * trans[c]!
        : (1 - f) ** 2 * f * trans[c]! ** 2;
      color[c] = channelPath * clamp(tint[c]!, 0, 1);
    }
    colors.push(color);
  }
  const tail: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const q = f * trans[c]!;
    tail[c] = (1 - f) ** 2 * f ** 2 * trans[c]! ** 3 /
      Math.max(1 - q, 1e-8) * clamp(tintTRT[c]!, 0, 1);
  }
  colors.push(tail);
  return { thetaO, gammaO, gammaT, f, trans, variances, offsets, azimuthScale, colors };
}

function pathCenter(order: number, gammaO: number, gammaT: number): number {
  return 2 * order * gammaT - 2 * gammaO + order * PI;
}

function luminance(c: HairVec3): number {
  return dot(c, LUMINANCE);
}

function evalCore(params: HairParameters, woInput: HairVec3, wiInput: HairVec3): HairEval {
  const wo = normalize(woInput);
  const wi = normalize(wiInput);
  if (dot(wo, wo) < 0.5 || dot(wi, wi) < 0.5) return { value: [0, 0, 0], pdf: 0 };
  const m = model(params, wo);
  const thetaI = Math.asin(clamp(wi[0], -1, 1));
  const sinI = Math.sin(thetaI);
  const cosI = Math.abs(Math.cos(thetaI));
  const phiO = Math.atan2(wo[1], wo[2]);
  const phiI = Math.atan2(wi[1], wi[2]);
  const weights = m.colors.map(luminance);
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (!(total > 1e-12)) return { value: [0, 0, 0], pdf: 0 };

  const value: [number, number, number] = [0, 0, 0];
  let pdf = 0;
  for (let order = 0; order < 4; order++) {
    const thetaOp = m.thetaO + m.offsets[order]!;
    const mPdf = mLongitudinal(sinI, cosI, Math.sin(thetaOp), Math.abs(Math.cos(thetaOp)), m.variances[order]!);
    const nPdf = order === 3 ? 1 / TWO_PI : nAzimuth(phiI - phiO - pathCenter(order, m.gammaO, m.gammaT), m.azimuthScale);
    const density = mPdf * nPdf;
    pdf += (weights[order]! / total) * density;
    for (let c = 0; c < 3; c++) value[c] = value[c]! + m.colors[order]![c]! * density;
  }
  return {
    value: [value[0] / Math.max(Math.abs(wi[2]), 1e-6), value[1] / Math.max(Math.abs(wi[2]), 1e-6), value[2] / Math.max(Math.abs(wi[2]), 1e-6)],
    pdf: Number.isFinite(pdf) ? Math.max(pdf, 0) : 0,
  };
}

export function hairEval(params: HairParameters, wo: HairVec3, wi: HairVec3): HairEval {
  return evalCore(params, wo, wi);
}

function sampleLongitudinal(thetaOp: number, variance: number, u: number, u2: number): number {
  const v = Math.max(variance, MIN_V);
  const cosD = clamp(1 + v * Math.log(clamp(u, 1e-15, 1) +
    (1 - clamp(u, 1e-15, 1)) * Math.exp(-2 / v)), -1, 1);
  const sinD = Math.sqrt(Math.max(1 - cosD * cosD, 0));
  const sinI = -cosD * Math.sin(thetaOp) + sinD * Math.cos(TWO_PI * u2) * Math.cos(thetaOp);
  return Math.asin(clamp(sinI, -1, 1));
}

function sampleAzimuth(scale: number, u: number): number {
  const low = logisticCdf(-PI, scale);
  const high = logisticCdf(PI, scale);
  const probability = clamp(low + clamp(u, 0, 1) * (high - low), 1e-15, 1 - 1e-15);
  return scale * Math.log(probability / (1 - probability));
}

export function hairSample(
  params: HairParameters,
  woInput: HairVec3,
  u: readonly [number, number, number],
): HairSample {
  const wo = normalize(woInput);
  if (dot(wo, wo) < 0.5) return { wi: [0, 0, 0], value: [0, 0, 0], pdf: 0, valid: false };
  const m = model(params, wo);
  const weights = m.colors.map(luminance);
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (!(total > 1e-12)) return { wi: [0, 0, 0], value: [0, 0, 0], pdf: 0, valid: false };
  const pathRandom = clamp(u[0], 0, 1 - Number.EPSILON);
  let remaining = pathRandom * total;
  let selected = 3;
  let remapped = 0;
  for (let order = 0; order < 4; order++) {
    const mass = weights[order]!;
    if (remaining <= mass) {
      selected = order;
      remapped = mass > 0 ? remaining / mass : 0;
      break;
    }
    remaining -= mass;
  }
  const thetaOp = m.thetaO + m.offsets[selected]!;
  const thetaI = sampleLongitudinal(thetaOp, m.variances[selected]!, clamp(u[1], 1e-15, 1), remapped);
  const phiO = Math.atan2(wo[1], wo[2]);
  const phiI = phiO + pathCenter(selected, m.gammaO, m.gammaT) +
    (selected === 3 ? TWO_PI * clamp(u[2], 0, 1) : sampleAzimuth(m.azimuthScale, u[2]));
  const wi: [number, number, number] = [
    Math.sin(thetaI),
    Math.cos(thetaI) * Math.sin(phiI),
    Math.cos(thetaI) * Math.cos(phiI),
  ];
  const evaluated = evalCore(params, wo, wi);
  return { wi, ...evaluated, valid: evaluated.pdf > 0 && evaluated.value.every(Number.isFinite) };
}

/** Chiang's fitted melanin extinction coefficients, interpolated by redness. */
export function hairAbsorptionFromMelanin(concentration: number, redness: number): [number, number, number] {
  const amount = clamp(concentration, 0, 80);
  const red = clamp(redness, 0, 1);
  return [
    amount * (0.419 * (1 - red) + 0.187 * red),
    amount * (0.697 * (1 - red) + 0.4 * red),
    amount * (1.37 * (1 - red) + 1.05 * red),
  ];
}

/** Infer absorption from color using the Chiang fitted RGB-to-extinction polynomial. */
export function hairAbsorptionFromColor(color: HairVec3, azimuthalRoughness: number): [number, number, number] {
  const beta = clamp(azimuthalRoughness, 0, 1);
  const denominator = 5.969 - 0.215 * beta + 2.532 * beta ** 2 - 10.73 * beta ** 3 +
    5.574 * beta ** 4 + 0.245 * beta ** 5;
  const scale = Math.max(denominator, MIN_S);
  return [
    (Math.log(Math.max(clamp(color[0], 0, 1), 1e-6)) / scale) ** 2,
    (Math.log(Math.max(clamp(color[1], 0, 1), 1e-6)) / scale) ** 2,
    (Math.log(Math.max(clamp(color[2], 0, 1), 1e-6)) / scale) ** 2,
  ];
}

/** WGSL implementation of the same Chiang equations; expects closure prelude structs. */
export const HAIR_WGSL = /* wgsl */ `
fn mx_hair_clamp(x: f32, lo: f32, hi: f32) -> f32 { return min(max(x, lo), hi); }
fn mx_hair_log_i0(value: f32) -> f32 {
  let x = abs(value);
  if (x > 12.0) {
    let r = 1.0 / x;
    let r2 = r * r;
    return x - 0.5 * log(6.283185307179586 * x) +
      log(1.0 + r / 8.0 + 9.0 * r2 / 128.0 + 225.0 * r2 * r / 3072.0 + 11025.0 * r2 * r2 / 98304.0);
  }
  var term = 1.0;
  var total = 1.0;
  for (var k = 1u; k <= 32u; k++) {
    let fk = f32(k);
    term *= x * x / (4.0 * fk * fk);
    total += term;
  }
  return log(total);
}
fn mx_hair_log_sinh(x: f32) -> f32 {
  if (x > 20.0) { return x - 0.6931471805599453 + log(max(1.0 - exp(-2.0 * x), 1.0e-30)); }
  if (x < 0.001) { return log(x) + log(1.0 + x * x / 6.0 + x * x * x * x / 120.0); }
  return log(max(0.5 * (exp(x) - exp(-x)), 1.0e-30));
}
fn mx_hair_m(sinI: f32, cosI: f32, sinOp: f32, cosOp: f32, variance: f32) -> f32 {
  let v = max(variance, 1.0e-5);
  let inv = 1.0 / v;
  let logM = -sinI * sinOp * inv + mx_hair_log_i0(cosI * cosOp * inv) -
    log(2.0 * v) - mx_hair_log_sinh(inv);
  return exp(min(logM, 80.0));
}
fn mx_hair_wrap(x: f32) -> f32 { return x - 6.283185307179586 * floor((x + 3.141592653589793) / 6.283185307179586); }
fn mx_hair_logistic_cdf(x: f32, scale: f32) -> f32 { return 1.0 / (1.0 + exp(mx_hair_clamp(-x / scale, -80.0, 80.0))); }
fn mx_hair_n(delta: f32, scale: f32) -> f32 {
  let d = mx_hair_wrap(delta);
  let e = exp(-abs(d) / scale);
  let norm = mx_hair_logistic_cdf(3.141592653589793, scale) - mx_hair_logistic_cdf(-3.141592653589793, scale);
  return e / (scale * (1.0 + e) * (1.0 + e) * norm);
}
fn mx_hair_fresnel(cosIncident: f32, eta: f32) -> f32 {
  let ci = mx_hair_clamp(abs(cosIncident), 0.0, 1.0);
  let sinT2 = (1.0 - ci * ci) / (eta * eta);
  if (sinT2 >= 1.0) { return 1.0; }
  let ct = sqrt(max(1.0 - sinT2, 0.0));
  let rs = (eta * ci - ct) / (eta * ci + ct);
  let rp = (ci - eta * ct) / (ci + eta * ct);
  return mx_hair_clamp(0.5 * (rs * rs + rp * rp), 0.0, 1.0);
}
fn mx_hair_center(order: u32, gammaO: f32, gammaT: f32) -> f32 { return 2.0 * f32(order) * gammaT - 2.0 * gammaO + f32(order) * 3.141592653589793; }
fn mx_hair_luminance(color: vec3f) -> f32 { return dot(color, vec3f(0.2722287, 0.6740818, 0.0536895)); }
fn mx_hair_eval(lobe: MxBsdfLobe, wo: vec3f, wi: vec3f) -> MxBsdfEval {
  let woLen = length(wo);
  let wiLen = length(wi);
  if (woLen < 1.0e-20 || wiLen < 1.0e-20) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let wO = wo / woLen;
  let wI = wi / wiLen;
  let thetaO = asin(mx_hair_clamp(wO.x, -1.0, 1.0));
  let thetaI = asin(mx_hair_clamp(wI.x, -1.0, 1.0));
  let radialO = length(wO.yz);
  var gammaO = 0.0;
  if (radialO > 1.0e-8) { gammaO = asin(mx_hair_clamp(wO.y / radialO, -1.0, 1.0)); }
  let h = sin(gammaO);
  let eta = mx_hair_clamp(lobe.ior, 1.0001, 3.0);
  let cosThetaO = max(abs(cos(thetaO)), 1.0e-5);
  let etaPrime = sqrt(max(eta * eta - sin(thetaO) * sin(thetaO), 1.0e-8)) / cosThetaO;
  let gammaT = asin(mx_hair_clamp(h / etaPrime, -0.999999, 0.999999));
  let cosGammaT = max(cos(gammaT), 1.0e-5);
  let sinThetaT = mx_hair_clamp(sin(thetaO) / etaPrime, -0.999999, 0.999999);
  let cosThetaT = max(sqrt(max(1.0 - sinThetaT * sinThetaT, 0.0)), 1.0e-5);
  let f = mx_hair_fresnel(cosThetaO * cos(gammaO), eta);
  let pathT = exp(-clamp(lobe.extinction, vec3f(0.0), vec3f(80.0)) * (2.0 * cosGammaT / cosThetaT));
  let betaM = mx_hair_clamp(lobe.roughness, 0.0, 1.0);
  let betaN = mx_hair_clamp(lobe.anisotropy, 0.0, 1.0);
  let v0 = max(pow(0.726 * betaM + 0.812 * betaM * betaM + 3.7 * pow(betaM, 20.0), 2.0), 1.0e-5);
  let azScale = max(sqrt(3.141592653589793 / 8.0) * (0.265 * betaN + 1.194 * betaN * betaN + 5.372 * pow(betaN, 22.0)), 1.0e-4);
  let angle = mx_hair_clamp(lobe.rotation, -80.0, 80.0) * 0.017453292519943295;
  let vars = vec4f(v0, max(0.25 * v0, 1.0e-5), max(4.0 * v0, 1.0e-5), max(4.0 * v0, 1.0e-5));
  let offs = vec4f(-2.0 * angle, angle, 4.0 * angle, 0.0);
  let a0 = vec3f(f) * clamp(lobe.color, vec3f(0.0), vec3f(1.0));
  let a1 = pow(vec3f(1.0 - f), vec3f(2.0)) * pathT * clamp(lobe.color90, vec3f(0.0), vec3f(1.0));
  let a2 = pow(vec3f(1.0 - f), vec3f(2.0)) * f * pathT * pathT * clamp(lobe.hairTintTRT, vec3f(0.0), vec3f(1.0));
  let q = vec3f(f) * pathT;
  let a3 = pow(vec3f(1.0 - f), vec3f(2.0)) * vec3f(f * f) * pathT * pathT * pathT /
    max(vec3f(1.0) - q, vec3f(1.0e-8)) * clamp(lobe.hairTintTRT, vec3f(0.0), vec3f(1.0));
  let weights = vec4f(mx_hair_luminance(a0), mx_hair_luminance(a1), mx_hair_luminance(a2), mx_hair_luminance(a3));
  let total = dot(weights, vec4f(1.0));
  if (total <= 1.0e-12) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let sinI = sin(thetaI);
  let cosI = abs(cos(thetaI));
  let sinO = sin(thetaO);
  let cosO = abs(cos(thetaO));
  let phiO = atan2(wO.y, wO.z);
  let phiI = atan2(wI.y, wI.z);
  var result = vec3f(0.0);
  var pdf = 0.0;
  for (var order = 0u; order < 4u; order++) {
    let thetaOp = thetaO + offs[order];
    let mPdf = mx_hair_m(sinI, cosI, sin(thetaOp), abs(cos(thetaOp)), vars[order]);
    var nPdf = mx_hair_n(phiI - phiO - mx_hair_center(order, gammaO, gammaT), azScale);
    var color = a0;
    if (order == 1u) { color = a1; }
    if (order == 2u) { color = a2; }
    if (order == 3u) { color = a3; nPdf = 0.15915494309189535; }
    let density = mPdf * nPdf;
    result += color * density;
    pdf += weights[order] / total * density;
  }
  return MxBsdfEval(result / max(abs(wI.z), 1.0e-6), pdf);
}
fn mx_hair_sample(lobe: MxBsdfLobe, wo: vec3f, u: vec3f) -> MxBsdfSample {
  let woLen = length(wo);
  if (woLen < 1.0e-20) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  let wO = wo / woLen;
  let thetaO = asin(mx_hair_clamp(wO.x, -1.0, 1.0));
  let radialO = length(wO.yz);
  var gammaO = 0.0;
  if (radialO > 1.0e-8) { gammaO = asin(mx_hair_clamp(wO.y / radialO, -1.0, 1.0)); }
  let h = sin(gammaO);
  let eta = mx_hair_clamp(lobe.ior, 1.0001, 3.0);
  let cosThetaO = max(abs(cos(thetaO)), 1.0e-5);
  let etaPrime = sqrt(max(eta * eta - sin(thetaO) * sin(thetaO), 1.0e-8)) / cosThetaO;
  let gammaT = asin(mx_hair_clamp(h / etaPrime, -0.999999, 0.999999));
  let cosGammaT = max(cos(gammaT), 1.0e-5);
  let sinThetaT = mx_hair_clamp(sin(thetaO) / etaPrime, -0.999999, 0.999999);
  let cosThetaT = max(sqrt(max(1.0 - sinThetaT * sinThetaT, 0.0)), 1.0e-5);
  let f = mx_hair_fresnel(cosThetaO * cos(gammaO), eta);
  let pathT = exp(-clamp(lobe.extinction, vec3f(0.0), vec3f(80.0)) * (2.0 * cosGammaT / cosThetaT));
  let betaM = mx_hair_clamp(lobe.roughness, 0.0, 1.0);
  let betaN = mx_hair_clamp(lobe.anisotropy, 0.0, 1.0);
  let v0 = max(pow(0.726 * betaM + 0.812 * betaM * betaM + 3.7 * pow(betaM, 20.0), 2.0), 1.0e-5);
  let azScale = max(sqrt(3.141592653589793 / 8.0) * (0.265 * betaN + 1.194 * betaN * betaN + 5.372 * pow(betaN, 22.0)), 1.0e-4);
  let angle = mx_hair_clamp(lobe.rotation, -80.0, 80.0) * 0.017453292519943295;
  let vars = vec4f(v0, max(0.25 * v0, 1.0e-5), max(4.0 * v0, 1.0e-5), max(4.0 * v0, 1.0e-5));
  let offs = vec4f(-2.0 * angle, angle, 4.0 * angle, 0.0);
  let a0 = vec3f(f) * clamp(lobe.color, vec3f(0.0), vec3f(1.0));
  let a1 = pow(vec3f(1.0 - f), vec3f(2.0)) * pathT * clamp(lobe.color90, vec3f(0.0), vec3f(1.0));
  let a2 = pow(vec3f(1.0 - f), vec3f(2.0)) * f * pathT * pathT * clamp(lobe.hairTintTRT, vec3f(0.0), vec3f(1.0));
  let q = vec3f(f) * pathT;
  let a3 = pow(vec3f(1.0 - f), vec3f(2.0)) * vec3f(f * f) * pathT * pathT * pathT /
    max(vec3f(1.0) - q, vec3f(1.0e-8)) * clamp(lobe.hairTintTRT, vec3f(0.0), vec3f(1.0));
  let weights = vec4f(mx_hair_luminance(a0), mx_hair_luminance(a1), mx_hair_luminance(a2), mx_hair_luminance(a3));
  let total = dot(weights, vec4f(1.0));
  if (total <= 1.0e-12) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  var remaining = mx_hair_clamp(u.x, 0.0, 0.99999994) * total;
  var selected = 3u;
  var pathRemainder = 0.0;
  for (var order = 0u; order < 4u; order++) {
    if (remaining <= weights[order]) {
      selected = order;
      pathRemainder = remaining / max(weights[order], 1.0e-30);
      break;
    }
    remaining -= weights[order];
  }
  let thetaOp = thetaO + offs[selected];
  let v = vars[selected];
  let sampleU = mx_hair_clamp(u.y, 1.0e-7, 1.0);
  let cosD = mx_hair_clamp(1.0 + v * log(sampleU + (1.0 - sampleU) * exp(-2.0 / v)), -1.0, 1.0);
  let sinD = sqrt(max(1.0 - cosD * cosD, 0.0));
  let sinI = -cosD * sin(thetaOp) + sinD * cos(6.283185307179586 * pathRemainder) * cos(thetaOp);
  let thetaI = asin(mx_hair_clamp(sinI, -1.0, 1.0));
  let phiO = atan2(wO.y, wO.z);
  var phiI = phiO + mx_hair_center(selected, gammaO, gammaT) + 6.283185307179586 * u.z;
  if (selected < 3u) {
    let low = mx_hair_logistic_cdf(-3.141592653589793, azScale);
    let high = mx_hair_logistic_cdf(3.141592653589793, azScale);
    let prob = mx_hair_clamp(low + mx_hair_clamp(u.z, 0.0, 1.0) * (high - low), 1.0e-7, 0.9999999);
    phiI = phiO + mx_hair_center(selected, gammaO, gammaT) + azScale * log(prob / (1.0 - prob));
  }
  let wi = vec3f(sin(thetaI), cos(thetaI) * sin(phiI), cos(thetaI) * cos(phiI));
  let ev = mx_hair_eval(lobe, wO, wi);
  return MxBsdfSample(wi, ev.value, ev.pdf, ev.pdf > 0.0);
}
fn mx_hair_absorption_melanin(concentration: f32, redness: f32) -> vec3f {
  let amount = mx_hair_clamp(concentration, 0.0, 80.0);
  let red = mx_hair_clamp(redness, 0.0, 1.0);
  return amount * mix(vec3f(0.419, 0.697, 1.37), vec3f(0.187, 0.4, 1.05), red);
}
fn mx_hair_absorption_color(color: vec3f, azimuthalRoughness: f32) -> vec3f {
  let beta = mx_hair_clamp(azimuthalRoughness, 0.0, 1.0);
  let denom = 5.969 - 0.215 * beta + 2.532 * beta * beta - 10.73 * pow(beta, 3.0) +
    5.574 * pow(beta, 4.0) + 0.245 * pow(beta, 5.0);
  let safeColor = max(clamp(color, vec3f(0.0), vec3f(1.0)), vec3f(1.0e-6));
  let logColor = log(safeColor) / max(denom, 1.0e-4);
  return logColor * logColor;
}
`;
