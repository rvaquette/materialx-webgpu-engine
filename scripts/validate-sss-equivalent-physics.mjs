import { readFileSync, writeFileSync } from 'node:fs';
import { createPcg32 } from '../src/render/pathtracing/integrator.ts';

const configuration = {
  name: 'davis-two-flux', color: [0.72, 0.28, 0.18], radius: [0.012, 0.006, 0.003],
  anisotropy: 0.15, ior: 1.3, bleed: 0.5,
};
const samples = 40000;
const sphereRadius = 0.8;
const shape = 2 - 0.75 * configuration.bleed;

function logGamma(z) {
  const coefficients = [676.5203681218851, -1259.1392167224028, 771.3234287776531,
    -176.6150291621406, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  let x = 0.99999999999980993;
  const shifted = z - 1;
  for (let index = 0; index < coefficients.length; index++) x += coefficients[index] / (shifted + index + 1);
  const t = shifted + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(x);
}

function gammaCdf(a, x) {
  if (x <= 0) return 0;
  const factor = Math.exp(-x + a * Math.log(x) - logGamma(a));
  if (x < a + 1) {
    let term = 1 / a;
    let sum = term;
    let denominator = a;
    for (let iteration = 0; iteration < 256; iteration++) {
      denominator++;
      term *= x / denominator;
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-14) break;
    }
    return sum * factor;
  }
  let b = x + 1 - a;
  let c = 1e300;
  let d = 1 / b;
  let fraction = d;
  for (let iteration = 1; iteration < 256; iteration++) {
    const coefficient = -iteration * (iteration - a);
    b += 2;
    d = coefficient * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + coefficient / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const delta = d * c;
    fraction *= delta;
    if (Math.abs(delta - 1) < 1e-14) break;
  }
  return 1 - factor * fraction;
}

function gammaQuantile(u) {
  let low = 0;
  let high = shape;
  while (gammaCdf(shape, high) < u) high *= 2;
  for (let iteration = 0; iteration < 48; iteration++) {
    const middle = (low + high) / 2;
    if (gammaCdf(shape, middle) < u) low = middle;
    else high = middle;
  }
  return (low + high) / (2 * shape);
}

function twoFluxCoefficients(color, radius) {
  const escape = 1 / configuration.ior ** 2;
  const alpha = color.map(value => {
    const bounded = Math.min(value, 1 - 1e-6);
    const internal = bounded / (escape + bounded * (1 - escape));
    const reduced = 4 * internal / (1 + internal) ** 2;
    return Math.min(reduced / (1 - configuration.anisotropy + reduced * configuration.anisotropy), 1 - 1e-6);
  });
  const sigmaT = color.map((value, channel) => {
    const offset = value - 0.8;
    return 1 / (radius[channel] * (1.9 - value + 3.5 * offset * offset));
  });
  return { alpha, sigmaT };
}

