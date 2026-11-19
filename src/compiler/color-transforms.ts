export interface ColorTransform {
  readonly transfer: 'linear' | 'srgb' | number;
  /** Matrix columns in MaterialX/WGSL order. */
  readonly matrix?: readonly [number, number, number, number, number, number, number, number, number];
}

const ACESCG = [
  1.705050992658, -0.130256417507, -0.024003356805,
  -0.621792120657, 1.140804736575, -0.128968976065,
  -0.083258872001, -0.010548319068, 1.15297233287,
] as const;
const ADOBE_RGB = [
   1.39835574, -2.50233861e-16, 2.77555756e-17,
  -0.398355744, 1, -0.0429289893,
  0, 0, 1.04292899,
] as const;
const DISPLAY_P3 = [
  1.22493029, -0.04205868, -0.01964128,
  -0.22492968, 1.04205894, -0.07864794,
  0.00000006, -0.00000001, 1.09828925,
] as const;

export const COLOR_TRANSFORMS: ReadonlyMap<string, ColorTransform> = new Map([
  ['g18_rec709_to_lin_rec709', { transfer: 1.8 }],
  ['g22_rec709_to_lin_rec709', { transfer: 2.2 }],
  ['rec709_display_to_lin_rec709', { transfer: 2.4 }],
  ['acescg_to_lin_rec709', { transfer: 'linear', matrix: ACESCG }],
  ['g22_ap1_to_lin_rec709', { transfer: 2.2, matrix: ACESCG }],
  ['srgb_texture_to_lin_rec709', { transfer: 'srgb' }],
  ['lin_adobergb_to_lin_rec709', { transfer: 'linear', matrix: ADOBE_RGB }],
  ['adobergb_to_lin_rec709', { transfer: 563 / 256, matrix: ADOBE_RGB }],
  ['srgb_displayp3_to_lin_rec709', { transfer: 'srgb', matrix: DISPLAY_P3 }],
  ['lin_displayp3_to_lin_rec709', { transfer: 'linear', matrix: DISPLAY_P3 }],
]);

export function transformColor(color: readonly number[], transform: ColorTransform): number[] {
  const rgb = color.slice(0, 3).map(value => {
    if (transform.transfer === 'linear') return value;
    if (transform.transfer === 'srgb') {
      return value > 0.04045 ? (Math.max(value + 0.055, 0) / 1.055) ** 2.4 : value / 12.92;
    }
    return Math.max(value, 0) ** transform.transfer;
  });
  if (transform.matrix) {
    const m = transform.matrix;
    const [r, g, b] = rgb;
    rgb[0] = m[0] * r! + m[3] * g! + m[6] * b!;
    rgb[1] = m[1] * r! + m[4] * g! + m[7] * b!;
    rgb[2] = m[2] * r! + m[5] * g! + m[8] * b!;
  }
  return color.length === 4 ? [...rgb, color[3]!] : rgb;
}
