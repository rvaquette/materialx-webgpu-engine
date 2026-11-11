const SIZE = 16;
const SAMPLES = 2048;

function radicalInverse(index: number): number {
  let value = 0;
  let fraction = 0.5;
  while (index > 0) {
    value += (index & 1) * fraction;
    index >>>= 1;
    fraction *= 0.5;
  }
  return value;
}

function smith(cosine: number, alpha: number): number {
  return 2 * cosine / (cosine + Math.sqrt(alpha * alpha + (1 - alpha * alpha) * cosine * cosine));
}

function integrateAlbedo(roughness: number, cosine: number): number {
  const alpha = Math.max(roughness * roughness, 0.001);
  const viewX = Math.sqrt(1 - cosine * cosine);
  let total = 0;
  for (let sample = 0; sample < SAMPLES; sample++) {
    const radial = (sample + 0.5) / SAMPLES;
    const azimuth = 2 * Math.PI * radicalInverse(sample);
    const halfZ = Math.sqrt((1 - radial) / (1 + (alpha * alpha - 1) * radial));
    const halfX = Math.sqrt(1 - halfZ * halfZ) * Math.cos(azimuth);
    const viewHalf = viewX * halfX + cosine * halfZ;
    const lightZ = 2 * viewHalf * halfZ - cosine;
    if (viewHalf > 0 && lightZ > 0) {
      total += smith(cosine, alpha) * smith(lightZ, alpha) * viewHalf / (cosine * halfZ);
    }
  }
  return Math.min(1, Math.max(0, total / SAMPLES));
}

const directional = Array.from({ length: SIZE * SIZE }, (_, index) => {
  const roughness = Math.floor(index / SIZE) / (SIZE - 1);
  const cosine = Math.max(0.02, (index % SIZE) / (SIZE - 1));
  return integrateAlbedo(roughness, cosine);
});
const average = Array.from({ length: SIZE }, (_, row) => {
  let integral = 0;
  for (let column = 1; column < SIZE; column++) {
    const lower = (column - 1) / (SIZE - 1);
    const upper = column / (SIZE - 1);
    integral += (directional[row * SIZE + column - 1]! * lower + directional[row * SIZE + column]! * upper) / (SIZE - 1);
  }
  return integral;
});

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const lerp = (lower: number, upper: number, amount: number): number => lower + (upper - lower) * amount;

export function conductorAlbedo(roughness: number, cosine: number): number {
  const rough = clamp(roughness) * (SIZE - 1);
  const angle = clamp(cosine) * (SIZE - 1);
  const row = Math.min(SIZE - 2, Math.floor(rough));
  const column = Math.min(SIZE - 2, Math.floor(angle));
  const low = lerp(directional[row * SIZE + column]!, directional[row * SIZE + column + 1]!, angle - column);
  const high = lerp(directional[(row + 1) * SIZE + column]!, directional[(row + 1) * SIZE + column + 1]!, angle - column);
  return lerp(low, high, rough - row);
}

export function conductorAverageAlbedo(roughness: number): number {
  const rough = clamp(roughness) * (SIZE - 1);
  const row = Math.min(SIZE - 2, Math.floor(rough));
  return lerp(average[row]!, average[row + 1]!, rough - row);
}

export const CONDUCTOR_ENERGY_WGSL = `
const MX_CONDUCTOR_ALBEDO = array<f32, 256>(${directional.map(value => value.toFixed(7)).join(', ')});
const MX_CONDUCTOR_AVERAGE = array<f32, 16>(${average.map(value => value.toFixed(7)).join(', ')});
fn mx_conductor_albedo(roughness: f32, cosine: f32) -> f32 {
  let rough = clamp(roughness, 0.0, 1.0) * 15.0;
  let angle = clamp(cosine, 0.0, 1.0) * 15.0;
  let row = min(14u, u32(rough));
  let column = min(14u, u32(angle));
  let low = mix(MX_CONDUCTOR_ALBEDO[row * 16u + column], MX_CONDUCTOR_ALBEDO[row * 16u + column + 1u], angle - f32(column));
  let high = mix(MX_CONDUCTOR_ALBEDO[(row + 1u) * 16u + column], MX_CONDUCTOR_ALBEDO[(row + 1u) * 16u + column + 1u], angle - f32(column));
  return mix(low, high, rough - f32(row));
}
fn mx_conductor_average_albedo(roughness: f32) -> f32 {
  let rough = clamp(roughness, 0.0, 1.0) * 15.0;
  let row = min(14u, u32(rough));
  return mix(MX_CONDUCTOR_AVERAGE[row], MX_CONDUCTOR_AVERAGE[row + 1u], rough - f32(row));
}
`;