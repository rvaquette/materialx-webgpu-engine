import { readFileSync, writeFileSync } from 'node:fs';

const renderPath = new URL('../renders/local-test_lama_sss_furnace-pathtracing-depth12-burley-ior-anisotropy.json', import.meta.url);
const reportPath = new URL('../renders/local-lama-sss-burley-ior-validation.json', import.meta.url);
const render = JSON.parse(readFileSync(renderPath, 'utf8'));
const resolution = 64;
const spp = 128;
const sphereRadius = 0.8;
const ior = 1.5;
const anisotropy = 0.3;
const color = [0.72, 0.28, 0.18];
const meanFreePath = [0.012, 0.006, 0.003];
const verticalAperture = 36.3970234266;
const focalLength = 50;
const tangentHalfFov = verticalAperture / (2 * focalLength);

if (render.res !== resolution || render.spp !== spp || render.maxDepth !== 12) {
  throw new Error('Unexpected Burley-IOR render settings.');
}
const hdr = Buffer.from(render.benchmark.hdrBase64, 'base64');
if (hdr.length !== resolution * resolution * 16) throw new Error('Wrong Burley-IOR HDR size.');
for (let pixel = 0; pixel < resolution * resolution; pixel++) {
  if (hdr.readFloatLE((pixel * 4 + 3) * 4) !== spp) throw new Error('Incomplete Burley-IOR sample count.');
  for (let channel = 0; channel < 3; channel++) {
    if (!Number.isFinite(hdr.readFloatLE((pixel * 4 + channel) * 4))) throw new Error('Nonfinite Burley-IOR radiance.');
  }
}
for (const pixel of [0, resolution - 1, resolution * (resolution - 1), resolution * resolution - 1]) {
  for (let channel = 0; channel < 3; channel++) {
    if (Math.abs(hdr.readFloatLE((pixel * 4 + channel) * 4) - 1) > 1e-5) {
      throw new Error('Burley-IOR furnace environment is not unit white.');
    }
  }
}

function fresnel(cosine, eta) {
  const c = Math.max(0, Math.min(1, Math.abs(cosine)));
  const sinSquaredTransmitted = (1 - c * c) / (eta * eta);
  if (sinSquaredTransmitted >= 1) return 1;
  const cosTransmitted = Math.sqrt(1 - sinSquaredTransmitted);
  const rs = (c - eta * cosTransmitted) / (c + eta * cosTransmitted);
  const rp = (eta * c - cosTransmitted) / (eta * c + cosTransmitted);
  return (rs * rs + rp * rp) / 2;
}

function diffusionLength(channel) {
  const albedo = color[channel];
  const escape = 1 / (ior * ior);
  const internal = albedo / (escape + albedo * (1 - escape));
  const reduced = 4 * internal / ((1 + internal) * (1 + internal));
  const alpha = reduced / (1 - anisotropy + reduced * anisotropy);
  return meanFreePath[channel] / Math.sqrt(3 * (1 - alpha) * (1 - alpha * anisotropy));
}

function sphereProfileMass(length) {
  return 1 - 0.25 * Math.exp(-2 * sphereRadius / length)
    - 0.75 * Math.exp(-2 * sphereRadius / (3 * length));
}

function cosineAverageExitTransmission(steps = 8192) {
  let sum = 0;
  for (let index = 0; index <= steps; index++) {
    const cosine = index / steps;
    const coefficient = index === 0 || index === steps ? 1 : index % 2 === 0 ? 2 : 4;
    sum += coefficient * cosine * (1 - fresnel(cosine, 1 / ior));
  }
  return 2 * sum / (3 * steps);
}

const exitTransmission = cosineAverageExitTransmission();
const lengths = color.map((_, channel) => diffusionLength(channel));
const profileMasses = lengths.map(sphereProfileMass);
const center = resolution / 2;
const diskRadius = resolution / 8;
const pixels = [];
const expectedChannels = [[], [], []];
const measuredChannels = [[], [], []];

for (let y = center - diskRadius; y <= center + diskRadius; y++) {
  for (let x = center - diskRadius; x <= center + diskRadius; x++) {
    if ((y - center) ** 2 + (x - center) ** 2 > diskRadius ** 2) continue;
    const ndcX = (2 * (x + 0.5) / resolution) - 1;
    const ndcY = 1 - (2 * (y + 0.5) / resolution);
    const rayLength = Math.hypot(ndcX * tangentHalfFov, ndcY * tangentHalfFov, 1);
    const direction = [ndcX * tangentHalfFov / rayLength, ndcY * tangentHalfFov / rayLength, -1 / rayLength];
    const projection = 4 * direction[2];
    const discriminant = projection * projection - (16 - sphereRadius * sphereRadius);
    if (discriminant < 0) throw new Error('Validation disk ray missed the analytic sphere.');
    const distance = -projection - Math.sqrt(discriminant);
    const position = [direction[0] * distance, direction[1] * distance, 4 + direction[2] * distance];
    const entryCosine = Math.max(0, Math.min(1,
      -(position[0] * direction[0] + position[1] * direction[1] + position[2] * direction[2]) / sphereRadius));
    const entryTransmission = 1 - fresnel(entryCosine, ior);
    const pixel = y * resolution + x;
    pixels.push(pixel);
    for (let channel = 0; channel < 3; channel++) {
      expectedChannels[channel].push(color[channel] * profileMasses[channel] * entryTransmission * exitTransmission);
      measuredChannels[channel].push(hdr.readFloatLE((pixel * 4 + channel) * 4));
    }
  }
}

const channels = [0, 1, 2].map(channel => {
  const measured = measuredChannels[channel];
  const expected = expectedChannels[channel];
  const residuals = measured.map((value, index) => value - expected[index]);
  const measuredMean = measured.reduce((sum, value) => sum + value, 0) / pixels.length;
  const expectedMean = expected.reduce((sum, value) => sum + value, 0) / pixels.length;
  const residualMean = residuals.reduce((sum, value) => sum + value, 0) / pixels.length;
  const residualVariance = residuals.reduce((sum, value) => sum + (value - residualMean) ** 2, 0) / (pixels.length - 1);
  const standardError = Math.sqrt(residualVariance / pixels.length);
  const tolerance = 0.006 + 5 * standardError;
  return { measuredMean, expectedMean, difference: residualMean, standardError, tolerance,
    pass: Math.abs(residualMean) <= tolerance };
});

const report = {
  model: 'Burley mode 3, two-flux inversion, dielectric entry/exit interfaces',
  parameters: { color, meanFreePath, anisotropy, ior, sphereRadius, resolution, spp },
  reference: 'Independent exact spherical integral of the normalized Burley radial profile and cosine-averaged dielectric exit transmission.',
  diffusionLengths: lengths,
  profileMasses,
  cosineAverageExitTransmission: exitTransmission,
  diskPixels: pixels.length,
  channels,
  renderMs: render.renderMs,
  status: channels.every(channel => channel.pass) ? 'pass' : 'fail',
};
writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.status !== 'pass') process.exitCode = 1;