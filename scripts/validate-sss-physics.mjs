import { readFileSync, writeFileSync } from 'node:fs';
import { createPcg32 } from '../src/render/pathtracing/integrator.ts';

const samples = 40000;
const sphereRadius = 0.8;
const configurations = [
  { name: 'calibration', color: [0.72, 0.28, 0.18], radius: [0.012, 0.006, 0.003], g: 0, ior: 1 },
  { name: 'original', color: [0.72, 0.28, 0.18], radius: [0.012, 0.006, 0.003], g: 0.15, ior: 1.3 },
  { name: 'white', color: [1, 1, 1], radius: [0.012, 0.006, 0.003], g: 0, ior: 1 },
];

function referenceChannel(configuration, channel) {
  const random = createPcg32(731 + channel);
  const color = configuration.color[channel];
  const alpha = 1 - Math.exp(-5.09406 * color + 2.61188 * color ** 2 - 4.31805 * color ** 3);
  let escaped = 0;
  let absorbed = 0;
  let reflections = 0;
  for (let photon = 0; photon < samples; photon++) {
    let position = [0, 0, sphereRadius];
    const radial = Math.sqrt(random());
    const phi = 2 * Math.PI * random();
    let direction = [radial * Math.cos(phi), radial * Math.sin(phi), -Math.sqrt(1 - radial * radial)];
    for (let event = 0; event < 65536; event++) {
      const projection = position.reduce((sum, value, index) => sum + value * direction[index], 0);
      const squaredRadius = position.reduce((sum, value) => sum + value * value, 0);
      const boundary = -projection + Math.sqrt(Math.max(0, projection * projection + sphereRadius ** 2 - squaredRadius));
      const distance = -Math.log1p(-random()) * configuration.radius[channel];
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
      if (random() >= alpha) {
        absorbed++;
        break;
      }
      const anisotropy = configuration.g;
      const sample = random();
      const ratio = (1 - anisotropy ** 2) / (1 - anisotropy + 2 * anisotropy * sample);
      const cosine = anisotropy === 0 ? 1 - 2 * sample
        : (1 + anisotropy ** 2 - ratio * ratio) / (2 * anisotropy);
      const sine = Math.sqrt(Math.max(0, 1 - cosine * cosine));
      const angle = 2 * Math.PI * random();
      const helper = Math.abs(direction[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
      const tangent = [helper[1] * direction[2] - helper[2] * direction[1],
        helper[2] * direction[0] - helper[0] * direction[2], helper[0] * direction[1] - helper[1] * direction[0]];
      const length = Math.hypot(...tangent);
      for (let index = 0; index < 3; index++) tangent[index] /= length;
      const bitangent = [direction[1] * tangent[2] - direction[2] * tangent[1],
        direction[2] * tangent[0] - direction[0] * tangent[2], direction[0] * tangent[1] - direction[1] * tangent[0]];
      direction = direction.map((value, index) => value * cosine
        + sine * (Math.cos(angle) * tangent[index] + Math.sin(angle) * bitangent[index]));
    }
  }
  if (escaped + absorbed !== samples) throw new Error('Analytic reference reached its emergency guard.');
  const mean = escaped / samples;
  return { mean, standardError: Math.sqrt(mean * (1 - mean) / samples), escaped, absorbed, reflections };
}

const results = configurations.map(configuration => {
  const reference = configuration.color.map((_, channel) => referenceChannel(configuration, channel));
  const file = new URL(`../renders/local-test_lama_sss_furnace-pathtracing-depth12-fidelity-${configuration.name}.json`, import.meta.url);
  let rendered;
  try {
    rendered = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!rendered) return { configuration, reference, status: 'reference-only' };
  const resolution = configuration.name === 'white' ? 64 : 128;
  const spp = configuration.name === 'white' ? 512 : 1024;
  if (![rendered.res === resolution, rendered.spp === spp, rendered.maxDepth === 12].every(Boolean)) throw new Error('Unexpected furnace render settings.');
  const bytes = Buffer.from(rendered.benchmark.hdrBase64, 'base64');
  if (bytes.length !== resolution * resolution * 16) throw new Error('Wrong furnace HDR size.');
  for (let pixel = 0; pixel < resolution * resolution; pixel++) {
    if (bytes.readFloatLE((pixel * 4 + 3) * 4) !== spp) throw new Error('Incomplete furnace sample count.');
  }
  for (const pixel of [0, resolution - 1, resolution * (resolution - 1), resolution * resolution - 1]) {
    for (let channel = 0; channel < 3; channel++) {
      if (Math.abs(bytes.readFloatLE((pixel * 4 + channel) * 4) - 1) > 1e-5) {
        throw new Error('Furnace environment is not unit white radiance.');
      }
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
    if (!values.every(Number.isFinite)) throw new Error('Nonfinite furnace radiance.');
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
    const standardError = Math.sqrt(variance / values.length);
    const difference = mean - reference[channel].mean;
    const tolerance = 0.01 + 5 * Math.hypot(standardError, reference[channel].standardError);
    return { mean, standardError, difference, tolerance, pass: Math.abs(difference) <= tolerance };
  });
  return { configuration, resolution, spp, reference, measured, renderMs: rendered.renderMs,
    status: measured.every(channel => channel.pass) ? 'pass' : 'fail' };
});

const report = { samplesPerChannel: samples, sphereRadius, reference: 'Independent scalar analog sphere transport; no production phase, free-flight or integrator calls.', results };
writeFileSync(new URL('../renders/local-lama-sss-physical-validation.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (results.some(result => result.status !== 'pass')) process.exitCode = 1;