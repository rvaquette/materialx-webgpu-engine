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
const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const TERMS = 6;

function fit(values: readonly number[]): number[] {
  const matrix = Array.from({ length: TERMS }, (_, row) => Array.from({ length: TERMS + 1 }, (_, column) =>
    values.reduce((total, value, sample) => {
      const position = sample / (SIZE - 1);
      return total + Math.pow(position, row) * (column === TERMS ? value : Math.pow(position, column));
    }, 0)));
  for (let column = 0; column < TERMS; column++) {
    let pivot = column;
    for (let row = column + 1; row < TERMS; row++) {
      if (Math.abs(matrix[row]![column]!) > Math.abs(matrix[pivot]![column]!)) pivot = row;
    }
    [matrix[column], matrix[pivot]] = [matrix[pivot]!, matrix[column]!];
    const divisor = matrix[column]![column]!;
    for (let index = column; index <= TERMS; index++) matrix[column]![index] = matrix[column]![index]! / divisor;
    for (let row = 0; row < TERMS; row++) {
      if (row === column) continue;
      const factor = matrix[row]![column]!;
      for (let index = column; index <= TERMS; index++) {
        matrix[row]![index] = matrix[row]![index]! - factor * matrix[column]![index]!;
      }
    }
  }
  return matrix.map(row => row[TERMS]!);
}

const angleFits = Array.from({ length: SIZE }, (_, row) => fit(directional.slice(row * SIZE, (row + 1) * SIZE)));
const coefficients = Array.from({ length: TERMS }, (_, term) => fit(angleFits.map(row => row[term]!)));
const polynomial = (values: readonly number[], position: number): number =>
  values.reduceRight((total, coefficient) => total * position + coefficient, 0);

export function conductorAlbedo(roughness: number, cosine: number): number {
  return clamp(polynomial(coefficients.map(row => polynomial(row, clamp(roughness))), clamp(cosine)));
}

export function conductorAverageAlbedo(roughness: number): number {
  return clamp(coefficients.reduce((total, row, term) => total + polynomial(row, clamp(roughness)) * 2 / (term + 2), 0));
}

function wgslPolynomial(values: readonly number[], variable: string): string {
  return values.reduceRight((expression, value) => `(${expression} * ${variable} + ${value.toFixed(9)})`, '0.0');
}
const angleExpressions = coefficients.map(row => wgslPolynomial(row, 'rough'));
const albedoExpression = angleExpressions.reduceRight((expression, value) => `(${expression} * angle + ${value})`, '0.0');
const averageExpression = coefficients.map((row, term) => `(${wgslPolynomial(row, 'rough')} * ${(2 / (term + 2)).toFixed(9)})`).join(' + ');

export const CONDUCTOR_ENERGY_WGSL = `
fn mx_conductor_albedo(roughness: f32, cosine: f32) -> f32 {
  let rough = clamp(roughness, 0.0, 1.0);
  let angle = clamp(cosine, 0.0, 1.0);
  return clamp(${albedoExpression}, 0.0, 1.0);
}
fn mx_conductor_average_albedo(roughness: f32) -> f32 {
  let rough = clamp(roughness, 0.0, 1.0);
  return clamp(${averageExpression}, 0.0, 1.0);
}
`;