function referenceChannel(channel) {
  const random = createPcg32(731 + channel);
  const { alpha, sigmaT } = twoFluxCoefficients(configuration.color, configuration.radius);
  let escaped = 0;
  let absorbed = 0;
  let reflections = 0;
  for (let photon = 0; photon < samples; photon++) {
    const density = gammaQuantile(random());
    let position = [0, 0, sphereRadius];
    const radial = Math.sqrt(random());
    const azimuth = 2 * Math.PI * random();
    let direction = [radial * Math.cos(azimuth), radial * Math.sin(azimuth), -Math.sqrt(1 - radial * radial)];
    for (let event = 0; event < 65536; event++) {
      const projection = position.reduce((sum, value, index) => sum + value * direction[index], 0);
      const squaredRadius = position.reduce((sum, value) => sum + value * value, 0);
      const boundary = -projection + Math.sqrt(Math.max(0, projection * projection + sphereRadius ** 2 - squaredRadius));
      const distance = -Math.log1p(-random()) / (sigmaT[channel] * density);
      if (distance >= boundary) {
        position = position.map((value, index) => value + boundary * direction[index]);
        const normal = position.map(value => value / sphereRadius);
        const cosine = direction.reduce((sum, value, index) => sum + value * normal[index], 0);
        if (configuration.ior ** 2 * Math.max(0, 1 - cosine * cosine) >= 1) {
          direction = direction.map((value, index) => value - 2 * cosine * normal[index]);
          position = position.map((value, index) => value + direction[index] * 1e-8);
          reflections++;
          continue;
        }
        escaped++;
        break;
      }
      position = position.map((value, index) => value + distance * direction[index]);
      if (random() >= alpha[channel]) {
        absorbed++;
        break;
      }
      const phaseSample = random();
      const g = configuration.anisotropy;
      const ratio = (1 - g * g) / (1 - g + 2 * g * phaseSample);
      const cosine = g === 0 ? 1 - 2 * phaseSample : (1 + g * g - ratio * ratio) / (2 * g);
      const sine = Math.sqrt(Math.max(0, 1 - cosine * cosine));
      const angle = 2 * Math.PI * random();
      const helper = Math.abs(direction[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
      const tangent = [helper[1] * direction[2] - helper[2] * direction[1],
        helper[2] * direction[0] - helper[0] * direction[2], helper[0] * direction[1] - helper[1] * direction[0]];
      const tangentLength = Math.hypot(...tangent);
      for (let component = 0; component < 3; component++) tangent[component] /= tangentLength;
      const bitangent = [direction[1] * tangent[2] - direction[2] * tangent[1],
        direction[2] * tangent[0] - direction[0] * tangent[2], direction[0] * tangent[1] - direction[1] * tangent[0]];
      direction = direction.map((value, index) => value * cosine
        + sine * (Math.cos(angle) * tangent[index] + Math.sin(angle) * bitangent[index]));
    }
  }
  if (escaped + absorbed !== samples) throw new Error('Independent Davis reference reached its emergency guard.');
  const mean = escaped / samples;
  return { mean, standardError: Math.sqrt(mean * (1 - mean) / samples), escaped, absorbed, reflections };
}

const reference = configuration.color.map((_, channel) => referenceChannel(channel));
const renderPath = new URL('../renders/local-test_lama_sss_furnace-pathtracing-depth12-davis-two-flux.json', import.meta.url);
let rendered;
try { rendered = JSON.parse(readFileSync(renderPath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
let result = { configuration, sphereRadius, samplesPerChannel: samples, reference,
  oracle: 'Independent scalar analog sphere; gamma density by inverse regularized-gamma CDF; independent two-flux coefficients.' };

if (rendered) {
  const resolution = 64;
  const spp = 512;
  if (rendered.res !== resolution || rendered.spp !== spp || rendered.maxDepth !== 12) throw new Error('Unexpected Davis render settings.');
  const bytes = Buffer.from(rendered.benchmark.hdrBase64, 'base64');
  if (bytes.length !== resolution * resolution * 16) throw new Error('Wrong Davis HDR size.');
  for (let pixel = 0; pixel < resolution * resolution; pixel++) {
    if (bytes.readFloatLE((pixel * 4 + 3) * 4) !== spp) throw new Error('Incomplete Davis furnace sample count.');
  }
  for (const pixel of [0, resolution - 1, resolution * (resolution - 1), resolution * resolution - 1]) {
    for (let channel = 0; channel < 3; channel++) if (Math.abs(bytes.readFloatLE((pixel * 4 + channel) * 4) - 1) > 1e-5) {
      throw new Error('Davis furnace environment is not unit white.');
    }
  }
  const pixels = [];
  const center = resolution / 2;
  const radius = resolution / 8;
  for (let row = center - radius; row <= center + radius; row++) for (let column = center - radius; column <= center + radius; column++) {
    if ((row - center) ** 2 + (column - center) ** 2 <= radius ** 2) pixels.push(row * resolution + column);
  }
  const measured = [0, 1, 2].map(channel => {
    const values = pixels.map(pixel => bytes.readFloatLE((pixel * 4 + channel) * 4));
    if (!values.every(Number.isFinite)) throw new Error('Nonfinite Davis furnace radiance.');
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
    const standardError = Math.sqrt(variance / values.length);
    const difference = mean - reference[channel].mean;
    const tolerance = 0.015 + 5 * Math.hypot(standardError, reference[channel].standardError);
    return { mean, standardError, difference, tolerance, pass: Math.abs(difference) <= tolerance };
  });
  result = { ...result, resolution, spp, measured, renderMs: rendered.renderMs,
    status: measured.every(channel => channel.pass) ? 'pass' : 'fail' };
}

const output = new URL('../renders/local-lama-sss-equivalent-physical-validation.json', import.meta.url);
writeFileSync(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (result.status === 'fail') process.exitCode = 1;